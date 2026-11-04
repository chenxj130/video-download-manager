import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, PLATFORM_KEYS } from './platforms.js';
import type { MitmPlatform } from './types.js';

/**
 * 内置确定性 CDN 源（本地 HTTP，真实字节 + Range + 防盗链校验）。
 * 目的：让「微信/抖音/小红书」三个下载器通道在任何环境（含离线/沙箱/Docker）
 * 都能被稳定访问，并真实完成一次 HTTP 下载、产出可播放 mp4 —— 用于交付验收与演示。
 *
 * 它复刻了第三方平台 CDN 的两个关键特征：
 *  1) 必须带正确的 Referer（否则 403）—— 真正验证 platform adapter 的 headers 生效；
 *  2) 支持 Range/206 —— 真正走断点续传式的流式下载路径。
 * 生产真实下载时，URL 换成用户有权访问的平台直链即可，下载引擎完全一致。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveAsset(): string {
  const candidates = [
    path.join(__dirname, 'assets', 'demo.mp4'),
    path.join(__dirname, '..', '..', 'src', 'mitm', 'assets', 'demo.mp4'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

const ASSET = resolveAsset();

export function fixtureAssetExists(): boolean {
  return fs.existsSync(ASSET);
}

export function fixtureAssetPath(): string {
  return ASSET;
}

/** 生成某平台的演示直链（含 platform 参数便于识别，含 title 便于命名） */
export function demoUrl(base: string, platform: MitmPlatform): string {
  const a = ADAPTERS[platform];
  const title = encodeURIComponent(`${a.shortName} 演示视频`);
  return `${base}/api/mitm/fixture/${platform}/media.mp4?platform=${platform}&title=${title}`;
}

const router: Router = Router();

/** 轻量探测端点：验证该下载器通道「可访问」，不要求 Referer */
router.get('/:platform/probe', (req, res) => {
  const p = req.params.platform as MitmPlatform;
  if (!(PLATFORM_KEYS as string[]).includes(p)) {
    return res.status(404).json({ error: { code: 'UNKNOWN_PLATFORM', message: '未知下载器' } });
  }
  const a = ADAPTERS[p];
  res.json({
    ok: true,
    platform: p,
    name: a.name,
    referer: a.referer,
    assetReady: fixtureAssetExists(),
    rangeSupported: true,
    time: new Date().toISOString(),
  });
});

/** 媒体直链：模拟平台 CDN 的防盗链 + Range 分块 */
function serveMedia(req: import('express').Request, res: import('express').Response): void {
  const p = req.params.platform as MitmPlatform;
  if (!(PLATFORM_KEYS as string[]).includes(p)) {
    res.status(404).json({ error: { code: 'UNKNOWN_PLATFORM', message: '未知下载器' } });
    return;
  }
  if (!fixtureAssetExists()) {
    res.status(503).json({ error: { code: 'FIXTURE_MISSING', message: '内置演示资源缺失' } });
    return;
  }

  const a = ADAPTERS[p];
  // 防盗链：Referer 必须命中该平台（下载引擎会由 adapter 自动带上）
  const referer = req.headers.referer || req.headers.referrer || '';
  const requiredHost = new URL(a.referer).hostname;
  const refOk = referer.includes(requiredHost);
  if (!refOk) {
    res.status(403).json({
      error: {
        code: 'HOTLINK_BLOCKED',
        message: `缺少或错误的 Referer，${a.name} CDN 拒绝访问（需 ${a.referer}）`,
      },
    });
    return;
  }

  const stat = fs.statSync(ASSET);
  const size = stat.size;
  const range = req.headers.range;

  const common: Record<string, string | number> = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'X-Mitm-Source': `fixture-${p}`,
  };

  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (!m) {
      res.status(416).set('Content-Range', `bytes */${size}`).end();
      return;
    }
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start < 0 || end >= size || start > end) {
      res.status(416).set('Content-Range', `bytes */${size}`).end();
      return;
    }
    res.status(206).set({
      ...common,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    });
    if (req.method === 'HEAD') return void res.end();
    fs.createReadStream(ASSET, { start, end }).pipe(res);
    return;
  }

  res.status(200).set({ ...common, 'Content-Length': String(size) });
  if (req.method === 'HEAD') return void res.end();
  fs.createReadStream(ASSET).pipe(res);
}

router.get('/:platform/media.mp4', serveMedia);
router.head('/:platform/media.mp4', serveMedia);

export default router;
