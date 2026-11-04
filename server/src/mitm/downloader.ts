import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { MitmValidation } from './types.js';

/**
 * 无头直链下载引擎：等价于 res-downloader 的 FileDownloader（HEAD→GET→流式写盘），
 * 但不依赖 Wails GUI 主循环，可常驻服务端进程，因而能真正完成下载。
 * 纯 Node 原生 http/https，避免 fetch 的代理歧义，完整控制 Range / 超时 / 取消。
 */

export interface MitmProgress {
  downloadedBytes: number;
  fileSizeBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
}

export interface MitmDownloadOptions {
  url: string;
  headers: Record<string, string>;
  targetPath: string;
  timeoutMs: number;
  maxBytes?: number;
  onProgress: (p: MitmProgress) => void;
  signal: { aborted: boolean };
}

export class MitmCancelError extends Error {
  constructor() {
    super('download cancelled');
    this.name = 'MitmCancelError';
  }
}

function requestOnce(
  url: string,
  method: 'HEAD' | 'GET',
  headers: Record<string, string>,
  timeoutMs: number,
  signal: { aborted: boolean }
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error(`非法 URL: ${url}`));
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    let abortTimer: ReturnType<typeof setInterval> | null = null;
    const req = lib.request(
      parsed,
      { method, headers: { ...headers, 'Accept-Encoding': 'identity' } },
      (res) => {
        // 响应结束/关闭即清理轮询定时器，避免长下载遗留定时器
        const cleanup = () => { if (abortTimer) { clearInterval(abortTimer); abortTimer = null; } };
        res.once('end', cleanup);
        res.once('close', cleanup);
        resolve(res);
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
    req.on('error', (e) => reject(e));
    // 取消轮询：仅在「尚未收到响应」或「响应进行中」时检测 signal
    abortTimer = setInterval(() => {
      if (signal.aborted) {
        if (abortTimer) { clearInterval(abortTimer); abortTimer = null; }
        req.destroy(new MitmCancelError());
      }
    }, 120);
    req.once('close', () => { if (abortTimer) { clearInterval(abortTimer); abortTimer = null; } });
    req.end();
  });
}

function followRedirect(
  url: string,
  method: 'HEAD' | 'GET',
  headers: Record<string, string>,
  timeoutMs: number,
  signal: { aborted: boolean },
  maxHops = 3
): Promise<http.IncomingMessage> {
  return requestOnce(url, method, headers, timeoutMs, signal).then((res) => {
    const code = res.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && maxHops > 0) {
      res.resume();
      const next = new URL(res.headers.location, url).toString();
      return followRedirect(next, method, headers, timeoutMs, signal, maxHops - 1);
    }
    return res;
  });
}

/** 校验产物：size 一致性 + mp4 magic(ftyp) + 可选 ffprobe 双流 */
export function validateOutput(
  filePath: string,
  expectedSize: number,
  ffprobeBin?: string
): Promise<MitmValidation> {
  return new Promise((resolve) => {
    let actualSize = 0;
    let headerHex = '';
    try {
      const stat = fs.statSync(filePath);
      actualSize = stat.size;
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      fs.closeSync(fd);
      headerHex = buf.toString('hex');
    } catch (e) {
      resolve({
        valid: false,
        sizeMatches: false,
        magicValid: false,
        actualSize: 0,
        expectedSize,
        headerHex: '',
        reason: `读取产物失败: ${(e as Error).message}`,
      });
      return;
    }

    // mp4/quicktime: 第 4-8 字节为 'ftyp'
    const magicValid = headerHex.slice(8, 16) === '66747970' || headerHex.startsWith('000000');
    const sizeMatches = expectedSize <= 0 || actualSize === expectedSize;
    const base: MitmValidation = {
      valid: magicValid && sizeMatches && actualSize > 0,
      sizeMatches,
      magicValid,
      actualSize,
      expectedSize,
      headerHex,
      reason: !magicValid
        ? '产物非有效 MP4(缺少 ftyp)'
        : !sizeMatches
          ? `大小不一致(实际 ${actualSize} / 期望 ${expectedSize})`
          : undefined,
    };

    if (!ffprobeBin || !base.valid) return resolve(base);
    execFile(
      ffprobeBin,
      ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', filePath],
      { timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve({ ...base, ffprobe: 'unavailable' });
        const streams = stdout.trim().split(/\r?\n/).filter(Boolean);
        const summary = streams.join('+') || 'none';
        resolve({ ...base, ffprobe: summary });
      }
    );
  });
}

/** 执行一次真实 HTTP 下载并返回校验结果 */
export async function runMitmDownload(opts: MitmDownloadOptions): Promise<MitmValidation> {
  const { url, headers, targetPath, timeoutMs, onProgress, signal, maxBytes = 0 } = opts;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  // 1) HEAD 探测总大小（失败不阻断，退回流式 GET）
  let expected = 0;
  try {
    const head = await followRedirect(url, 'HEAD', headers, timeoutMs, signal);
    const len = Number(head.headers['content-length'] || 0);
    if (Number.isFinite(len) && len > 0) expected = len;
    head.resume();
    if ((head.statusCode ?? 0) >= 400 && head.statusCode !== 405) {
      // 405 = 不支持 HEAD，属正常；其它 4xx/5xx 交给 GET 阶段报错
    }
  } catch (e) {
    if (e instanceof MitmCancelError) throw e;
    // HEAD 不可用则忽略
  }

  if (signal.aborted) throw new MitmCancelError();

  // 2) GET 流式写盘（优先单段，支持 206）
  const res = await followRedirect(url, 'GET', headers, timeoutMs, signal);
  const status = res.statusCode ?? 0;
  const bodyErr = await collectErrorIfAny(res, status);
  if (bodyErr) throw new Error(bodyErr);

  // 内容类型预检：分享页/落地页通常返回 text/html，直接拒绝并给出可读原因，
  // 避免把网页写成 .mp4 后出现难以理解的「缺少 ftyp」校验失败。
  const ctype = String(res.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
  const NON_MEDIA = ['text/html', 'application/json', 'text/plain', 'text/xml', 'application/xml', 'application/xhtml+xml'];
  if (NON_MEDIA.includes(ctype)) {
    res.resume(); // 丢弃响应体
    throw new Error(
      `响应 Content-Type=${ctype || '未知'}，不是视频流；该链接疑似分享页/落地页而非直链。` +
      `请通过 res-downloader 在客户端播放时抓包获取真实 .mp4 直链，或复制浏览器 Network 面板中的直链后粘贴。`
    );
  }
  const ctypeMedia = ctype !== '' && !NON_MEDIA.includes(ctype);

  const total = expected || Number(res.headers['content-length'] || 0) || 0;
  const partPath = `${targetPath}.part`;
  const started = Date.now();
  let downloaded = 0;
  let lastEmit = 0;
  let firstChunkChecked = false;

  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(partPath);
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      res.unpipe?.(ws);
      try { ws.destroy(); } catch { /* ignore */ }
      reject(e);
    };
    // 手动写入并处理背压：避免同时挂 data 监听 + pipe 造成丢块
    res.on('data', (chunk: Buffer) => {
      if (signal.aborted) return fail(new MitmCancelError());
      // 首块媒介特征强校验：当无媒体 Content-Type 时，若前导字节明显为文本/HTML/JSON，立即失败，
      // 不再把非媒体内容写成 .mp4。仅做只读检查，不消费数据流。
      if (!firstChunkChecked) {
        firstChunkChecked = true;
        if (!ctypeMedia) {
          const hex = chunk.slice(0, 16).toString('hex');
          const looksLikeText =
            hex.startsWith('3c21444f') /* <!DO */ ||
            hex.startsWith('3c68746d') /* <htm */ ||
            hex.startsWith('3c3f786d') /* <?xm */ ||
            hex.startsWith('7b22') /* {"  */ ||
            hex.startsWith('7b27'); /* {'  */
          if (looksLikeText) return fail(new Error(`响应内容疑似文本/HTML/JSON(${hex.slice(0, 16)})，不是视频流；该链接可能不是直链`));
        }
      }
      downloaded += chunk.length;
      if (maxBytes > 0 && downloaded > maxBytes) return fail(new Error('超出最大下载体积限制'));
      if (!ws.write(chunk)) res.pause();
      const now = Date.now();
      if (now - lastEmit > 120 || downloaded === total) {
        lastEmit = now;
        const elapsed = Math.max((now - started) / 1000, 0.001);
        const speed = downloaded / elapsed;
        onProgress({
          downloadedBytes: downloaded,
          fileSizeBytes: total,
          speedBytesPerSec: speed,
          etaSeconds: total > 0 && speed > 0 ? Math.max(0, (total - downloaded) / speed) : null,
        });
      }
    });
    ws.on('drain', () => res.resume());
    res.on('end', () => ws.end());
    res.on('error', fail);
    res.on('aborted', () => fail(new Error('远端中断连接')));
    ws.on('error', fail);
    ws.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });

  if (signal.aborted) throw new MitmCancelError();
  fs.renameSync(partPath, targetPath);
  return validateOutput(targetPath, total || expected);
}

async function collectErrorIfAny(res: http.IncomingMessage, status: number): Promise<string | null> {
  if (status >= 200 && status < 300) return null;
  let body = '';
  try {
    for await (const c of res) {
      body += c.toString();
      if (body.length > 400) break;
    }
  } catch {
    /* ignore */
  }
  let hint = '';
  try {
    const j = JSON.parse(body);
    hint = j?.error?.message || j?.message || '';
  } catch {
    hint = body.slice(0, 160);
  }
  if (status === 403) return `资源被防盗链拒绝(403)：${hint || '需正确 Referer/鉴权头'}`;
  if (status === 404) return `资源不存在(404)：${hint}`;
  return `HTTP ${status}：${hint}`;
}
