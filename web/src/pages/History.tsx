import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { api, ApiRequestError } from '../api';
import type { DownloadTask } from '../types';
import { Button, Card, StatusBadge, useToast, EmptyState } from '../components/ui';
import { Icon } from '../components/icons';
import { formatBytes, formatDate } from '../lib/format';
import { usePolling } from '../hooks/usePolling';

const PLATFORMS = [
  { key: '', label: '全部平台' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'bilibili', label: 'Bilibili' },
  { key: 'vimeo', label: 'Vimeo' },
  { key: 'x', label: 'X' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
];

const STATUSES = [
  { key: '', label: '全部状态' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
  { key: 'cancelled', label: '已取消' },
];

export function History() {
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<'desc' | 'asc'>('desc');
  const { toast } = useToast();

  const { data, loading } = usePolling<{ history: DownloadTask[] }>(
    () => api.history({ search: search || undefined, platform: platform || undefined, status: status || undefined, sort }),
    3000,
    true
  );

  const list = data?.history ?? [];

  const remove = async (t: DownloadTask) => {
    try {
      await api.deleteHistory(t.id);
      toast('历史记录已删除（文件保留）', 'success');
    } catch (e) {
      toast((e as ApiRequestError).message || '删除失败', 'error');
    }
  };

  return (
    <div>
      {/* 筛选栏 */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索视频名称 / 作者"
              className="input pl-9"
            />
          </div>
          <select className="input lg:w-40" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <select className="input lg:w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            className="input lg:w-32"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'desc' | 'asc')}
          >
            <option value="desc">时间 ↓ 新</option>
            <option value="asc">时间 ↑ 旧</option>
          </select>
        </div>
      </Card>

      {loading && list.length === 0 ? (
        <div className="card h-40 animate-pulse opacity-60" />
      ) : list.length === 0 ? (
        <EmptyState icon={<Icon name="history" size={32} />} title="暂无历史记录" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-4 py-3">视频名称</th>
                <th className="hidden px-4 py-3 sm:table-cell">平台</th>
                <th className="hidden px-4 py-3 md:table-cell">文件大小</th>
                <th className="px-4 py-3">下载时间</th>
                <th className="px-4 py-3">状态</th>
                <th className="hidden px-4 py-3 lg:table-cell">文件路径</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-16 shrink-0 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                        {t.thumbnailUrl && (
                          <img src={t.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={t.title}>
                          {t.title}
                        </p>
                        <p className="text-xs text-slate-400">{t.fileName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 sm:table-cell dark:text-slate-400">
                    {t.platformName}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 md:table-cell dark:text-slate-400">
                    {formatBytes(t.fileSizeBytes)}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                    {formatDate(t.completedAt ?? t.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="hidden px-4 py-3 font-mono text-xs text-slate-400 lg:table-cell">
                    <span className="block max-w-[200px] truncate" title={t.filePath}>
                      {t.filePath || t.saveDir}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.status === 'completed' && t.filePath && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await api.openTaskFolder(t.id);
                            toast('已打开所在目录', 'success');
                          } catch (e) {
                            toast((e as ApiRequestError).message || '打开目录失败', 'error');
                          }
                        }}
                        icon={<Icon name="folder" size={14} />}
                        title="打开所在目录"
                      />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(t)}
                      icon={<Icon name="trash" size={14} />}
                    >
                      删除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
