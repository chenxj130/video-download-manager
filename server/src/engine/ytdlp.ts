import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { PLATFORMS } from '../constants.js';
import type {
  FileFormat,
  Platform,
  Resolution,
  VideoFormatOption,
  VideoMetadata,
} from '../types.js';
import { ApiError, mapEngineError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { AbortError, type DownloadContext, type DownloadHandle, type VideoEngine } from './simulate.js';

/**
 * 把命令名解析为绝对路径。
 * 关键修复：yt-dlp 的合并后处理器在 `--ffmpeg-location` 收到裸命令名（如 "ffmpeg"）时，
 * 在其子进程上下文里往往解析不到可执行文件，导致合并步骤被静默跳过（退出码仍 0），
 * 只留下 DASH 分离的视频/音频分流文件。传绝对路径可确保合并必然触发。
 */
function resolveBin(name: string): string {
  if (path.isAbsolute(name)) return name;
  try {
    const found = execSync(`command -v ${JSON.stringify(name)}`, { encoding: 'utf8' }).trim();
    return found || name;
  } catch {
    return name;
  }
}

/** 仅当系统已安装 yt-dlp + ffmpeg 时使用的真实下载引擎 */
export class YtDlpEngine implements VideoEngine {
  name = 'ytdlp';

  private async exec(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(config.ytdlpBin, args, { windowsHide: true });
      let out = '';
      let err = '';
      proc.stdout.on('data', (d) => (out += d.toString()));
      proc.stderr.on('data', (d) => (err += d.toString()));
      proc.on('error', (e) => reject(e));
      proc.on('close', (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(err || `yt-dlp exited ${code}`));
      });
    });
  }

  async parse(url: string): Promise<VideoMetadata> {
    let raw: string;
    try {
      raw = await this.exec(['-J', '--no-warnings', url]);
    } catch (e) {
      const mapped = mapEngineError(e);
      throw new ApiError(mapped.code, mapped.message, mapped.code === 'VIDEO_NOT_FOUND' ? 404 : 400);
    }
    let info: any;
    try {
      info = JSON.parse(raw);
    } catch {
      throw new ApiError('PARSE_FAILED', '解析返回数据异常', 400);
    }
    const host = new URL(url).hostname.toLowerCase();
    const meta = PLATFORMS.find((p) => p.hosts.some((h) => host.includes(h)));
    const platform = (meta?.key ?? 'unknown') as Platform;

    const formats: VideoFormatOption[] = [];
    const resSet = new Set<Resolution>();
    const fmtSet = new Set<FileFormat>();
    for (const f of info.formats ?? []) {
      const res = normalizeResolution(f.height);
      const ext = (f.ext as FileFormat) ?? 'mp4';
      if (!res) continue;
      resSet.add(res);
      fmtSet.add(ext);
      formats.push({
        resolution: res,
        format: ext,
        sizeBytes: f.filesize ?? f.filesize_approx,
        fps: f.fps,
      });
    }
    if (formats.length === 0) {
      // 兜底：仅音频
      formats.push({ resolution: '360p', format: 'mp4' });
      resSet.add('360p');
      fmtSet.add('mp4');
    }
    return {
      url,
      platform,
      platformName: meta?.name ?? '未知平台',
      title: info.title ?? '未命名视频',
      author: info.uploader ?? info.creator ?? info.channel ?? '',
      thumbnailUrl: info.thumbnail ?? '',
      durationSeconds: info.duration ?? 0,
      formats,
      availableResolutions: Array.from(resSet),
      availableFormats: Array.from(fmtSet),
      webpageUrl: info.webpage_url ?? url,
      simulated: false,
    };
  }

  createDownload(ctx: DownloadContext): DownloadHandle {
    return new YtDlpDownload(ctx);
  }
}

function normalizeResolution(height?: number): Resolution | null {
  if (!height) return null;
  const map: [number, Resolution][] = [
    [144, '144p'],
    [240, '240p'],
    [360, '360p'],
    [480, '480p'],
    [720, '720p'],
    [1080, '1080p'],
    [1440, '1440p'],
    [2160, '2160p'],
  ];
  let best: Resolution | null = null;
  for (const [h, r] of map) if (height >= h) best = r;
  return best;
}

/**
 * 构造 yt-dlp 格式选择表达式，规避「下载后无法播放」的根因：
 * 部分平台（YouTube 高分辨率档等）会优先提供 AV1(av01) 编码的 MP4 流，
 * 在 MP4/MKV 容器中结构合法，但 QuickTime Player 与多数默认浏览器无法解码。
 *
 * 策略：
 *  - mp4/mov：优先 H.264(avc1) 的 MP4 流；其次排除 av01/vp9 的任意流；最后兜底（仍可能命中 av01，由下载后探测+自动修复兜底）。
 *  - webm：容器本身浏览器友好，VP9/AV1 均可保留。
 *  - 其他容器(mkv 等)：不强制编码，优先可合并流。
 */
function buildFormatSelector(height: number, ext: string): string {
  if (ext === 'mp4' || ext === 'mov') {
    return [
      `bv*[height<=${height}][ext=mp4][vcodec*=avc1]+ba[ext=m4a]`,
      `bv*[height<=${height}][vcodec*=avc1]+ba[ext=m4a]`,
      `bv*[height<=${height}][vcodec!*=av01][vcodec!*=vp9]+ba`,
      `b[height<=${height}][ext=mp4][vcodec*=avc1]`,
      `b[height<=${height}][vcodec!*=av01][vcodec!*=vp9]`,
      `b[height<=${height}]`,
      'b',
    ].join('/');
  }
  if (ext === 'webm') {
    return [
      `bv*[height<=${height}][ext=webm]+ba[ext=webm]`,
      `bv*[height<=${height}]+ba`,
      `b[height<=${height}][ext=webm]`,
      `b[height<=${height}]`,
      'b',
    ].join('/');
  }
  return [
    `bv*[height<=${height}][ext=${ext}]+ba`,
    `bv*[height<=${height}]+ba`,
    `b[height<=${height}][ext=${ext}]`,
    `b[height<=${height}]`,
    'b',
  ].join('/');
}

interface ProgressPayload {
  downloadedBytes: number;
  fileSizeBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
}

class YtDlpDownload implements DownloadHandle {
  constructor(private ctx: DownloadContext) {}

  /** 由 run() 注入，把解析出的进度回传给任务管理器 */
  private emit: (p: ProgressPayload) => void = () => {};

  /**
   * 解析 --progress-template 输出的单行进度。
   * 形如：__VDM__ 1234567 28523658 NA 2150400.5 12
   * 缺失字段 yt-dlp 会输出 "NA"，需要按 0 处理。
   */
  private handleLine(line: string): void {
    const idx = line.indexOf('__VDM__');
    if (idx === -1) return;
    const parts = line.slice(idx + 7).trim().split(/\s+/);
    if (parts.length < 5) return;
    const num = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const downloadedBytes = num(parts[0]);
    // total_bytes 未知时退回 total_bytes_estimate
    const fileSizeBytes = num(parts[1]) || num(parts[2]);
    this.emit({
      downloadedBytes,
      fileSizeBytes,
      speedBytesPerSec: num(parts[3]),
      etaSeconds: num(parts[4]),
    });
  }

  async run(): Promise<{ filePath: string; fileSizeBytes: number }> {
    const { task, outDir, signal, onProgress, maxSpeedBytesPerSec } = this.ctx;
    const target = path.join(outDir, task.fileName);
    const height = parseInt(task.resolution) || 1080;
    const ext = task.format;

    // 音频格式：直接提取音频，避免用 merge-output-format 导致容器与后缀不一致。
    if (ext === 'mp3' || ext === 'm4a') {
      const args = [
        '-x',
        '--audio-format',
        ext,
        '--audio-quality',
        '0',
        '-o',
        target,
        '--newline',
        '--no-warnings',
        '--ffmpeg-location',
        resolveBin(config.ffmpegBin),
        // HLS(m3u8) 流改用 ffmpeg 拉取，比默认 hlsnative 容错更强，避免分片中断导致整段失败（X/Twitter 尤为明显）
        '--hls-prefer-ffmpeg',
        '--progress-template',
        'download:__VDM__ %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
        task.url,
      ];
      if (maxSpeedBytesPerSec > 0) {
        args.unshift('--limit-rate', `${Math.floor(maxSpeedBytesPerSec / 1024)}K`);
      }
      if (config.ytdlpKeepFragments) {
        args.unshift('--keep-fragments', '--concurrent-fragments', '1');
      }
      return this.runWithArgs(args, target);
    }

    // 高清源普遍是视频/音频分离流（DASH），必须 bv*+ba 组合再由 ffmpeg 合并，
    // 否则 best[...] 只会命中渐进式单流，YouTube 上实际上限被压到 360p，
    // 导致用户选择的分辨率形同虚设。逐级回退保证总能下到东西。
    // 关键修复：buildFormatSelector 会显式排除 AV1(av01)/VP9(vp9) 视频流并优先 H.264(avc1)，
    // 否则 yt-dlp 的 bv*[ext=mp4] 会命中 AV1-in-MP4，QuickTime / 多数浏览器无法解码 → 下载后无法播放。
    const formatSelector = buildFormatSelector(height, ext);
    // mov 不是 yt-dlp 的 merge-output-format 直接支持值，合并为 mp4 容器即可（.mov 扩展名保留）。
    const mergeFormat = ext === 'mov' ? 'mp4' : ext;
    const args = [
      '-f',
      formatSelector,
      '--merge-output-format',
      mergeFormat,
      '-o',
      target,
      '--newline',
      '--no-warnings',
      '--ffmpeg-location',
      resolveBin(config.ffmpegBin),
      // 用确定性模板输出进度，避免解析人类可读文本时因语言/单位差异失配。
      // yt-dlp 的进度默认写入 stdout，下方同时监听 stdout 与 stderr。
      '--progress-template',
      'download:__VDM__ %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
      task.url,
    ];
    if (maxSpeedBytesPerSec > 0) {
      args.unshift('--limit-rate', `${Math.floor(maxSpeedBytesPerSec / 1024)}K`);
    }
    if (config.ytdlpKeepFragments) {
      args.unshift('--keep-fragments', '--concurrent-fragments', '1');
    }
    return this.runWithArgs(args, target);
  }

  private runWithArgs(args: string[], target: string): Promise<{ filePath: string; fileSizeBytes: number }> {
    const { task, signal, onProgress } = this.ctx;
    return new Promise((resolve, reject) => {
      const proc = spawn(resolveBin(config.ytdlpBin), args, { windowsHide: true });
      let total = task.fileSizeBytes || 0;
      let downloaded = 0;
      const onAbort = () => proc.kill('SIGTERM');
      if (signal.aborted) return reject(new AbortError());
      signal.addEventListener('abort', onAbort);

      let buffer = '';
      const handleChunk = (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) this.handleLine(line);
      };
      // yt-dlp 进度默认写 stdout，警告/错误走 stderr；两路都监听
      // stderr 单独收集完整日志，失败时用来诊断根因；stdout 只含进度模板
      let errOutput = '';
      proc.stdout.on('data', handleChunk);
      proc.stderr.on('data', (d: Buffer) => {
        errOutput += d.toString();
        handleChunk(d);
      });

      this.emit = (p) => {
        downloaded = p.downloadedBytes;
        if (p.fileSizeBytes > 0) total = p.fileSizeBytes;
        onProgress(p);
      };
      proc.on('error', (e) => reject(e));
      proc.on('close', async (code) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) return reject(new AbortError());
        if (code !== 0) {
          const tail = errOutput.trim().split(/\r?\n/).slice(-8).join('\n') || '(无 stderr)';
          logger.error(`yt-dlp 失败 (exit ${code})，任务=${task.id}\n${tail}`);
          return reject(new Error(`yt-dlp exited ${code}: ${tail}`));
        }

        // 关键校验：退出码 0 不代表真正产出文件（DASH 合并可能被静默跳过）。
        if (!fs.existsSync(target)) {
          const merged = await this.fallbackMerge(target).catch(() => false);
          if (!merged) {
            this.cleanupFragments(target);
            return reject(
              new Error(
                `下载完成但未生成合并文件 ${path.basename(target)}：DASH 音视频流合并失败（ffmpeg 不可达），请确认 ffmpeg 已安装并在 PATH 中`
              )
            );
          }
        }
        // 成功：清理 yt-dlp 遗留的分流碎片（.f<fmt>.mp4 / .f<fmt>.m4a 等）
        this.cleanupFragments(target);
        const size = fs.statSync(target).size;
        resolve({ filePath: target, fileSizeBytes: size });
      });
    });
  }

  /** 合并被跳过时，用 ffmpeg 直接合并目录中遗留的视频/音频分流碎片 */
  private async fallbackMerge(target: string): Promise<boolean> {
    const base = target.slice(0, target.lastIndexOf('.'));
    const dir = path.dirname(target);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return false;
    }
    const frags = entries
      .filter((f) => f.startsWith(path.basename(base) + '.f'))
      .map((f) => path.join(dir, f));
    if (frags.length < 2) return false;

    const ff = resolveBin(config.ffmpegBin);
    const ffprobe = resolveBin('ffprobe');
    const classify = (file: string): 'video' | 'audio' | null => {
      try {
        const out = execSync(
          `"${ffprobe}" -v error -show_entries stream=codec_type -of csv=p=0 "${file}"`,
          { encoding: 'utf8' }
        );
        if (out.includes('video')) return 'video';
        if (out.includes('audio')) return 'audio';
      } catch {
        /* ignore */
      }
      return null;
    };
    const video = frags.find((f) => classify(f) === 'video');
    const audio = frags.find((f) => classify(f) === 'audio' && f !== video);
    if (!video) return false;
    const inputs = audio ? [video, audio] : [video];
    const cmd = [
      ff,
      '-y',
      ...inputs.flatMap((f) => ['-i', f]),
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      target,
    ];
    try {
      execSync(cmd.map((c) => JSON.stringify(c)).join(' '), { stdio: 'ignore' });
      return fs.existsSync(target) && fs.statSync(target).size > 0;
    } catch (e) {
      logger.error(`兜底合并失败，任务=${this.ctx.task.id}: ${(e as Error).message}`);
      return false;
    }
  }

  /** 删除 yt-dlp 遗留的分流碎片文件 */
  private cleanupFragments(target: string): void {
    const base = target.slice(0, target.lastIndexOf('.'));
    const dir = path.dirname(target);
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(path.basename(base) + '.f')) {
          fs.rmSync(path.join(dir, f), { force: true });
        }
      }
    } catch {
      /* ignore */
    }
  }
}

