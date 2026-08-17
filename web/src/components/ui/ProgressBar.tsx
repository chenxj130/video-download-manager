import { clsx } from 'clsx';

interface ProgressBarProps {
  value: number; // 0-100
  active?: boolean;
  className?: string;
  height?: number;
  showShimmer?: boolean;
}

export function ProgressBar({
  value,
  active = false,
  className,
  height = 8,
  showShimmer = true,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={clsx(
        'relative w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800',
        className
      )}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={clsx(
          'h-full rounded-full bg-brand-500 transition-all duration-300 ease-out',
          active && showShimmer && 'progress-shimmer relative overflow-hidden'
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
