import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from './logger.js';
import { hasExecutable, removeFileSafe } from './file.js';
import { ApiError } from './errors.js';
import type { TaskMedia } from '../types.js';

/**
 * 下载后媒体探测与修复工具。
 *
 * 关键背景：yt-dlp 在部分平台（如 YouTube 高分辨率档）会优先返回 AV1 编码的 MP4 流。
 * AV1(av01) 在 MP4 容器内结构合法，但 QuickTime Player 与大量默认浏览器解码器不支持，
 * 表现为「此文件包含 QuickTime 无法播放的媒体」而无法播放。
 *
 * 本模块提供：
 *  1) probeMedia   —— 用 ffprobe 读取容器/视频编码/音频编码，并判定 playerCompatible。
 *  2) repairToH264 —— 用 ffmpeg 将不兼容文件转码为 H.264+AAC 的 MP4（最通用可播放格式）。
 */

function normalizeContainer(fmt: string): string {
  const f = (fmt || '').toLowerCase();
  if (f.includes('mp4')) return 'mp4';
  if (f.includes('matroska')) return 'mkv';
  if (f.includes('webm')) return 'webm';
  if (f.includes('mov')) return 'mov';
  if (f.includes('mpegts') || f.includes('mpeg-ts')) return 'ts';
  if (f.includes('flv')) return 'flv';
  if (f.includes('avi')) return 'avi';
  const head = f.split(',')[0] ?? '';
  return head || 'unknown';
}

/**
 * 判定媒体是否能被常见播放器（QuickTime Player + 主流浏览器 Chrome/Safari/Firefox/Edge）直接解码。
 * 目标聚焦用户报告的「下载后无法播放」场景：MP4/MKV 容器中的 AV1/VP9 在 QuickTime 下不可解。
 */
export function isPlayerCompatible(
  videoCodec?: string,
  container?: string,
  audioCodec?: string
): boolean {
  const vc = (videoCodec ?? '').toLowerCase();
  const c = (container ?? '').toLowerCase();

  // 纯音频（无视频流）：MP4/M4A 中 AAC/MP3 均兼容；WebM 音频 QuickTime 不支持但浏览器支持。
  if (!vc) {
    const ac = (audioCodec ?? '').toLowerCase();
    if (c === 'webm') return true; // 浏览器可播，非 QuickTime 环境
    // aac/mp3/m4a 等常规音频均兼容
    return ac === '' || ac.includes('aac') || ac.includes('mp3') || ac.includes('opus');
  }

  if (c === 'mp4' || c === 'mov' || c === 'm4v' || c === 'm4a') {
    // QuickTime + 浏览器均原生支持 H.264 / HEVC；AV1/VP9 在 MP4 容器下 QuickTime 无法解码。
    return (
      vc.includes('avc') ||
      vc.includes('h264') ||
      vc.includes('264') ||
      vc.includes('hevc') ||
      vc.includes('hvc') ||
      vc.includes('mpeg4') ||
      vc.includes('mp4v')
    );
  }

  if (c === 'webm') {
    // 浏览器原生支持 VP8/VP9/AV1；QuickTime 不支持 WebM，但默认播放环境多为浏览器。
    return true;
  }

  if (c === 'mkv' || c === 'ts' || c === 'avi' || c === 'flv') {
    // 第三方播放器（VLC/IINA 等）普遍可播；非 QuickTime 环境下视为兼容。
    return true;
  }

  return true;
}

/**
 * 用 ffprobe 探测媒体信息；失败或文件缺失返回 null（调用方应忽略而非中断流程）。
 * @param ffprobeBinOverride 可选：指定 ffprobe 路径（MITM 接入层有独立配置项），
 *   使主任务链路与 MITM 链路共用同一套编码/可播放性判定逻辑，避免判定分叉。
 */
export async function probeMedia(filePath: string, ffprobeBinOverride?: string): Promise<TaskMedia | null> {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const bin = ffprobeBinOverride || config.ffprobeBin;
  if (!(await hasExecutable(bin))) {
    logger.warn(`ffprobe 不可用（${bin}），跳过媒体探测`);
    return null;
  }

  return new Promise((resolve) => {
    const proc = spawn(
      bin,
      [
        '-v', 'error',
        '-show_entries', 'stream=index,codec_type,codec_name,width,height',
        '-show_entries', 'format=duration,format_name',
        '-of', 'json',
        filePath,
      ],
      { windowsHide: true }
    );
    let out = '';
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      try {
        const json = JSON.parse(out || '{}') as {
          streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
          format?: { duration?: string; format_name?: string };
        };
        const streams = json.streams ?? [];
        const video = streams.find((s) => s.codec_type === 'video');
        const audio = streams.find((s) => s.codec_type === 'audio');
        const fmtRaw = json.format?.format_name ?? '';
        const media: TaskMedia = {
          container: normalizeContainer(fmtRaw),
          videoCodec: video?.codec_name?.toLowerCase(),
          audioCodec: audio?.codec_name?.toLowerCase() ?? 'none',
          width: video?.width ? Number(video.width) : undefined,
          height: video?.height ? Number(video.height) : undefined,
          durationSeconds:
            json.format?.duration != null ? Number(Number(json.format.duration).toFixed(1)) : undefined,
        };
        media.playerCompatible = isPlayerCompatible(media.videoCodec, media.container, media.audioCodec);
        media.notes =
          media.playerCompatible === false
            ? `检测到不兼容编码 ${media.videoCodec?.toUpperCase()}/${media.container?.toUpperCase()}，部分播放器（如 QuickTime）无法解码`
            : undefined;
        resolve(media);
      } catch (e) {
        logger.warn(`ffprobe 解析失败 ${path.basename(filePath)}: ${(e as Error).message}`);
        resolve(null);
      }
    });
  });
}

/**
 * 将可能不兼容的视频转码为 H.264+AAC 的 MP4（最通用可播放格式）。
 * @param filePath 待修复文件
 * @param keepOriginal 是否保留原始文件为 `<name>.original.<ext>`（默认 true，避免误删用户素材）
 * @returns 修复后的文件路径、体积与探测信息（playerCompatible 应为 true）
 */
export async function repairToH264(
  filePath: string,
  keepOriginal = true
): Promise<{ filePath: string; fileSizeBytes: number; media: TaskMedia }> {
  if (!fs.existsSync(filePath)) {
    throw new ApiError('FILE_NOT_FOUND', '待修复文件不存在', 404);
  }
  const bin = config.ffmpegBin;
  if (!(await hasExecutable(bin))) {
    throw new ApiError('ENGINE_UNAVAILABLE', '未找到 ffmpeg，无法执行转码修复', 500);
  }

  const parsed = path.parse(filePath);
  const outPath = path.join(parsed.dir, `${parsed.name}.vdm-repair.tmp.mp4`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      bin,
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', filePath,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        outPath,
      ],
      { windowsHide: true }
    );
    let err = '';
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) resolve();
      else reject(new Error(`转码失败 (exit=${code}): ${err.slice(-800)}`));
    });
  });

  // 修复产物统一为 .mp4（H.264+AAC），与原文件（可能 webm/mkv/旧 mp4）区分
  const finalPath = path.join(parsed.dir, `${parsed.name}.mp4`);
  if (finalPath !== filePath && fs.existsSync(finalPath)) {
    removeFileSafe(finalPath);
  }

  if (keepOriginal) {
    const ext = parsed.ext ? parsed.ext.slice(1) : 'bak';
    const backup = path.join(parsed.dir, `${parsed.name}.original.${ext}`);
    if (backup !== filePath && fs.existsSync(filePath)) {
      try {
        fs.renameSync(filePath, backup);
      } catch {
        /* 备份失败不影响修复产物落地 */
      }
    }
    fs.renameSync(outPath, finalPath);
  } else {
    removeFileSafe(filePath);
    fs.renameSync(outPath, finalPath);
  }

  const size = fs.statSync(finalPath).size;
  const media =
    (await probeMedia(finalPath)) ?? {
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      playerCompatible: true,
    };
  return { filePath: finalPath, fileSizeBytes: size, media };
}
