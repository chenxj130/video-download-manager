import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { taskManager } from '../services/taskManager.js';
import { ApiError } from '../utils/errors.js';
import { wrap } from './_helpers.js';

const router: Router = Router();

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

function getAllowedBases(): string[] {
  const set = new Set<string>();
  set.add(path.normalize(config.downloadDir));
  for (const t of taskManager.getTasks()) {
    if (t.saveDir) set.add(path.normalize(t.saveDir));
  }
  return Array.from(set);
}

export function isPathAllowed(filePath: string): boolean {
  const normalized = path.normalize(path.resolve(filePath));
  for (const base of getAllowedBases()) {
    const sepBase = base.endsWith(path.sep) ? base : base + path.sep;
    if (normalized === base || normalized.startsWith(sepBase)) return true;
  }
  return false;
}

function sendVideo(req: import('express').Request, res: import('express').Response, filePath: string): void {
  const stat = fs.statSync(filePath);
  const mime = mimeFromExt(path.extname(filePath));
  const range = req.headers.range;

  if (range) {
    const raw = range.replace(/bytes=/, '').split('-');
    const start = parseInt(raw[0], 10);
    const end = raw[1] ? parseInt(raw[1], 10) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end >= stat.size || start > end) {
      res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.status(206);
    res.set({
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mime,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.set({
    'Content-Length': stat.size,
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(filePath).pipe(res);
}

/** 获取任务的本地文件流（支持 Range，用于浏览器 <video> 预览） */
router.get(
  '/:id/stream',
  wrap(async (req, res) => {
    const task = taskManager.getTask(req.params.id);
    if (!task) throw new ApiError('TASK_NOT_FOUND', '任务不存在', 404);
    if (!task.filePath) throw new ApiError('FILE_NOT_FOUND', '文件未生成', 404);

    const filePath = path.resolve(task.filePath);
    if (!isPathAllowed(filePath)) {
      throw new ApiError('ACCESS_DENIED', '访问路径受限', 403);
    }
    if (!fs.existsSync(filePath)) {
      throw new ApiError('FILE_NOT_FOUND', '文件不存在', 404);
    }

    sendVideo(req, res, filePath);
  })
);

export default router;
