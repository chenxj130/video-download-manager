import { Router } from 'express';
import path from 'node:path';
import { validateUrl } from '../platforms.js';
import { getEngine } from '../engine/index.js';
import { taskManager } from '../services/taskManager.js';
import { ApiError } from '../utils/errors.js';
import { openFolder } from '../utils/file.js';
import { isPathAllowed } from './files.js';
import { wrap } from './_helpers.js';

const router: Router = Router();

/** 任务列表 */
router.get(
  '/',
  wrap(async (req, res) => {
    const status = req.query.status as string | undefined;
    const platform = req.query.platform as string | undefined;
    res.json({ tasks: taskManager.getTasks({ status, platform }) });
  })
);

/** 创建下载任务（内部解析 + 入队） */
router.post(
  '/',
  wrap(async (req, res) => {
    const { url, resolution, format, saveDir } = req.body ?? {};
    if (!resolution || !format) {
      throw new ApiError('INVALID_URL', '请选择分辨率与文件格式', 400);
    }
    const { url: normalized } = validateUrl(url);
    const meta = await getEngine().parse(normalized);
    const task = taskManager.createTask(meta, { resolution, format, saveDir });
    res.status(201).json({ task });
  })
);

/** 单个任务 */
router.get(
  '/:id',
  wrap(async (req, res) => {
    const task = taskManager.getTask(req.params.id);
    if (!task) throw new ApiError('TASK_NOT_FOUND', '任务不存在', 404);
    res.json({ task });
  })
);

/** 暂停 */
router.post(
  '/:id/pause',
  wrap(async (req, res) => {
    res.json({ task: taskManager.pause(req.params.id) });
  })
);

/** 继续 */
router.post(
  '/:id/resume',
  wrap(async (req, res) => {
    res.json({ task: taskManager.resume(req.params.id) });
  })
);

/** 取消 */
router.post(
  '/:id/cancel',
  wrap(async (req, res) => {
    res.json({ task: taskManager.cancel(req.params.id) });
  })
);

/** 重试 */
router.post(
  '/:id/retry',
  wrap(async (req, res) => {
    res.json({ task: taskManager.retry(req.params.id) });
  })
);

/** 修复：将编码不兼容的视频转码为 H.264+AAC 可播放格式 */
router.post(
  '/:id/repair',
  wrap(async (req, res) => {
    const task = await taskManager.repair(req.params.id);
    res.json({ task });
  })
);

/** 删除文件（不影响任务记录） */
router.delete(
  '/:id/file',
  wrap(async (req, res) => {
    const ok = taskManager.deleteFile(req.params.id);
    res.json({ ok });
  })
);

/** 删除任务；?deleteFile=true 同时删除实际文件 */
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const deleteFile = req.query.deleteFile === 'true';
    taskManager.remove(req.params.id, deleteFile);
    res.json({ ok: true });
  })
);

/** 打开任务文件所在目录 */
router.post(
  '/:id/open-folder',
  wrap(async (req, res) => {
    const task = taskManager.getTask(req.params.id);
    if (!task) throw new ApiError('TASK_NOT_FOUND', '任务不存在', 404);
    if (!task.filePath) throw new ApiError('FILE_NOT_FOUND', '文件未生成', 400);
    const dir = path.dirname(path.resolve(task.filePath));
    if (!isPathAllowed(dir)) {
      throw new ApiError('ACCESS_DENIED', '不允许打开该目录', 403);
    }
    await openFolder(dir);
    res.json({ ok: true });
  })
);

export default router;
