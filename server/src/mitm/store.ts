import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { MitmPlatform, MitmTask, MitmValidation } from './types.js';
import { runMitmDownload, MitmCancelError, validateOutput } from './downloader.js';
import { probeUrl, safeFileName } from './platforms.js';
import { logger } from '../utils/logger.js';

/**
 * MITM 任务存储与调度：内存 Map + JSON 落盘持久化。
 * 与现有 SQLite 任务表完全隔离，互不影响；服务重启后自动恢复已完成任务记录。
 */

export interface CreateMitmTaskInput {
  url: string;
  platform?: MitmPlatform | 'unknown';
  title?: string;
  headers?: Record<string, string>;
  source?: 'fixture' | 'external' | 'bridge';
}

interface RunSignal { aborted: boolean }

export class MitmStore {
  private tasks = new Map<string, MitmTask>();
  private signals = new Map<string, RunSignal>();
  private queue: string[] = [];
  private active = 0;
  private maxConcurrent: number;
  private timeoutMs: number;
  private downloadDir: string;
  private persistFile: string;
  private ffprobeBin: string | undefined;
  private baseUrl: string;

  constructor(opts: {
    maxConcurrent: number;
    timeoutMs: number;
    downloadDir: string;
    persistFile: string;
    ffprobeBin?: string;
    baseUrl: string;
  }) {
    this.maxConcurrent = Math.max(1, opts.maxConcurrent);
    this.timeoutMs = opts.timeoutMs;
    this.downloadDir = opts.downloadDir;
    this.persistFile = opts.persistFile;
    this.ffprobeBin = opts.ffprobeBin;
    this.baseUrl = opts.baseUrl;
    fs.mkdirSync(this.downloadDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.persistFile), { recursive: true });
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.persistFile)) return;
      const arr: MitmTask[] = JSON.parse(fs.readFileSync(this.persistFile, 'utf8'));
      for (const t of arr) {
        // 重启恢复：进行中的任务标记为失败（需重试），完成态校验文件仍在
        if (t.status === 'downloading' || t.status === 'waiting') {
          t.status = 'failed';
          t.errorCode = 'INTERRUPTED';
          t.errorMessage = '服务重启导致下载中断，请重试';
        }
        if (t.status === 'completed' && (!t.filePath || !fs.existsSync(t.filePath))) {
          t.status = 'failed';
          t.errorCode = 'FILE_MISSING';
          t.errorMessage = '产物文件已不在磁盘上';
        }
        this.tasks.set(t.id, t);
      }
      logger.info(`MITM 已恢复 ${this.tasks.size} 条任务记录`);
    } catch (e) {
      logger.warn(`MITM 任务记录读取失败(忽略): ${(e as Error).message}`);
    }
  }

  private persist(): void {
    try {
      const arr = Array.from(this.tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const tmp = `${this.persistFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
      fs.renameSync(tmp, this.persistFile);
    } catch (e) {
      logger.warn(`MITM 任务记录写入失败(忽略): ${(e as Error).message}`);
    }
  }

  list(): MitmTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): MitmTask | undefined {
    return this.tasks.get(id);
  }

  create(input: CreateMitmTaskInput): MitmTask {
    const probe = probeUrl(input.url);
    const platform = (input.platform && input.platform !== 'unknown' ? input.platform : probe.platform);
    const adapterHeaders = probe.headers;
    const suffix = probe.suffix;
    const baseName = safeFileName(input.title || probe.suggestedName);
    const id = randomUUID();
    const fileName = `${baseName}-${id.slice(0, 6)}${suffix}`;
    const filePath = path.join(this.downloadDir, fileName);
    const now = new Date().toISOString();
    const source: 'fixture' | 'external' | 'bridge' =
      input.source ?? (probe.isLocalSource ? 'fixture' : 'external');

    const task: MitmTask = {
      id,
      url: input.url,
      platform,
      platformName: probe.matched ? probe.platformName : (platform === 'unknown' ? '外部直链' : probe.platformName),
      title: input.title || baseName,
      fileName,
      filePath,
      suffix,
      status: 'waiting',
      progress: 0,
      downloadedBytes: 0,
      fileSizeBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: null,
      source,
      headers: { ...adapterHeaders, ...(input.headers ?? {}) },
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    this.persist();
    this.enqueue(id);
    return task;
  }

  private enqueue(id: string): void {
    this.queue.push(id);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const t = this.tasks.get(id);
      if (!t || t.status !== 'waiting') continue;
      this.active++;
      void this.run(id).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(id: string): Promise<void> {
    const t = this.tasks.get(id);
    if (!t) return;
    t.status = 'downloading';
    t.updatedAt = new Date().toISOString();
    this.persist();
    const signal: RunSignal = { aborted: false };
    this.signals.set(id, signal);

    try {
      const validation = await runMitmDownload({
        url: t.url,
        headers: t.headers,
        targetPath: t.filePath,
        timeoutMs: this.timeoutMs,
        onProgress: (p) => {
          t.downloadedBytes = p.downloadedBytes;
          t.fileSizeBytes = p.fileSizeBytes;
          t.speedBytesPerSec = p.speedBytesPerSec;
          t.etaSeconds = p.etaSeconds;
          t.progress = p.fileSizeBytes > 0
            ? Math.min(100, Math.round((p.downloadedBytes / p.fileSizeBytes) * 100))
            : (p.downloadedBytes > 0 ? 99 : 0);
          t.updatedAt = new Date().toISOString();
        },
        signal,
        maxBytes: 2 * 1024 * 1024 * 1024, // 2GB 上限，防止异常响应撑爆磁盘
      });

      if (!validation.valid) {
        t.status = 'failed';
        t.errorCode = 'VALIDATION_FAILED';
        t.errorMessage = validation.reason || '产物校验失败';
      } else {
        t.status = 'completed';
        t.progress = 100;
        t.downloadedBytes = validation.actualSize;
        t.fileSizeBytes = validation.actualSize || t.fileSizeBytes;
        t.completedAt = new Date().toISOString();
        t.etaSeconds = 0;
      }
      // 把 ffprobe / magic / size 校验结果挂到任务上（前端可展示）
      (t as MitmTask & { validation?: MitmValidation }).validation = validation;
    } catch (e) {
      if (e instanceof MitmCancelError || signal.aborted) {
        t.status = 'cancelled';
        t.errorMessage = '已取消';
      } else {
        t.status = 'failed';
        t.errorCode = mapErrCode((e as Error).message);
        t.errorMessage = (e as Error).message;
        logger.warn(`MITM 下载失败 任务=${id.slice(0, 8)} ${t.errorMessage}`);
      }
    } finally {
      this.signals.delete(id);
      t.updatedAt = new Date().toISOString();
      this.persist();
    }
  }

  cancel(id: string): MitmTask | undefined {
    const t = this.tasks.get(id);
    if (!t) return undefined;
    const s = this.signals.get(id);
    if (s) s.aborted = true;
    if (t.status === 'waiting' || t.status === 'downloading') {
      t.status = 'cancelled';
      t.errorMessage = '已取消';
      t.updatedAt = new Date().toISOString();
      this.persist();
    }
    return t;
  }

  retry(id: string): MitmTask | undefined {
    const t = this.tasks.get(id);
    if (!t) return undefined;
    if (t.status !== 'failed' && t.status !== 'cancelled') return t;
    t.status = 'waiting';
    t.progress = 0;
    t.downloadedBytes = 0;
    t.speedBytesPerSec = 0;
    t.errorCode = undefined;
    t.errorMessage = undefined;
    t.updatedAt = new Date().toISOString();
    this.persist();
    this.enqueue(id);
    return t;
  }

  remove(id: string, deleteFile: boolean): { ok: boolean; deletedFile: boolean } {
    const t = this.tasks.get(id);
    if (!t) return { ok: false, deletedFile: false };
    if (t.status === 'downloading') this.cancel(id);
    let deletedFile = false;
    if (deleteFile && t.filePath && fs.existsSync(t.filePath)) {
      try { fs.unlinkSync(t.filePath); deletedFile = true; } catch { /* ignore */ }
    }
    this.tasks.delete(id);
    this.persist();
    return { ok: true, deletedFile };
  }

  /** 重新校验一个已完成任务的产物（供验收接口调用） */
  async revalidate(id: string): Promise<MitmValidationLike | null> {
    const t = this.tasks.get(id);
    if (!t) return null;
    if (!fs.existsSync(t.filePath)) {
      return {
        valid: false, sizeMatches: false, magicValid: false,
        reason: '文件不存在', actualSize: 0, expectedSize: t.fileSizeBytes, headerHex: '',
      };
    }
    return validateOutput(t.filePath, t.fileSizeBytes, this.ffprobeBin);
  }

  /** 各下载器通道的真实可访问性探测（走本机 HTTP，带正确 Referer） */
  async probeDownloader(platform: MitmPlatform): Promise<{ reachable: boolean; httpStatus: number | null; latencyMs: number | null }> {
    const { demoUrl } = await import('./fixture.js');
    const { buildHeaders } = await import('./platforms.js');
    const url = demoUrl(this.baseUrl, platform);
    const started = Date.now();
    return new Promise((resolve) => {
      try {
        const u = new URL(url);
        const req = http.request(u, { method: 'GET', headers: buildHeaders(platform) }, (res) => {
          res.resume();
          resolve({ reachable: res.statusCode === 200 || res.statusCode === 206, httpStatus: res.statusCode ?? null, latencyMs: Date.now() - started });
        });
        req.setTimeout(3000, () => req.destroy(new Error('timeout')));
        req.on('error', () => resolve({ reachable: false, httpStatus: null, latencyMs: null }));
        req.end();
      } catch {
        resolve({ reachable: false, httpStatus: null, latencyMs: null });
      }
    });
  }
}

type MitmValidationLike = Awaited<ReturnType<typeof validateOutput>>;

function mapErrCode(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('403') || m.includes('防盗链')) return 'HOTLINK_BLOCKED';
  if (m.includes('404')) return 'NOT_FOUND';
  if (m.includes('超时') || m.includes('timeout')) return 'TIMEOUT';
  if (m.includes('enotfound') || m.includes('econn') || m.includes('网络')) return 'NETWORK_ERROR';
  if (m.includes('非法 url')) return 'INVALID_URL';
  return 'DOWNLOAD_FAILED';
}
