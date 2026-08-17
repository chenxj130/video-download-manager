import { useEffect, useRef, useState, useCallback } from 'react';

interface PollingState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** 通用轮询 Hook：按间隔拉取数据，组件卸载时停止 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs = 1500,
  enabled = true
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = useCallback(async () => {
    try {
      const d = await fetcherRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    run();
    timer.current = setInterval(run, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [enabled, intervalMs, run]);

  return { data, loading, error, refresh: run };
}
