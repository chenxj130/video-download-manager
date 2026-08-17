import { Router } from 'express';
import { taskManager } from '../services/taskManager.js';
import { wrap } from './_helpers.js';

const router: Router = Router();

router.get(
  '/',
  wrap(async (_req, res) => {
    res.json({ stats: taskManager.getDashboard() });
  })
);

export default router;
