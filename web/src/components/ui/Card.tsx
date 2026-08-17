import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padded?: boolean;
}

export function Card({ children, className, padded = true, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        'card',
        padded && 'p-5',
        'animate-fade-in',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={clsx('text-sm font-semibold text-slate-500 dark:text-slate-400', className)}>
      {children}
    </h3>
  );
}
