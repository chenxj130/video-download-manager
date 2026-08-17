import type {
  ApiErrorBody,
  DashboardStats,
  DownloadTask,
  Settings,
  SystemInfo,
  VideoMetadata,
} from './types';

export class ApiRequestError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'ApiRequestError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiRequestError(
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `请求失败 (${res.status})`,
      res.status
    );
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('GET', '/health'),

  parse: (url: string) =>
    request<{ metadata: VideoMetadata }>('POST', '/parse', { url }),

  listTasks: (params?: { status?: string; platform?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.platform) qs.set('platform', params.platform);
    const q = qs.toString();
    return request<{ tasks: DownloadTask[] }>('GET', `/tasks${q ? `?${q}` : ''}`);
  },

  createTask: (payload: {
    url: string;
    resolution: string;
    format: string;
    saveDir?: string;
  }) => request<{ task: DownloadTask }>('POST', '/tasks', payload),

  getTask: (id: string) => request<{ task: DownloadTask }>('GET', `/tasks/${id}`),

  pause: (id: string) => request<{ task: DownloadTask }>('POST', `/tasks/${id}/pause`),
  resume: (id: string) => request<{ task: DownloadTask }>('POST', `/tasks/${id}/resume`),
  cancel: (id: string) => request<{ task: DownloadTask }>('POST', `/tasks/${id}/cancel`),
  retry: (id: string) => request<{ task: DownloadTask }>('POST', `/tasks/${id}/retry`),
  deleteTask: (id: string, deleteFile = false) =>
    request<{ ok: boolean }>('DELETE', `/tasks/${id}${deleteFile ? '?deleteFile=true' : ''}`),
  deleteFile: (id: string) =>
    request<{ ok: boolean }>('DELETE', `/tasks/${id}/file`),

  history: (params?: {
    search?: string;
    platform?: string;
    status?: string;
    sort?: 'asc' | 'desc';
  }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.status) qs.set('status', params.status);
    if (params?.sort) qs.set('sort', params.sort);
    const q = qs.toString();
    return request<{ history: DownloadTask[] }>('GET', `/history${q ? `?${q}` : ''}`);
  },
  deleteHistory: (id: string) =>
    request<{ ok: boolean }>('DELETE', `/history/${id}`),

  dashboard: () => request<{ stats: DashboardStats }>('GET', '/dashboard'),
  settings: () => request<{ settings: Settings }>('GET', '/settings'),
  updateSettings: (patch: Partial<Settings>) =>
    request<{ settings: Settings }>('PUT', '/settings', patch),
  system: () => request<{ system: SystemInfo }>('GET', '/system'),

  /** 任务视频流地址（可直接放入 <video src>） */
  streamTaskFile: (id: string) => `/api/files/${id}/stream`,

  /** 打开任务文件所在目录（调用系统文件管理器） */
  openTaskFolder: (id: string) =>
    request<{ ok: boolean }>('POST', `/tasks/${id}/open-folder`),

  /** 打开任意允许目录（仅下载目录或任务保存目录） */
  openFolder: (path: string) =>
    request<{ ok: boolean }>('POST', '/system/open-folder', { path }),
};
