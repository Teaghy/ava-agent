import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

export function RequestProgress({
  active,
  label,
  startedAt,
  durationMs,
}: {
  active: boolean;
  label: string;
  startedAt: number;
  durationMs?: number;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    Math.floor((performance.now() - startedAt) / 1000),
  );
  useEffect(() => {
    if (!active) return;
    const update = () =>
      setElapsedSeconds(Math.max(0, Math.floor((performance.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  const seconds = active ? elapsedSeconds : Math.max(0, Math.floor((durationMs ?? 0) / 1000));
  return (
    <div className={`request-progress ${active ? 'request-progress-active' : ''}`}>
      {active && <LoaderCircle className="spinner" size={14} aria-hidden="true" />}
      <span role="status" aria-live="polite" aria-atomic="true" className="request-progress-label">
        {label}
      </span>
      <span className="request-progress-separator" aria-hidden="true">
        ·
      </span>
      <span className="request-progress-time">用时 {seconds} 秒</span>
      {active && (
        <span className="request-progress-dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      )}
    </div>
  );
}
