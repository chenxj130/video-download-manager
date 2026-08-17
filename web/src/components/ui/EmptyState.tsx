import type { ReactNode } from 'react';

export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 px-6 py-14 text-center">
      <div className="mb-3 text-4xl">{icon}</div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-slate-400 dark:text-slate-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
