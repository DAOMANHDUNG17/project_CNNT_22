import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { errorMessage } from '../lib/format';

export function useResource<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [version, setVersion] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    setLoading(true); setError(undefined); setData(undefined);
    loader(signal).then(result => {
      if (!controller.signal.aborted && current === sequence.current) setData(result);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted && current === sequence.current) setError(failure);
    }).finally(() => {
      if (!controller.signal.aborted && current === sequence.current) setLoading(false);
    });
    return () => controller.abort();
  }, [loader, version]);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  return { data, loading, error, reload };
}
export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setSettled(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return settled;
}
export function useMutation() {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  async function run(operation: () => Promise<unknown>, success: string, after?: () => void | Promise<void>) {
    if (gate.current) return false;
    gate.current = true; setBusy(true);
    try {
      await operation(); message.success(success); await after?.(); return true;
    } catch (error) { message.error(errorMessage(error)); return false; }
    finally { gate.current = false; setBusy(false); }
  }
  return { busy, run };
}
