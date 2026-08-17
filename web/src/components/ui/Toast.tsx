import { clsx } from 'clsx';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const styles: Record<ToastType, string> = {
  success: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  error: 'border-rose-500/40 text-rose-700 dark:text-rose-300',
  info: 'border-brand-500/40 text-brand-700 dark:text-brand-300',
  warning: 'border-amber-500/40 text-amber-700 dark:text-amber-300',
};

const icons: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '!',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex w-[min(92vw,360px)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'flex items-start gap-2 rounded-xl border bg-white/95 dark:bg-slate-900/95 px-4 py-3 shadow-lg backdrop-blur animate-scale-in',
              styles[t.type]
            )}
          >
            <span className="mt-0.5 font-bold">{icons[t.type]}</span>
            <span className="text-sm text-slate-700 dark:text-slate-200 break-words">
              {t.message}
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
