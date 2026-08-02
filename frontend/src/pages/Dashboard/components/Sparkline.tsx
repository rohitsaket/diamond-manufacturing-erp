import { useMemo } from 'react';
import { SparkPoint } from '../dashboard.types';

interface SparklineProps {
  data: SparkPoint[];
  color?: string;
  height?: number;
  filled?: boolean;
}

export function Sparkline({ data, color = '#2563EB', height = 34, filled = true }: SparklineProps) {
  const { path, area, points } = useMemo(() => {
    const values = data.map((d) => d.value);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = Math.max(max - min, 1);
    const stepX = data.length > 1 ? height * 0.9 / (data.length - 1) : 0;
    const coords = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height * 0.8) - height * 0.1;
      return { x, y };
    });
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const a = `${line} L${(coords[coords.length - 1]?.x ?? 0).toFixed(1)},${height} L0,${height} Z`;
    return { path: line, area: a, points: coords };
  }, [data, height]);

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${height} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {filled && <path d={area} fill={color} opacity={0.12} />}
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      {points.length > 0 && (
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={2} fill={color} />
      )}
    </svg>
  );
}
