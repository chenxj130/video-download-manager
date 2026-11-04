import { Router } from 'express';
import parse from './parse.js';
import tasks from './tasks.js';
import history from './history.js';
import dashboard from './dashboard.js';
import settings from './settings.js';
import system from './system.js';
import files from './files.js';
import mitm from '../mitm/router.js';

const router: Router = Router();
router.use('/parse', parse);
router.use('/tasks', tasks);
router.use('/history', history);
router.use('/dashboard', dashboard);
router.use('/settings', settings);
router.use('/system', system);
router.use('/files', files);
// v1.1.0 新增：第三方 MITM 嗅探下载接入层（独立命名空间，不影响现有路由）
router.use('/mitm', mitm);

export default router;
