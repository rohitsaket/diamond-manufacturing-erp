import { motion } from 'framer-motion';

interface DiamondGaugeProps {
  yieldPct: number;
  size?: number;
  showLabel?: boolean;
}

export function DiamondGauge({ yieldPct, size = 160, showLabel = true }: DiamondGaugeProps) {
  const clampedYield = Math.min(Math.max(yieldPct, 0), 100);
  const radius = size / 2 - 12;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = (clampedYield / 100) * circumference;
  const leakageDash = ((100 - clampedYield) / 100) * circumference;

  const color = clampedYield >= 70 ? '#16A34A' : clampedYield >= 60 ? '#CA8A04' : '#DC2626';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg]">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#F3F4F6"
            strokeWidth={10}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#FEF2F2"
            strokeWidth={10}
            strokeDasharray={`${leakageDash} ${strokeDash}`}
            strokeDashoffset={-strokeDash}
            strokeLinecap="round"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={10}
            strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${strokeDash} ${leakageDash}` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <svg width={size * 0.2} height={size * 0.2} viewBox="0 0 24 24" fill={color}>
            <path d="M6.5 2h11l4.5 6L12 22 2 8l4.5-6z" opacity={0.9}/>
            <path d="M2 8h20M6.5 2l2.5 6m7-6l-2.5 6M12 22L6.5 8M12 22l5.5-14" stroke="white" strokeWidth="0.5" fill="none"/>
          </svg>
          {showLabel && (
            <motion.div
              className="text-center mt-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
            >
              <span className="text-lg font-semibold" style={{ color }}>
                {clampedYield.toFixed(1)}%
              </span>
            </motion.div>
          )}
        </div>
      </div>
      {showLabel && (
        <div className="text-center">
          <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Yield</p>
          <div className="flex items-center gap-3 mt-1">
            <span className="flex items-center gap-1 text-xs text-success">
              <span className="w-2 h-2 rounded-full bg-success" /> Polished
            </span>
            <span className="flex items-center gap-1 text-xs text-danger">
              <span className="w-2 h-2 rounded-full bg-danger" /> Lost
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
