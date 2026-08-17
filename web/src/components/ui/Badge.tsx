import { clsx } from 'clsx';
import type { TaskStatus } from '../../types';

const statusStyle: Record<TaskStatus, { label: string; cls: string }> = {
  waiting: { label: '等待中', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  parsing: { label: '解析中', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  downloading: { label: '下载中', cls: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' },
  paused: { label: '已暂停', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  completed: { label: '已完成', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  failed: { label: '失败', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  cancelled: { label: '已取消', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const s = statusStyle[status];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        s.cls
      )}
    >
      <span
        className={clsx(
          'h-1.5 w-1.5 rounded-full',
          status === 'downloading' && 'bg-brand-500 animate-pulse',
          status === 'completed' && 'bg-emerald-500',
          status === 'failed' && 'bg-rose-500',
          status === 'paused' && 'bg-amber-500',
          (status === 'waiting' || status === 'cancelled') && 'bg-slate-400',
          status === 'parsing' && 'bg-indigo-500'
        )}
      />
      {s.label}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    brand: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    danger: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  } as const;
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}
