import type { MitmPlatform, MitmPlatformAdapter, MitmProbeResult } from './types.js';

/**
 * 三个第三方 MITM 下载通道的适配器。
 * 规则对齐 res-downloader 的 rule.go / resource.go：平台 CDN 普遍校验 Referer，
 * 微信视频号直链带 encfilekey/token，抖音/小红书需要移动端 UA 与来源 Referer。
 * 这里只处理「用户有权访问的公开直链」，不做任何登录/DRM/付费墙绕过。
 */
const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export const ADAPTERS: Record<MitmPlatform, MitmPlatformAdapter> = {
  wechat: {
    key: 'wechat',
    name: '微信视频号',
    shortName: '微信',
    color: '#07C160',
    hostHints: ['finder.video.qq.com', 'wxapp.tc.qq.com', 'video.qq.com', 'qpic.cn', 'weixin.qq.com'],
    pageHostHints: ['channels.weixin.qq.com', 'weixin.qq.com', 'qq.com'],
    referer: 'https://channels.weixin.qq.com/',
    userAgent: DEFAULT_UA,
    extraHeaders: { Accept: '*/*' },
    suffix: '.mp4',
    description: '微信视频号 / 公众号视频直链（encfilekey + token 签名资源）',
  },
  douyin: {
    key: 'douyin',
    name: '抖音',
    shortName: '抖音',
    color: '#161823',
    hostHints: ['douyinvod.com', 'aweme.snssdk.com', 'ixigua.com', 'bytecdn.com', 'snssdk.com', 'douyin.com'],
    pageHostHints: ['douyin.com', 'iesdouyin.com'],
    referer: 'https://www.douyin.com/',
    userAgent: DEFAULT_UA,
    extraHeaders: { Accept: '*/*' },
    suffix: '.mp4',
    description: '抖音无水印 / 作品视频直链（aweme 视频 CDN）',
  },
  xiaohongshu: {
    key: 'xiaohongshu',
    name: '小红书',
    shortName: '小红书',
    color: '#FF2442',
    hostHints: ['xhscdn.com', 'xiaohongshu.com', 'sns-video', 'xhslink.com'],
    pageHostHints: ['xiaohongshu.com', 'xhslink.com'],
    referer: 'https://www.xiaohongshu.com/',
    userAgent: DEFAULT_UA,
    extraHeaders: { Accept: '*/*' },
    suffix: '.mp4',
    description: '小红书笔记视频直链（sns-video CDN）',
  },
};

export const PLATFORM_KEYS: MitmPlatform[] = ['wechat', 'douyin', 'xiaohongshu'];

export function getAdapter(key: MitmPlatform): MitmPlatformAdapter {
  return ADAPTERS[key];
}

/** 本地确定性 CDN 源的 URL 标记（用于识别 demo 直链） */
export const FIXTURE_MARKER = '/api/mitm/fixture/';

/** 从任意 URL 推断所属平台；优先 host 片段，其次页面 host */
export function detectPlatform(rawUrl: string): MitmPlatform | 'unknown' {
  let host = '';
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
  // 内置确定性源：路径里带 platform 参数
  try {
    const u = new URL(rawUrl);
    const p = u.searchParams.get('platform');
    if (p && (PLATFORM_KEYS as string[]).includes(p)) return p as MitmPlatform;
  } catch {
    /* ignore */
  }
  for (const key of PLATFORM_KEYS) {
    const a = ADAPTERS[key];
    if (a.hostHints.some((h) => host.includes(h))) return key;
  }
  for (const key of PLATFORM_KEYS) {
    const a = ADAPTERS[key];
    if (a.pageHostHints.some((h) => host.includes(h))) return key;
  }
  return 'unknown';
}

/** 构造某平台下载所需的完整请求头（可叠加用户自定义 headers/Cookie） */
export function buildHeaders(platform: MitmPlatform, extra?: Record<string, string>): Record<string, string> {
  const a = ADAPTERS[platform];
  return {
    'User-Agent': a.userAgent,
    Referer: a.referer,
    ...a.extraHeaders,
    ...(extra ?? {}),
  };
}

/** 生成一个安全的文件名（去掉路径分隔符与控制字符） */
export function safeFileName(name: string, maxLen = 60): string {
  const cleaned = name
    .replace(/[\\/\r\n\t:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'mitm-media').slice(0, maxLen);
}

/** 探测 URL：返回平台、建议请求头、建议文件名 */
export function probeUrl(rawUrl: string): MitmProbeResult {
  const platform = detectPlatform(rawUrl);
  const isLocalSource = rawUrl.includes(FIXTURE_MARKER);
  if (platform === 'unknown') {
    return {
      platform: 'unknown',
      platformName: '未识别平台',
      matched: false,
      headers: { 'User-Agent': DEFAULT_UA },
      suggestedName: safeFileName('mitm-media'),
      suffix: '.mp4',
      isLocalSource,
    };
  }
  const a = ADAPTERS[platform];
  let suggestedName = `${a.shortName}-资源`;
  try {
    const u = new URL(rawUrl);
    const title = u.searchParams.get('title');
    if (title) suggestedName = safeFileName(title);
  } catch {
    /* ignore */
  }
  return {
    platform,
    platformName: a.name,
    matched: true,
    headers: buildHeaders(platform),
    suggestedName,
    suffix: a.suffix,
    isLocalSource,
  };
}
