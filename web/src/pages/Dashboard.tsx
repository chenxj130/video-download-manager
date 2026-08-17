import { api } from '../api';
import type { DownloadTask } from '../types';
import { Card, CardTitle, StatusBadge } from '../components/ui';
import { Icon } from '../components/icons';
import { BarChart, DonutChart, StatCard, paletteColor } from '../components/charts';
import { formatBytes, formatRelativeTime } from '../lib/format';
import { usePolling } from '../hooks/usePolling';

export function Dashboard() {
  const { data } = usePolling<{ stats: import('../types').DashboardStats }>(
    () => api.dashboard(),
    3000
  );
  const s = data?.stats;

  if (!s) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card h-24 animate-pulse opacity-60" />
        ))}
      </div>
    );
  }

  const platformData = s.byPlatform.map((p, i) => ({
    label: p.platformName,
    value: p.count,
    color: paletteColor(i),
  }));

  const dailyData = s.daily.map((d) => ({ label: d.date, value: d.count }));

  return (
    <div className="space-y-4">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard title="今日任务" value={String(s.todayTasks)} icon="📅" accent="brand" />
        <StatCard title="已完成" value={String(s.completed)} icon="✓" accent="emerald" />
        <StatCard title="下载中" value={String(s.downloading)} icon="⬇" accent="brand" />
        <StatCard title="失败" value={String(s.failed)} icon="!" accent="rose" />
        <StatCard title="累计下载" value={formatBytes(s.totalBytes)} sub={`${s.totalTasks} 个任务`} icon="💾" accent="slate" />
        <StatCard title="成功率" value={`${s.successRate.toFixed(1)}%`} icon="📈" accent="amber" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 平台分布 */}
        <Card>
          <CardTitle className="mb-3">各平台下载数量</CardTitle>
          <DonutChart data={platformData} />
        </Card>

        {/* 每日下载量 */}
        <Card className="lg:col-span-2">
          <CardTitle className="mb-3">近 14 天每日下载量</CardTitle>
          <BarChart data={dailyData} />
        </Card>
      </div>

      {/* 最近任务 */}
      <Card>
        <CardTitle className="mb-3">最近下载任务</CardTitle>
        {s.recentTasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">暂无任务</p>
        ) : (
          <div className="space-y-2">
            {s.recentTasks.map((t: DownloadTask) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 dark:border-slate-800"
              >
                <div className="h-10 w-16 shrink-0 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                  {t.thumbnailUrl && (
                    <img src={t.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-slate-400">
                    {t.platformName} · {t.resolution} · {formatRelativeTime(t.createdAt)}
                  </p>
                </div>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
