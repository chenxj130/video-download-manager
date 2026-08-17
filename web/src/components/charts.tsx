import { clsx } from 'clsx';

export function StatCard({
  title,
  value,
  sub,
  accent = 'brand',
  icon,
}: {
  title: string;
  value: string;
  sub?: string;
  accent?: 'brand' | 'emerald' | 'amber' | 'rose' | 'slate';
  icon?: string;
}) {
  const accents = {
    brand: 'from-brand-500/15 to-brand-500/5 text-brand-600 dark:text-brand-300',
    emerald: 'from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-300',
    amber: 'from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-300',
    rose: 'from-rose-500/15 to-rose-500/5 text-rose-600 dark:text-rose-300',
    slate: 'from-slate-500/15 to-slate-500/5 text-slate-600 dark:text-slate-300',
  } as const;
  return (
    <div className="card flex items-center gap-4 p-4">
      {icon && (
        <div
          className={clsx(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xl',
            accents[accent]
          )}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{title}</p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight">{value}</p>
        {sub && <p className="truncate text-xs text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

export function BarChart({
  data,
  format = (v) => String(v),
  height = 160,
}: {
  data: { label: string; value: number }[];
  format?: (v: number) => string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 28);
        return (
          <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition">
              {format(d.value)}
            </span>
            <div
              className="w-full rounded-t-md bg-gradient-to-t from-brand-600 to-brand-400 transition-all duration-500"
              style={{ height: Math.max(2, h) }}
              title={`${d.label}: ${format(d.value)}`}
            />
            <span className="text-[10px] text-slate-400 truncate w-full text-center">
              {d.label.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function DonutChart({
  data,
  size = 160,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - 14;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width={size} height={size} className="shrink-0">
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth={14} />
        {total > 0 &&
          data.map((d, i) => {
            const frac = d.value / total;
            const len = frac * circ;
            const seg = (
              <circle
                key={i}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={14}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${c} ${c})`}
                className="transition-all duration-500"
              />
            );
            offset += len;
            return seg;
          })}
        <text x={c} y={c - 4} textAnchor="middle" className="fill-slate-700 dark:fill-slate-200" fontSize="20" fontWeight="700">
          {total}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" className="fill-slate-400" fontSize="11">
          总计
        </text>
      </svg>
      <div className="flex flex-col gap-1.5 min-w-0">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
            <span className="text-slate-600 dark:text-slate-300">{d.label}</span>
            <span className="ml-auto font-medium text-slate-500 dark:text-slate-400">{d.value}</span>
          </div>
        ))}
        {data.length === 0 && <span className="text-sm text-slate-400">暂无数据</span>}
      </div>
    </div>
  );
}

const PALETTE = ['#3366ff', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#ec4899'];

export function paletteColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}
