import { memo } from 'react';

interface SectionCardProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  noPadding?: boolean;
  id?: string;
  label?: string;
}

function SectionCardBase({
  title, subtitle, icon, right, children, className = '', bodyClassName = '', noPadding = false, id, label,
}: SectionCardProps) {
  return (
    <section
      id={id}
      aria-label={label ?? title}
      className={`bg-bg-card border border-border-default rounded-lg shadow-card overflow-hidden ${className}`}
    >
      <header className="px-4 sm:px-5 pt-4 pb-3 border-b border-border-light flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5 min-w-0">
          {icon && <span className="mt-0.5 text-text-muted flex-shrink-0">{icon}</span>}
          <div className="min-w-0">
            <h3 className="text-text-primary font-semibold text-sm truncate">{title}</h3>
            {subtitle && <p className="text-text-muted text-xs mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
        {right && <div className="flex items-center gap-2 flex-shrink-0">{right}</div>}
      </header>
      <div className={noPadding ? bodyClassName : `p-4 sm:p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export const SectionCard = memo(SectionCardBase);
