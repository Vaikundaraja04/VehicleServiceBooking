import { useEffect, useLayoutEffect, useRef } from 'react';

export function useAutoRefresh(refresh, enabled = true, interval = 15000) {
  const latest = useRef(refresh);
  useLayoutEffect(() => { latest.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const run = async () => {
      if (busy || document.visibilityState === 'hidden' || document.activeElement?.matches('input, textarea, select, button, [contenteditable="true"]')) return;
      busy = true;
      try { await latest.current(); } finally { busy = false; }
    };
    const timer = setInterval(() => void run(), interval);
    document.addEventListener('visibilitychange', run);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', run); };
  }, [enabled, interval]);
}
