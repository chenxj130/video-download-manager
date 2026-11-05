/**
 * MITM 直链下载的安全校验（阻断 SSRF）。
 *
 * 背景：`/api/mitm/tasks` 与 `/api/mitm/bridge/download` 接受任意 http(s) URL，
 * 服务端会代客户端发起 GET 并把响应写盘、还能经 stream 回读。若无 host 校验，
 * 可被用来探测内网 / 读取云元数据（169.254.169.254）/ 访问本机其他服务。
 *
 * 权衡：内置确定性源(fixture)与桥接委派都依赖本机 127.0.0.1，故默认放行环回；
 * 如需严格模式可设 MITM_BLOCK_LOOPBACK=1（此时内置 fixture/桥接自检会不可用）。
 * 其余私有网段与元数据地址一律拒绝，重定向每一跳都重新校验。
 */

const BLOCKED_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** 禁止用户注入的请求头键（防止携带凭证访问内网 / 伪造 Host） */
const FORBIDDEN_HEADER_KEYS = new Set([
  'host',
  'cookie',
  'authorization',
  'proxy-authorization',
  'proxy-authenticate',
  'x-forwarded-for',
  'x-forwarded-host',
]);

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') {
    return process.env.MITM_BLOCK_LOOPBACK === '1';
  }
  // IPv6 私有段（ULA / link-local）
  if (h.startsWith('fd') || h.startsWith('fc') || h.startsWith('fe80')) return true;

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 127) return process.env.MITM_BLOCK_LOOPBACK === '1';
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0 || a === 100 && b >= 64 && b <= 127) return true; // 0.0.0.0/8、CGNAT
  if (a >= 224) return true; // 组播/保留
  return false;
}

/** 校验直链安全性；不安全时抛 Error（由上层映射为可读失败原因）。 */
export function assertSafeUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('非法 URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('仅支持 http/https 直链');
  }
  if (u.username || u.password) {
    throw new Error('URL 不允许携带凭证信息');
  }
  if (isPrivateHost(u.hostname)) {
    throw new Error(
      `不允许访问内网/私有地址 ${u.hostname}（SSRF 防护）；如需本机环回请检查 MITM_BLOCK_LOOPBACK 配置`
    );
  }
}

/** 过滤用户自定义请求头，禁止注入凭证/Host 类键。 */
export function sanitizeHeaders(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (FORBIDDEN_HEADER_KEYS.has(k.toLowerCase())) continue;
    if (typeof v !== 'string') continue;
    out[k] = v;
  }
  return out;
}
