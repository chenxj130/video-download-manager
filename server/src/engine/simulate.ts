import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PLATFORMS } from '../constants.js';
import type {
  FileFormat,
  Platform,
  Platform as P,
  Resolution,
  VideoFormatOption,
  VideoMetadata,
} from '../types.js';
import { hashString, sanitizeFileName, clamp } from '../utils/format.js';
import { extractFaultCode } from '../platforms.js';
import { ApiError } from '../utils/errors.js';
import { SIMULATE_MAX_BYTES, SIMULATE_MIN_BYTES } from '../constants.js';
import { config } from '../config.js';
import { hasExecutable, getFileSize, removeFileSafe } from '../utils/file.js';

export interface ProgressUpdate {
  downloadedBytes: number;
  fileSizeBytes: number;
  speedBytesPerSec: number;
  etaSeconds?: number;
}

export interface DownloadContext {
  task: import('../types.js').DownloadTask;
  outDir: string;
  startBytes: number;
  resume: boolean;
  maxSpeedBytesPerSec: number;
  requestTimeoutSeconds: number;
  signal: AbortSignal;
  onProgress: (p: ProgressUpdate) => void;
}

export interface DownloadResult {
  filePath: string;
  fileSizeBytes: number;
}

export interface DownloadHandle {
  run(): Promise<DownloadResult>;
}

export interface VideoEngine {
  name: string;
  parse(url: string): Promise<VideoMetadata>;
  createDownload(ctx: DownloadContext): DownloadHandle;
}

/** 生成内联 SVG 缩略图（data URI），离线可用、稳定 */
function makeThumbnail(platformName: string, color: string, title: string): string {
  const safeTitle = title.slice(0, 40).replace(/[<>&]/g, '');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'>
  <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
  <stop offset='0' stop-color='${color}'/><stop offset='1' stop-color='#0f172a'/></linearGradient></defs>
  <rect width='480' height='270' fill='url(#g)'/>
  <circle cx='240' cy='135' r='46' fill='rgba(255,255,255,0.92)'/>
  <polygon points='226,112 226,158 268,135' fill='${color}'/>
  <text x='24' y='246' fill='white' font-family='sans-serif' font-size='22' font-weight='700'>${platformName}</text>
  <text x='24' y='40' fill='rgba(255,255,255,0.85)' font-family='sans-serif' font-size='16'>${safeTitle}</text>
</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const SAMPLE_TITLES: Record<string, string[]> = {
  youtube: [
    'DeepSeek V4 Pro 完整测试',
    '2024 年度最佳剪辑合集',
    '从零开始学习全栈开发',
    '城市夜景 4K 延时摄影',
    '深度访谈：AI 时代的工程师',
  ],
  bilibili: [
    '【4K】治愈系风景混剪',
    '硬核拆解：一台路由器的内部',
    '本期视频教你三分钟做蛋炒饭',
    '游戏实况：开放世界探索日记',
    '我把房间改造成了赛博朋克风',
  ],
  vimeo: [
    'Independent Short Film - Teaser',
    'Brand Story: Crafting by Hand',
    'Aerial Journey Across Mountains',
    'Documentary: Life by the Sea',
  ],
  x: [
    'Breaking: Tech Keynote Recap',
    'Quick Take: Market Movements',
    'Behind the Scenes Thread 🧵',
  ],
  tiktok: [
    '30 秒学会这个生活小技巧',
    '今日份的快乐源泉',
    '街头美食探店 vlog',
  ],
  instagram: [
    'Sunset Vibes 🌅 Reel',
    'Travel Diary: Lisbon',
    'Workout Routine of the Week',
  ],
};

const SAMPLE_AUTHORS: Record<string, string[]> = {
  youtube: ['科技前沿', 'CodeLab', '影像志', '知识胶囊'],
  bilibili: ['UP主阿杰', '万物研究所', '厨房小当家'],
  vimeo: ['Studio North', 'Indie Films', 'Aerial Co'],
  x: ['@techdaily', '@marketwatch'],
  tiktok: ['@lifehacks', '@foodie'],
  instagram: ['@wanderlust', '@fitclub'],
};

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function buildFormats(
  platform: string,
  resolutionCap: Resolution,
  durationSec: number,
  seed: number
): { formats: VideoFormatOption[]; resolutions: Resolution[]; fileFormats: FileFormat[]; estimated: number } {
  const allRes: Resolution[] = [
    '144p',
    '240p',
    '360p',
    '480p',
    '720p',
    '1080p',
    '1440p',
    '2160p',
  ];
  const capIndex = allRes.indexOf(resolutionCap);
  const resolutions = allRes.slice(0, capIndex + 1);
  const fileFormats: FileFormat[] = ['mp4', 'webm', 'mkv', 'mov'];
  if (platform === 'youtube' || platform === 'bilibili') fileFormats.push('m4a', 'mp3');

  const perMinute: Record<Resolution, number> = {
    '144p': 4 * 1024 * 1024,
    '240p': 8 * 1024 * 1024,
    '360p': 14 * 1024 * 1024,
    '480p': 24 * 1024 * 1024,
    '720p': 45 * 1024 * 1024,
    '1080p': 85 * 1024 * 1024,
    '1440p': 160 * 1024 * 1024,
    '2160p': 320 * 1024 * 1024,
  };
  const mins = Math.max(0.2, durationSec / 60);
  const formats: VideoFormatOption[] = [];
  resolutions.forEach((r, ri) => {
    fileFormats.forEach((f) => {
      const base = perMinute[r] * mins;
      const size = Math.round(base * (0.8 + ((seed + ri) % 5) * 0.06));
      formats.push({
        resolution: r,
        format: f,
        sizeBytes: size,
        fps: r === '2160p' ? 30 : r === '1440p' ? 60 : 30,
      });
    });
  });
  // 估算体积：取 1080p mp4（或更优）
  const defaultRes = resolutions.includes('1080p') ? '1080p' : resolutions[resolutions.length - 1];
  const estimated =
    formats.find((f) => f.resolution === defaultRes && f.format === 'mp4')?.sizeBytes ??
    formats[0]?.sizeBytes ??
    SIMULATE_MIN_BYTES;
  return { formats, resolutions, fileFormats, estimated };
}

/** 模拟引擎：离线可用，写入真实文件 */
export class SimulateEngine implements VideoEngine {
  name = 'simulate';

  async parse(url: string): Promise<VideoMetadata> {
    const host = new URL(url).hostname.toLowerCase();
    const platformMeta =
      PLATFORMS.find((p) => p.hosts.some((h) => host.includes(h))) ?? PLATFORMS[0];
    const platform = platformMeta.key as P;
    const seed = hashString(url);
    const titles = SAMPLE_TITLES[platform] ?? ['精彩视频'];
    const authors = SAMPLE_AUTHORS[platform] ?? ['匿名创作者'];
    const title = pick(titles, seed);
    const author = pick(authors, seed >> 3);
    const durationSeconds = 30 + (seed % 1500); // 30s - ~25min
    const resolutionCap: Resolution =
      platform === 'youtube' ? '2160p' : platform === 'bilibili' ? '1080p' : '1080p';
    const { formats, resolutions, fileFormats, estimated } = buildFormats(
      platform,
      resolutionCap,
      durationSeconds,
      seed
    );
    // 模拟体积上限保护磁盘
    const simulatedSize = clamp(estimated, SIMULATE_MIN_BYTES, SIMULATE_MAX_BYTES);
    return {
      url,
      platform,
      platformName: platformMeta.name,
      title,
      author,
      thumbnailUrl: makeThumbnail(platformMeta.name, platformMeta.color, title),
      durationSeconds,
      formats,
      availableResolutions: resolutions,
      availableFormats: fileFormats,
      webpageUrl: url,
      simulated: true,
      estimatedBytes: simulatedSize,
    };
  }

  createDownload(ctx: DownloadContext): DownloadHandle {
    return new SimulateDownload(ctx);
  }
}

class SimulateDownload implements DownloadHandle {
  constructor(private ctx: DownloadContext) {}

  async run(): Promise<DownloadResult> {
    const { task, outDir, startBytes, resume, signal } = this.ctx;
    const filePath = path.join(outDir, task.fileName);
    const total = task.fileSizeBytes;

    // 故障注入（用于演示错误处理，确定性、可测试）
    const fault = extractFaultCode(task.url);
    if (fault) {
      await delay(600);
      if (signal.aborted) throw new AbortError();
      throw faultToError(fault);
    }

    // 如果启用且 ffmpeg 可用，生成可被播放器识别的真实占位视频；否则回退到快速字节填充。
    // 注：续传场景暂不支持 ffmpeg 占位生成，回退到旧方案。
    if (config.simulateUseFfmpeg && !(startBytes > 0 && resume) && (await hasExecutable(config.ffmpegBin))) {
      return createValidPlaceholder({ ...this.ctx, filePath, total });
    }

    return this.runFallback(filePath, total);
  }

  private async runFallback(filePath: string, total: number): Promise<DownloadResult> {
    const { task, startBytes, maxSpeedBytesPerSec, signal, onProgress } = this.ctx;
    const flag = fs.existsSync(filePath) ? 'a' : 'w';
    const stream = fs.createWriteStream(filePath, { flags: flag });
    let written = startBytes;
    // 模拟速度：4~10 MB/s，基于 id 确定性
    const baseSpeed = (4 + (hashString(task.id) % 60) / 10) * 1024 * 1024;
    const speed = maxSpeedBytesPerSec > 0 ? Math.min(baseSpeed, maxSpeedBytesPerSec) : baseSpeed;
    // chunk 需大于 baseSpeed*tick，否则有效吞吐被 chunk 限制。
    // 1MB/60ms ≈ 4~10MB/s，与 baseSpeed 匹配。
    const chunkSize = 1024 * 1024;
    const tickMs = 60;
    const startedAt = Date.now();

    try {
      while (written < total) {
        if (signal.aborted) {
          stream.end();
          throw new AbortError();
        }
        const now = Date.now();
        const elapsed = (now - startedAt) / 1000;
        const target = Math.min(total, Math.floor(speed * elapsed) + startBytes);
        const toWrite = Math.min(chunkSize, target - written);
        if (toWrite > 0) {
          const buf = Buffer.alloc(toWrite, 0x42);
          await writeAsync(stream, buf);
          written += toWrite;
        } else {
          await delay(tickMs);
        }
        onProgress({
          downloadedBytes: written,
          fileSizeBytes: total,
          speedBytesPerSec: speed,
          etaSeconds: speed > 0 ? Math.ceil((total - written) / speed) : undefined,
        });
        await delay(tickMs);
      }
      await endAsync(stream);
      return { filePath, fileSizeBytes: written };
    } catch (err) {
      stream.destroy();
      throw err;
    }
  }
}

interface PlaceholderProfile {
  ext: string;
  container: string;
  vcodec: string;
  acodec: string;
}

const DIMS: Record<string, [number, number]> = {
  '144p': [256, 144],
  '240p': [426, 240],
  '360p': [640, 360],
  '480p': [854, 480],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '2160p': [3840, 2160],
};

const VIDEO_PROFILES: Record<string, PlaceholderProfile> = {
  mp4: { ext: 'mp4', container: 'mp4', vcodec: 'libx264', acodec: 'aac' },
  mov: { ext: 'mov', container: 'mov', vcodec: 'libx264', acodec: 'aac' },
  mkv: { ext: 'mkv', container: 'matroska', vcodec: 'libx264', acodec: 'aac' },
  webm: { ext: 'webm', container: 'webm', vcodec: 'libvpx-vp9', acodec: 'libopus' },
  m4a: { ext: 'm4a', container: 'mp4', vcodec: '', acodec: 'aac' },
  mp3: { ext: 'mp3', container: 'mp3', vcodec: '', acodec: 'libmp3lame' },
};

function getPlaceholderProfile(format: string): PlaceholderProfile {
  return VIDEO_PROFILES[format] ?? VIDEO_PROFILES.mp4;
}

function resolutionToDim(resolution: string): [number, number] {
  return DIMS[resolution] ?? [1280, 720];
}

interface PlaceholderContext extends DownloadContext {
  filePath: string;
  total: number;
}

function buildFfmpegArgs(
  profile: PlaceholderProfile,
  opts: {
    w: number;
    h: number;
    durationSec: number;
    videoBitrateK: number;
    audioBitrateK: number;
    total: number;
    tmpPath: string;
  }
): string[] {
  const { w, h, durationSec, videoBitrateK, audioBitrateK, total, tmpPath } = opts;
  const inputVideo = ['-f', 'lavfi', '-i', `testsrc=duration=${durationSec}:size=${w}x${h}:rate=1`];
  const inputAudio = ['-f', 'lavfi', '-i', `sine=duration=${durationSec}`];

  if (profile.vcodec && profile.acodec) {
    return [
      '-y', '-hide_banner', '-loglevel', 'error',
      ...inputVideo,
      ...inputAudio,
      '-c:v', profile.vcodec,
      '-b:v', `${videoBitrateK}k`,
      '-pix_fmt', 'yuv420p',
      '-c:a', profile.acodec,
      '-b:a', `${audioBitrateK}k`,
      '-fs', String(total),
      '-f', profile.container,
      tmpPath,
    ];
  }
  if (profile.acodec) {
    return [
      '-y', '-hide_banner', '-loglevel', 'error',
      ...inputAudio,
      '-c:a', profile.acodec,
      '-b:a', `${audioBitrateK || 192}k`,
      '-fs', String(total),
      '-f', profile.container,
      tmpPath,
    ];
  }
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...inputVideo,
    '-c:v', profile.vcodec,
    '-b:v', `${videoBitrateK}k`,
    '-pix_fmt', 'yuv420p',
    '-fs', String(total),
    '-f', profile.container,
    tmpPath,
  ];
}

async function createValidPlaceholder(ctx: PlaceholderContext): Promise<DownloadResult> {
  const { task, filePath, total, signal, onProgress, outDir } = ctx;

  // 清理旧文件（重试/复用任务时）
  removeFileSafe(filePath);

  const profile = getPlaceholderProfile(task.format);
  const [w, h] = resolutionToDim(task.resolution);
  const durationSec = Math.max(10, Math.min(180, Math.floor(total / (2 * 1024 * 1024))));
  const audioBitrateK = profile.acodec ? 128 : 0;
  const videoBitrateK = Math.max(
    100,
    Math.floor((total * 8) / (durationSec * 1000)) - audioBitrateK
  );

  const tmpPath = path.join(outDir, `${task.id}.vdm.tmp.${profile.ext}`);
  const finalPath = deriveFinalPath(filePath, profile.ext);

  const args = buildFfmpegArgs(profile, { w, h, durationSec, videoBitrateK, audioBitrateK, total, tmpPath });

  try {
    return await runFfmpegPlaceholder({ args, tmpPath, finalPath, total, signal, onProgress });
  } catch (err) {
    // 若原格式（如 webm）编码器不可用，回退到 mp4 容器再试一次，保证文件可播放。
    if (profile.ext !== 'mp4') {
      const fallback = VIDEO_PROFILES.mp4;
      const fbTmpPath = path.join(outDir, `${task.id}.vdm.tmp.${fallback.ext}`);
      const fbFinalPath = deriveFinalPath(filePath, fallback.ext);
      const fbArgs = buildFfmpegArgs(fallback, {
        w, h, durationSec, videoBitrateK, audioBitrateK: fallback.acodec ? 128 : 0, total, tmpPath: fbTmpPath,
      });
      return runFfmpegPlaceholder({
        args: fbArgs,
        tmpPath: fbTmpPath,
        finalPath: fbFinalPath,
        total,
        signal,
        onProgress,
      });
    }
    throw err;
  }
}

function deriveFinalPath(filePath: string, ext: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${ext}`);
}

interface RunPlaceholderOpts {
  args: string[];
  tmpPath: string;
  finalPath: string;
  total: number;
  signal: AbortSignal;
  onProgress: (p: ProgressUpdate) => void;
}

async function runFfmpegPlaceholder(opts: RunPlaceholderOpts): Promise<DownloadResult> {
  const { args, tmpPath, finalPath, total, signal, onProgress } = opts;

  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    let lastReported = 0;

    const onAbort = () => {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    };

    if (signal.aborted) {
      onAbort();
      reject(new AbortError());
      return;
    }
    signal.addEventListener('abort', onAbort);

    const timer = setInterval(() => {
      const size = getFileSize(tmpPath);
      if (size > lastReported) {
        onProgress({
          downloadedBytes: Math.min(size, total),
          fileSizeBytes: total,
          speedBytesPerSec: size - lastReported,
          etaSeconds: size >= total ? 0 : Math.max(0, Math.ceil((total - size) / Math.max(1, size - lastReported))),
        });
        lastReported = size;
      }
    }, 400);

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('error', (e) => {
      clearInterval(timer);
      signal.removeEventListener('abort', onAbort);
      removeFileSafe(tmpPath);
      reject(e);
    });

    proc.on('close', (code) => {
      clearInterval(timer);
      signal.removeEventListener('abort', onAbort);

      const tmpSize = getFileSize(tmpPath);

      if (signal.aborted) {
        removeFileSafe(tmpPath);
        reject(new AbortError());
        return;
      }

      // -fs 正常结束时可能返回非 0，因此以"有输出文件"作为成功标准
      if (tmpSize > 0) {
        try {
          fs.renameSync(tmpPath, finalPath);
        } catch (e) {
          removeFileSafe(tmpPath);
          reject(e);
          return;
        }
        const finalSize = getFileSize(finalPath);
        onProgress({
          downloadedBytes: finalSize,
          fileSizeBytes: total,
          speedBytesPerSec: 0,
          etaSeconds: 0,
        });
        resolve({ filePath: finalPath, fileSizeBytes: finalSize });
        return;
      }

      removeFileSafe(tmpPath);
      reject(new Error(`占位视频生成失败 (code=${code}): ${stderr}`));
    });
  });
}

function faultToError(fault: string): ApiError {
  switch (fault) {
    case 'notfound':
      return new ApiError('VIDEO_NOT_FOUND', '视频不存在', 404);
    case 'forbidden':
    case 'private':
      return new ApiError('VIDEO_FORBIDDEN', '视频资源不可访问（可能需要授权）', 403);
    case 'unavailable':
      return new ApiError('VIDEO_UNAVAILABLE', '视频资源暂不可访问', 409);
    case 'network':
      return new ApiError('NETWORK_ERROR', '网络连接中断', 0);
    case 'timeout':
      return new ApiError('TIMEOUT', '下载超时', 0);
    case 'disk':
      return new ApiError('DISK_FULL', '磁盘空间不足', 0);
    case 'write':
      return new ApiError('WRITE_FAILED', '文件写入失败', 0);
    default:
      return new ApiError('PARSE_FAILED', '解析失败', 0);
  }
}

export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

function writeAsync(stream: fs.WriteStream, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(buf, (err) => (err ? reject(err) : resolve()));
  });
}
function endAsync(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
