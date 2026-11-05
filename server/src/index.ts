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

/** 仅允许同源或 localhost 来源（含显式白名单）；其余跨域一律拒绝 */
function corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void): void {
  if (!origin) return cb(null, true); // 同源 / 非浏览器 / 健康检查
  if (config.corsOrigins.includes(origin)) return cb(null, true);
  if (!config.corsOrigins.length) {
    try {
      const host = new URL(origin).hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return cb(null, true);
    } catch {
      /* ignore */
    }
  }
  cb(null, false);
}

/** 可选 API 鉴权：未配置 API_TOKEN 时本地信任；配置后强制校验 Bearer / x-api-token */
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!config.apiToken) return next();
  const auth = req.headers['authorization'];
  const m = /^Bearer\s+(.+)$/i.exec(auth ?? '');
  const token = m ? m[1] : (req.headers['x-api-token'] as string | undefined);
  if (token && token === config.apiToken) return next();
  res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '需要提供有效的 API Token' } });
}

async function bootstrap() {
  ensureDirs();
  await initEngine();
  taskManager.init();

  const app = express();
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  // 健康检查（免鉴权，供探针/负载均衡使用）
  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // API：可选令牌鉴权 + 路由
  app.use('/api', authMiddleware);
  app.use('/api', apiRouter);

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

  app.listen(config.port, config.host, () => {
    logger.info(`视频下载管理器后端已启动: http://${config.host}:${config.port}`);
    logger.info(`数据库: ${paths.dbFile}`);
    logger.info(`下载目录: ${config.downloadDir}`);
    if (config.apiToken) {
      logger.info('API 鉴权已启用（API_TOKEN 已配置）');
    } else {
      logger.warn('API 鉴权未启用（本地信任模式）；如需公网暴露请设置 HOST + API_TOKEN + CORS_ORIGINS');
    }
  });
}

bootstrap().catch((err) => {
  logger.error('启动失败', err);
  process.exit(1);
});
