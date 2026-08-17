import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs, paths } from './config.js';
import { initEngine } from './engine/index.js';
import { taskManager } from './services/taskManager.js';
import apiRouter from './routes/index.js';
import { ApiError } from './utils/errors.js';
import { logger } from './utils/logger.js';

async function bootstrap() {
  ensureDirs();
  await initEngine();
  taskManager.init();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // API
  app.use('/api', apiRouter);

  // 健康检查
  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // 生产模式：托管前端构建产物
  const webDist = config.webDist;
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
    logger.info(`生产模式：托管前端静态文件 ${webDist}`);
  } else {
    logger.warn('未检测到前端构建产物，仅启动 API 服务（请先 npm run build）');
  }

  // 错误处理中间件
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof ApiError) {
        logger.warn(`API 错误 [${err.code}] ${err.message}`);
        return res.status(err.status || 400).json({ error: { code: err.code, message: err.message } });
      }
      logger.error('未处理异常', err);
      res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
    }
  );

  app.listen(config.port, () => {
    logger.info(`视频下载管理器后端已启动: http://localhost:${config.port}`);
    logger.info(`数据库: ${paths.dbFile}`);
    logger.info(`下载目录: ${config.downloadDir}`);
  });
}

bootstrap().catch((err) => {
  logger.error('启动失败', err);
  process.exit(1);
});
