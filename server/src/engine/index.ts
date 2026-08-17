import { config } from '../config.js';
import { hasExecutable } from '../utils/file.js';
import { logger } from '../utils/logger.js';
import type { VideoEngine } from './simulate.js';
import { SimulateEngine } from './simulate.js';
import { YtDlpEngine } from './ytdlp.js';

let engine: VideoEngine | null = null;
let engineName = '';

/** 根据配置与系统能力选择下载引擎 */
export async function initEngine(): Promise<VideoEngine> {
  if (engine) return engine;
  if (config.engine === 'simulate') {
    engine = new SimulateEngine();
  } else if (config.engine === 'ytdlp') {
    engine = new YtDlpEngine();
  } else {
    // auto：yt-dlp 与 ffmpeg 同时可用才启用真实下载
    const hasYtdlp = await hasExecutable(config.ytdlpBin);
    const hasFfmpeg = await hasExecutable(config.ffmpegBin);
    if (hasYtdlp && hasFfmpeg) {
      engine = new YtDlpEngine();
    } else {
      logger.warn(
        `未检测到真实下载依赖（yt-dlp=${hasYtdlp}, ffmpeg=${hasFfmpeg}），降级为模拟引擎；` +
          `安装后重启或用 YTDLP_PATH / FFMPEG_PATH 指定路径可启用真实下载`
      );
      engine = new SimulateEngine();
    }
  }
  engineName = engine.name;
  logger.info(`下载引擎已初始化: ${engineName}`);
  return engine;
}

export function getEngine(): VideoEngine {
  if (!engine) throw new Error('engine not initialized');
  return engine;
}

export function getEngineName(): string {
  return engineName || 'unknown';
}
