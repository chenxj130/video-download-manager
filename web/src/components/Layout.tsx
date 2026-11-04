import { clsx } from 'clsx';
import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { useTheme } from '../context/ThemeContext';
import { EngineBanner } from './EngineBanner';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { to: '/', label: '首页', icon: 'home' },
  { to: '/tasks', label: '下载任务', icon: 'tasks' },
  { to: '/mitm', label: '资源嗅探', icon: 'radar' },
  { to: '/history', label: '下载历史', icon: 'history' },
  { to: '/dashboard', label: '数据看板', icon: 'dashboard' },
  { to: '/settings', label: '设置', icon: 'settings' },
];

const TITLES: Record<string, string> = {
  '/': '在线视频下载管理器',
  '/tasks': '下载任务',
  '/mitm': '资源嗅探下载',
  '/history': '下载历史',
  '/dashboard': '数据看板',
  '/settings': '设置',
};

function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        )
      }
    >
      <Icon name={item.icon} size={20} />
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { theme, setTheme, resolved } = useTheme();
  const title = TITLES[location.pathname] ?? '视频下载管理器';

  const cycleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');
  };
  const themeLabel = { light: '浅色', dark: '深色', system: '跟随系统' }[theme];

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-slate-950">
      {/* 桌面侧边栏 */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
            <Icon name="tasks" size={20} />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold">视频下载管理器</p>
            <p className="text-[11px] text-slate-400">Video Download Manager</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
        </nav>
        <button
          onClick={cycleTheme}
          className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Icon name={resolved === 'dark' ? 'moon' : 'sun'} size={18} />
          <span>{themeLabel}</span>
        </button>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex items-center gap-2">
            {/* 移动端 logo */}
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white md:hidden">
              <Icon name="tasks" size={18} />
            </div>
            <h1 className="text-lg font-bold tracking-tight">{title}</h1>
          </div>
          <button
            onClick={cycleTheme}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
          >
            <Icon name={resolved === 'dark' ? 'moon' : 'sun'} size={16} />
          </button>
        </header>

        <main className="flex-1 px-4 py-5 md:px-8 md:py-6">
          <EngineBanner />
          {children}
        </main>
      </div>

      {/* 移动端底部导航 */}
      <nav className="sticky bottom-0 z-30 flex border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur md:hidden">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors',
                isActive
                  ? 'text-brand-600 dark:text-brand-400'
                  : 'text-slate-400'
              )
            }
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
