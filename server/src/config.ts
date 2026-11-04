import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDataDir(raw: string): string {
  if (path.isAbsolute(raw)) return raw;
  // 相对于项目根（server 的上一级）
  return path.resolve(__dirname, '..', '..', raw);
}

function resolveDir(raw: string, base: string): string {
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(base, raw);
}

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_DIR = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: resolveDataDir(process.env.DATA_DIR ?? './data'),
  downloadDir: resolveDir(
    process.env.DOWNLOAD_DIR ?? './downloads',
    ROOT
  ),
  engine: (process.env.DOWNLOAD_ENGINE ?? 'auto') as
    | 'auto'
    | 'ytdlp'
    | 'simulate',
  maxConcurrent: Number(process.env.MAX_CONCURRENT ?? 3),
  /** yt-dlp 可执行文件：可为命令名（走 PATH）或绝对路径 */
  ytdlpBin: process.env.YTDLP_PATH ?? 'yt-dlp',
  /** ffmpeg 可执行文件：可为命令名（走 PATH）或绝对路径 */
  ffmpegBin: process.env.FFMPEG_PATH ?? 'ffmpeg',
  /**
   * simulate 引擎是否用 ffmpeg 生成可播放的真实占位视频。
   * 默认 true；设为 0 可回退到旧版快速占位字节（用于测试或无需预览场景）。
   */
  simulateUseFfmpeg: process.env.SIMULATE_USE_FFMPEG !== '0',
  /**
   * yt-dlp 是否保留 HLS 临时分片（--keep-fragments）。
   * 某些沙箱/安全环境会在批量删除分片时拦截进程，开启后可避免被误杀。
   * 默认 false；设为 1 开启。开启后片段不会自动清理，需定期手动清理下载目录。
   */
  ytdlpKeepFragments: process.env.YTDLP_KEEP_FRAGMENTS === '1',
  /**
   * 下载完成后是否自动探测媒体编码，并对不兼容编码（典型为 AV1/VP9 封装在 MP4/MKV 中，
   * QuickTime 与多数默认播放器无法解码）自动转码为 H.264+AAC。
   * 默认开启；设为 0 则仅标记不兼容、不自动转码（可在前端手动点击「修复」）。
   */
  autoRepairIncompatible: process.env.AUTO_REPAIR_INCOMPATIBLE !== '0',
  /** ffprobe 可执行文件：可为命令名（走 PATH）或绝对路径，用于下载后媒体编码探测 */
  ffprobeBin: process.env.FFPROBE_PATH ?? 'ffprobe',
  webDist: resolveDir(
    process.env.WEB_DIST ?? '../web/dist',
    SERVER_DIR
  ),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  requestTimeoutSeconds: Number(process.env.REQUEST_TIMEOUT ?? 60),
  version: '1.1.2',
  /** MITM 嗅探下载接入层（与现有功能完全隔离） */
  mitm: {
    /** 是否启用接入层；默认开启 */
    enabled: process.env.MITM_ENABLED !== '0',
    /** 是否桥接真实第三方 res-downloader :8899；默认开启（不可达时自动降级） */
    bridgeEnabled: process.env.MITM_BRIDGE !== '0',
    bridgeUrl: process.env.MITM_BRIDGE_URL ?? 'http://127.0.0.1:8899',
    /** 内置确定性 CDN 源开关（含演示直链）；默认开启 */
    fixtureEnabled: process.env.MITM_FIXTURE !== '0',
    /** MITM 下载产物独立目录，避免与现有任务产物混淆 */
    downloadDir: resolveDir(process.env.MITM_DOWNLOAD_DIR ?? './downloads/mitm', ROOT),
    /** 任务记录持久化文件 */
    persistFile: path.join(resolveDataDir(process.env.DATA_DIR ?? './data'), 'mitm-tasks.json'),
    maxConcurrent: Number(process.env.MITM_MAX_CONCURRENT ?? 3),
    timeoutMs: Number(process.env.MITM_TIMEOUT_MS ?? 120000),
    /** 本服务对外基址，用于拼接内置 fixture 演示直链 */
    baseUrl: process.env.MITM_BASE_URL ?? `http://127.0.0.1:${Number(process.env.PORT ?? 8787)}`,
    ffprobeBin: process.env.MITM_FFPROBE_PATH ?? 'ffprobe',
  },
};

export function ensureDirs(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.downloadDir, { recursive: true });
}

export const paths = {
  dbFile: path.join(config.dataDir, 'app.db'),
  root: ROOT,
};
