import { useEffect, useRef, useState } from 'react';

/** Motion is decorative: assistive technology receives the exact value immediately. */
export function AnimatedNumber({
  value,
  decimals = 0,
}: {
  value: number | null;
  decimals?: number;
}) {
  const [display, setDisplay] = useState(value ?? 0);
  const previous = useRef(0);
  useEffect(() => {
    if (value === null) {
      previous.current = 0;
      return;
    }
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      setDisplay(value);
      previous.current = value;
    };
    if (media?.matches || typeof requestAnimationFrame === 'undefined') {
      setDisplay(value);
      previous.current = value;
      return;
    }
    const from = previous.current;
    const start = performance.now();
    setDisplay(from);
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / 750));
      const next = from + (value - from) * (1 - (1 - progress) ** 3);
      setDisplay(next);
      previous.current = next;
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const reduce = () => {
      if (media?.matches) finish();
    };
    media?.addEventListener('change', reduce);
    return () => {
      cancelAnimationFrame(frame);
      media?.removeEventListener('change', reduce);
    };
  }, [value]);
  if (value === null) return <span>—</span>;
  const format = (n: number) =>
    n.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <span className="animated-number">
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden="true">{format(display)}</span>
    </span>
  );
}
