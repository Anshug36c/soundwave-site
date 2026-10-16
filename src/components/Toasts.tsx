/**
 * Toasts for `notice` and `error` from the store. Each store message becomes one toast that
 * auto-dismisses; errors linger longer so they can be read. A ref tracks which messages have
 * already been surfaced so a repeat of the same text still shows once per clear cycle.
 */
import { useEffect, useRef, useState } from 'react';
import { store } from '../state/store';

interface Toast {
  id: number;
  text: string;
  error: boolean;
}

let nextId = 1;

export function Toasts() {
  const notice = store((s) => s.notice);
  const error = store((s) => s.error);
  const dismiss = store((s) => s.dismissMessages);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, number>>(new Map());

  const addToast = (text: string, isError: boolean) => {
    const id = nextId++;
    setToasts((prev) => [...prev.slice(-2), { id, text, error: isError }]);
    const ttl = isError ? 5200 : 3200;
    const handle = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, ttl);
    timers.current.set(id, handle);
  };

  useEffect(() => {
    if (notice) {
      addToast(notice, false);
      const t = window.setTimeout(() => dismiss(), 3400);
      return () => window.clearTimeout(t);
    }
  }, [notice, dismiss]);

  useEffect(() => {
    if (error) {
      addToast(error, true);
      const t = window.setTimeout(() => dismiss(), 5400);
      return () => window.clearTimeout(t);
    }
  }, [error, dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((h) => window.clearTimeout(h));
      map.clear();
    };
  }, []);

  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.error ? ' error' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
