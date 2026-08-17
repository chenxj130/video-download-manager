import { Router } from 'express';
import parse from './parse.js';
import tasks from './tasks.js';
import history from './history.js';
import dashboard from './dashboard.js';
import settings from './settings.js';
import system from './system.js';
import files from './files.js';

const router: Router = Router();
router.use('/parse', parse);
router.use('/tasks', tasks);
router.use('/history', history);
router.use('/dashboard', dashboard);
router.use('/settings', settings);
router.use('/system', system);
router.use('/files', files);

export default router;
