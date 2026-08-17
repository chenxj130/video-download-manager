import { Router } from 'express';
import { taskManager } from '../services/taskManager.js';
import { ApiError } from '../utils/errors.js';
import { wrap } from './_helpers.js';

const router: Router = Router();

/** 下载历史（已完成/失败/已取消） */
router.get(
  '/',
  wrap(async (req, res) => {
    const search = req.query.search as string | undefined;
    const platform = req.query.platform as string | undefined;
    const status = req.query.status as string | undefined;
    const sort = (req.query.sort as 'asc' | 'desc') || 'desc';
    res.json({
      history: taskManager.getHistory({ search, platform, status, sort }),
    });
  })
);

/** 删除历史记录（仅记录，不删实际文件） */
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const task = taskManager.getTask(req.params.id);
    if (!task) throw new ApiError('TASK_NOT_FOUND', '记录不存在', 404);
    taskManager.removeHistory(req.params.id);
    res.json({ ok: true });
  })
);

export default router;
