import http from 'node:http';

/**
 * 可选桥接：对接真实第三方 res-downloader（Wails GUI 应用）的 :8899 HTTP API。
 * 该应用在同一台 macOS 桌面会话下可真实启动并常驻（已实测 app-info/get-config 正常）。
 * 桥接仅做只读探测 + 直链下载委派，绝不触碰系统代理开关与 CA 证书安装
 * （避免污染全局信任根，参见项目 ISOLATION_PLAN.md 的安全结论）。
 *
 * 桥接不可用时全部接口优雅降级为 offline，不影响主流程与内置下载引擎。
 */

export interface BridgeStatus {
  enabled: boolean;
  online: boolean;
  baseUrl: string;
  appName?: string;
  version?: string;
  isProxy?: boolean;
  latencyMs: number | null;
  checkedAt: string;
  error?: string;
}

function call(
  baseUrl: string,
  apiPath: string,
  method: 'GET' | 'POST',
  body?: unknown,
  timeoutMs = 2500
): Promise<{ status: number; data: any; ms: number }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(apiPath, baseUrl);
    } catch (e) {
      return reject(e);
    }
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      u,
      {
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c.toString()));
        res.on('end', () => {
          let data: any = null;
          try { data = JSON.parse(raw); } catch { data = raw; }
          resolve({ status: res.statusCode ?? 0, data, ms: 0 });
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('桥接请求超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function timedCall(
  baseUrl: string,
  apiPath: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<{ status: number; data: any; ms: number }> {
  const started = Date.now();
  const r = await call(baseUrl, apiPath, method, body);
  return { ...r, ms: Date.now() - started };
}

export async function probeBridge(baseUrl: string, enabled: boolean): Promise<BridgeStatus> {
  const checkedAt = new Date().toISOString();
  if (!enabled) {
    return { enabled: false, online: false, baseUrl, latencyMs: null, checkedAt, error: '桥接未启用 (MITM_BRIDGE=0)' };
  }
  try {
    const r = await timedCall(baseUrl, '/api/app-info', 'GET');
    if (r.status !== 200 || !r.data || r.data.code !== 1) {
      return {
        enabled, online: false, baseUrl, latencyMs: r.ms, checkedAt,
        error: `app-info 返回异常 (HTTP ${r.status})`,
      };
    }
    const d = r.data.data || {};
    return {
      enabled,
      online: true,
      baseUrl,
      appName: d.AppName,
      version: d.Version,
      isProxy: d.IsProxy,
      latencyMs: r.ms,
      checkedAt,
    };
  } catch (e) {
    return {
      enabled, online: false, baseUrl, latencyMs: null, checkedAt,
      error: (e as Error).message,
    };
  }
}

export async function bridgeGetConfig(baseUrl: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const r = await timedCall(baseUrl, '/api/get-config', 'GET');
    return { ok: r.status === 200 && r.data?.code === 1, data: r.data?.data, error: r.data?.message };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * 委派下载到第三方引擎的 /api/download（MediaInfo 契约）。
 * 注意：第三方下载是异步事件驱动的（进度走 Wails 事件总线），HTTP 只返回「已受理」。
 * 因此本桥接把它当作「可选增强」，主交付的确定性下载仍由内置无头引擎保证。
 */
export async function bridgeDownload(
  baseUrl: string,
  mediaInfo: Record<string, unknown>
): Promise<{ accepted: boolean; error?: string }> {
  try {
    const r = await timedCall(baseUrl, '/api/download', 'POST', mediaInfo);
    return { accepted: r.status === 200 && r.data?.code === 1, error: r.data?.message };
  } catch (e) {
    return { accepted: false, error: (e as Error).message };
  }
}
