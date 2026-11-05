import { PLATFORMS, type PlatformMeta } from './constants.js';
import type { Platform } from './types.js';
import { ApiError } from './utils/errors.js';

/** 标准化 URL：补全协议、去除空白 */
export function normalizeUrl(raw: string): string {
  let url = (raw ?? '').trim();
  if (!url) throw new ApiError('INVALID_URL', 'URL 不能为空');
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  return url;
}

/** 解析主机名 */
export function getHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 识别平台 */
export function detectPlatform(url: string): PlatformMeta | null {
  const host = getHostname(url);
  if (!host) return null;
  for (const p of PLATFORMS) {
    // 仅精确匹配或子域匹配（host.endsWith('.' + h)），杜绝 "notyoutube.com".includes("youtube.com") 式仿冒
    if (p.hosts.some((h) => host === h || host.endsWith('.' + h))) {
      return p;
    }
  }
  return null;
}

/** 校验 URL 是否合法且来自受支持平台 */
export function validateUrl(raw: string): { url: string; platform: PlatformMeta } {
  let url: string;
  try {
    url = normalizeUrl(raw);
    // 触发校验
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    throw new ApiError('INVALID_URL', 'URL 格式无效，请检查链接');
  }
  const platform = detectPlatform(url);
  if (!platform) {
    throw new ApiError(
      'UNSUPPORTED_PLATFORM',
      '当前平台不支持，请粘贴 YouTube / Bilibili / Vimeo / X / TikTok / Instagram 的公开视频链接'
    );
  }
  return { url, platform };
}

/** 是否为注入故障的测试 URL（用于演示错误处理）。
 *  支持 `?__err=network` / `&__err=network` / 甚至 `v=abc?__err=network` 任意位置。 */
export function extractFaultCode(url: string): string | null {
  try {
    const m = url.match(/__err=([a-z0-9]+)/i);
    if (m) return m[1].toLowerCase();
    if (/notfound/i.test(url)) return 'notfound';
    if (/priv(ate)?/i.test(url)) return 'forbidden';
  } catch {
    /* ignore */
  }
  return null;
}
