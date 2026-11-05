import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { taskManager } from '../services/taskManager.js';
import { isPathAllowed } from '../utils/pathSafety.js';
import { ApiError } from '../utils/errors.js';
import { wrap } from './_helpers.js';
import { logger } from '../utils/logger.js';

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

// 白名单统一由 utils/pathSafety 提供（仅服务端配置，不再信任用户提交的 saveDir），
// 此处 re-export 以保持 tasks.ts 等既有调用点的导入路径不变。
export { isPathAllowed };

function sendVideo(req: import('express').Request, res: import('express').Response, filePath: string): void {
  const stat = fs.statSync(filePath);
  const mime = mimeFromExt(path.extname(filePath));
  const range = req.headers.range;

  // [08] 读流缺少 'error' 监听会在播放期间文件被删除/权限变化时成为未捕获异常并杀死进程；
  // 同时监听客户端断开（res close）以尽早停止读取，释放文件句柄。
  const pipeSafe = (rs: fs.ReadStream): void => {
    rs.on('error', (e) => {
      logger.error(`视频流读取失败 ${path.basename(filePath)}: ${(e as Error).message}`);
      try {
        if (!res.headersSent) res.status(500).end();
        else res.end();
      } catch {
        /* ignore */
      }
    });
    res.on('close', () => {
      try {
        rs.destroy();
      } catch {
        /* ignore */
      }
    });
    rs.pipe(res);
  };

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
    pipeSafe(fs.createReadStream(filePath, { start, end }));
    return;
  }

  res.set({
    'Content-Length': stat.size,
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
  });
  pipeSafe(fs.createReadStream(filePath));
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
