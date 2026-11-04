import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../config.js';
import { ApiError } from '../utils/errors.js';
import { wrap } from '../routes/_helpers.js';
import { MitmStore } from './store.js';
import fixtureRouter, { demoUrl, fixtureAssetExists, fixtureAssetPath } from './fixture.js';
import { ADAPTERS, PLATFORM_KEYS, probeUrl, detectPlatform, buildHeaders } from './platforms.js';
import { probeBridge, bridgeGetConfig, bridgeDownload } from './bridge.js';
import type { MitmPlatform, MitmDownloaderStatus } from './types.js';

/** 解析 ffprobe 绝对路径（仅用于产物校验，失败则跳过 ffprobe 环节） */
function resolveFfprobe(): string | undefined {
  const candidate = config.mitm.ffprobeBin;
  try {
    if (path.isAbsolute(candidate)) return fs.existsSync(candidate) ? candidate : undefined;
    const found = execFileSync('sh', ['-c', `command -v ${JSON.stringify(candidate)}`], {
      encoding: 'utf8',
    }).trim();
    return found || undefined;
  } catch {
    return undefined;
  }
}

const store = new MitmStore({
  maxConcurrent: config.mitm.maxConcurrent,
  timeoutMs: config.mitm.timeoutMs,
  downloadDir: config.mitm.downloadDir,
  persistFile: config.mitm.persistFile,
  ffprobeBin: resolveFfprobe(),
  baseUrl: config.mitm.baseUrl,
});

const router: Router = Router();

/** 内置确定性 CDN 源（若关闭则不挂载） */
if (config.mitm.fixtureEnabled) {
  router.use('/fixture', fixtureRouter);
}

function assertEnabled(): void {
  if (!config.mitm.enabled) throw new ApiError('ENGINE_UNAVAILABLE', 'MITM 接入层未启用', 503);
}

/** 模块级状态：引擎、桥接、fixture、版本 */
router.get(
  '/status',
  wrap(async (_req, res) => {
    const bridge = await probeBridge(config.mitm.bridgeUrl, config.mitm.bridgeEnabled && config.mitm.enabled);
    res.json({
      ok: true,
      module: 'mitm',
      version: config.version,
      enabled: config.mitm.enabled,
      engine: {
        type: 'headless-direct-downloader',
        ready: true,
        maxConcurrent: config.mitm.maxConcurrent,
        timeoutMs: config.mitm.timeoutMs,
        downloadDir: config.mitm.downloadDir,
      },
      fixture: {
        enabled: config.mitm.fixtureEnabled,
        assetReady: fixtureAssetExists(),
        assetPath: fixtureAssetExists() ? fixtureAssetPath() : null,
        rangeSupported: true,
      },
      bridge,
      platforms: PLATFORM_KEYS.map((k) => ({ key: k, name: ADAPTERS[k].name, color: ADAPTERS[k].color })),
      time: new Date().toISOString(),
    });
  })
);

/** 三个下载器通道 + 真实 HTTP 可访问性探测 */
router.get(
  '/downloaders',
  wrap(async (_req, res) => {
    assertEnabled();
    const statuses: MitmDownloaderStatus[] = await Promise.all(
      PLATFORM_KEYS.map(async (key) => {
        const a = ADAPTERS[key];
        const probe = config.mitm.fixtureEnabled
          ? await store.probeDownloader(key)
          : { reachable: false, httpStatus: null, latencyMs: null };
        return {
          platform: key,
          name: a.name,
          color: a.color,
          description: a.description,
          adapterReady: true,
          sourceReachable: probe.reachable,
          sourceHttpStatus: probe.httpStatus,
          demoUrl: config.mitm.fixtureEnabled ? demoUrl(config.mitm.baseUrl, key) : '',
          probeUrl: `/api/mitm/fixture/${key}/probe`,
          latencyMs: probe.latencyMs,
          checkedAt: new Date().toISOString(),
        };
      })
    );
    res.json({ downloaders: statuses });
  })
);

/** URL 探测：识别平台 + 建议请求头 */
router.post(
  '/probe',
  wrap(async (req, res) => {
    assertEnabled();
    const url = (req.body?.url ?? '') as string;
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new ApiError('INVALID_URL', '请提供合法的 http(s) 资源链接', 400);
    }
    res.json({ probe: probeUrl(url), detected: detectPlatform(url) });
  })
);

/** 创建下载任务 */
router.post(
  '/tasks',
  wrap(async (req, res) => {
    assertEnabled();
    const { url, platform, title, headers, source } = req.body ?? {};
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new ApiError('INVALID_URL', '请提供合法的 http(s) 资源链接', 400);
    }
    if (platform && platform !== 'unknown' && !(PLATFORM_KEYS as string[]).includes(platform)) {
      throw new ApiError('UNSUPPORTED_PLATFORM', '不支持的平台', 400);
    }
    const task = store.create({ url, platform, title, headers, source });
    res.status(201).json({ task });
  })
);

/** 任务列表 */
router.get(
  '/tasks',
  wrap(async (_req, res) => {
    assertEnabled();
    res.json({ tasks: store.list() });
  })
);

/** 单任务详情 */
router.get(
  '/tasks/:id',
  wrap(async (req, res) => {
    const t = store.get(req.params.id);
    if (!t) throw new ApiError('TASK_NOT_FOUND', '任务不存在', 404);
    res.json({ task: t });
  })
);

/** 播放已完成产物（Range 支持） */
router.get(
  '/tasks/:id/stream',
  wrap(async (req, res) => {
    const t = store.get(req.params.id);
    if (!t) throw new ApiError('TASK_NOT_FOUND', '任务不存在', 404);
    if (!t.filePath || !fs.existsSync(t.filePath)) {
      throw new ApiError('FILE_NOT_FOUND', '产物文件不存在', 404);
    }
    // 路径白名单：必须落在 MITM 下载目录内
    const normalized = path.normalize(path.resolve(t.filePath));
    const base = path.normalize(path.resolve(config.mitm.downloadDir));
    if (!normalized.startsWith(base + path.sep)) {
      throw new ApiError('ACCESS_DENIED', '访问路径受限', 403);
    }
    const stat = fs.statSync(normalized);
    const mime = (path.extname(normalized).toLowerCase() === '.mp4')
      ? 'video/mp4'
      : 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (Number.isNaN(start) || start < 0 || end >= stat.size || start > end) {
        res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
        return;
      }
      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type': mime,
      });
      fs.createReadStream(normalized, { start, end }).pipe(res);
      return;
    }
    res.set({ 'Content-Length': String(stat.size), 'Content-Type': mime, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(normalized).pipe(res);
  })
);

/** 取消 / 重试 / 重新校验 / 删除 */
router.post('/tasks/:id/cancel', wrap(async (req, res) => {
  const t = store.cancel(req.params.id);
  if (!t) throw new ApiError('TASK_NOT_FOUND', '任务不存在', 404);
  res.json({ task: t });
}));

router.post('/tasks/:id/retry', wrap(async (req, res) => {
  const t = store.retry(req.params.id);
  if (!t) throw new ApiError('TASK_NOT_FOUND', '任务不存在', 404);
  res.json({ task: t });
}));

router.post('/tasks/:id/revalidate', wrap(async (req, res) => {
  const v = await store.revalidate(req.params.id);
  if (!v) throw new ApiError('TASK_NOT_FOUND', '任务不存在', 404);
  res.json({ validation: v });
}));

router.delete('/tasks/:id', wrap(async (req, res) => {
  const delFile = req.query.deleteFile === 'true';
  const r = store.remove(req.params.id, delFile);
  if (!r.ok) throw new ApiError('TASK_NOT_FOUND', '任务不存在', 404);
  res.json({ ok: true, deletedFile: r.deletedFile });
}));

/** 单下载器自检：创建任务→等待完成→返回完整校验（端到端验收用） */
router.post(
  '/downloaders/:platform/selftest',
  wrap(async (req, res) => {
    assertEnabled();
    const key = req.params.platform as MitmPlatform;
    if (!(PLATFORM_KEYS as string[]).includes(key)) {
      throw new ApiError('UNSUPPORTED_PLATFORM', '不支持的下载器', 400);
    }
    if (!config.mitm.fixtureEnabled) {
      throw new ApiError('ENGINE_UNAVAILABLE', '内置确定性源未启用，无法自检', 503);
    }
    const url = demoUrl(config.mitm.baseUrl, key);
    const task = store.create({ url, platform: key, title: `${ADAPTERS[key].shortName}自检`, source: 'fixture' });
    const deadline = Date.now() + Math.min(config.mitm.timeoutMs, 60000);
    while (Date.now() < deadline) {
      const cur = store.get(task.id);
      if (cur && (cur.status === 'completed' || cur.status === 'failed' || cur.status === 'cancelled')) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    const final = store.get(task.id)!;
    const validation = await store.revalidate(task.id);
    res.json({
      platform: key,
      name: ADAPTERS[key].name,
      task: final,
      validation,
      passed: final.status === 'completed' && !!validation?.valid,
    });
  })
);

/** 第三方桥接只读状态 / 配置 / 下载委派 */
router.get('/bridge/status', wrap(async (_req, res) => {
  res.json({ bridge: await probeBridge(config.mitm.bridgeUrl, config.mitm.bridgeEnabled && config.mitm.enabled) });
}));

router.get('/bridge/config', wrap(async (_req, res) => {
  if (!config.mitm.bridgeEnabled) throw new ApiError('ENGINE_UNAVAILABLE', '桥接未启用', 503);
  res.json(await bridgeGetConfig(config.mitm.bridgeUrl));
}));

router.post('/bridge/download', wrap(async (req, res) => {
  if (!config.mitm.bridgeEnabled) throw new ApiError('ENGINE_UNAVAILABLE', '桥接未启用', 503);
  const { url, ...rest } = req.body ?? {};
  if (!url || typeof url !== 'string') throw new ApiError('INVALID_URL', '缺少资源直链', 400);
  const platform = detectPlatform(url);
  const mediaInfo = {
    Id: `vdm-${Date.now()}`,
    Url: url,
    UrlSign: url,
    Domain: (() => { try { return new URL(url).hostname; } catch { return ''; } })(),
    Classify: 'video',
    Suffix: '.mp4',
    SavePath: '',
    Status: 'ready',
    ContentType: 'video/mp4',
    ...rest,
  };
  // 同时落一条内置引擎任务，保证确定性完成（桥接只作可选增强）
  const local = store.create({ url, platform: platform === 'unknown' ? undefined : platform, headers: buildHeaders(platform === 'unknown' ? 'douyin' : platform), source: 'bridge' });
  const bridge = await bridgeDownload(config.mitm.bridgeUrl, mediaInfo);
  res.json({ bridge, localTask: local });
}));

export default router;
