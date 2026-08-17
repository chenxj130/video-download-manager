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
  webDist: resolveDir(
    process.env.WEB_DIST ?? '../web/dist',
    SERVER_DIR
  ),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  requestTimeoutSeconds: Number(process.env.REQUEST_TIMEOUT ?? 60),
  version: '1.0.0',
};

export function ensureDirs(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.downloadDir, { recursive: true });
}

export const paths = {
  dbFile: path.join(config.dataDir, 'app.db'),
  root: ROOT,
};
