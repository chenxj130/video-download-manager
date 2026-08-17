import { Router } from 'express';
import path from 'node:path';
import { taskManager } from '../services/taskManager.js';
import { ApiError } from '../utils/errors.js';
import { openFolder } from '../utils/file.js';
import { isPathAllowed } from './files.js';
import { wrap } from './_helpers.js';

const router: Router = Router();

router.get(
  '/',
  wrap(async (_req, res) => {
    res.json({ system: await taskManager.getSystemInfo() });
  })
);

/** 打开指定目录（仅允许下载目录或任务保存目录，防止路径遍历） */
router.post(
  '/open-folder',
  wrap(async (req, res) => {
    const dir = path.normalize(String(req.body?.path || ''));
    if (!dir || dir === '.') {
      throw new ApiError('INVALID_PATH', '路径无效', 400);
    }
    if (!isPathAllowed(dir)) {
      throw new ApiError('ACCESS_DENIED', '不允许打开该目录', 403);
    }
    await openFolder(dir);
    res.json({ ok: true });
  })
);

export default router;
