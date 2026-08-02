import { useState, useEffect } from 'react';

interface AnimatedNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

export function AnimatedNumber({ value, prefix = '', suffix = '', decimals = 0 }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const end = value;
    const duration = 900;
    const startTime = performance.now();
    let rafId: number;
    const step = (ts: number) => {
      const progress = Math.min((ts - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(end * eased);
      if (progress < 1) rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value]);
  return <span>{prefix}{display.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}{suffix}</span>;
}
