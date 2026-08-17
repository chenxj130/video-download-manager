import { Router } from 'express';
import { taskManager } from '../services/taskManager.js';
import { wrap } from './_helpers.js';

const router: Router = Router();

router.get(
  '/',
  wrap(async (_req, res) => {
    res.json({ settings: taskManager.getSettings() });
  })
);

router.put(
  '/',
  wrap(async (req, res) => {
    const patch = req.body ?? {};
    const allowed: Record<string, true> = {
      defaultQuality: true,
      defaultFormat: true,
      maxConcurrent: true,
      defaultSaveDir: true,
      maxSpeedBytesPerSec: true,
      requestTimeoutSeconds: true,
      autoRetryCount: true,
      theme: true,
    };
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (allowed[k]) clean[k] = v;
    }
    if (clean.maxConcurrent !== undefined) {
      // 注意：不能写 Number(v) || 3 —— 0 是 falsy，会被错误地当成"未提供"而落到默认值 3，
      // 导致 0 被夹到 3 而不是下界 1。必须显式判断 NaN。
      const n = Number(clean.maxConcurrent);
      clean.maxConcurrent = Number.isFinite(n) ? Math.max(1, Math.min(10, Math.floor(n))) : 3;
    }
    res.json({ settings: taskManager.updateSettings(clean) });
  })
);

export default router;
