import { motion } from 'framer-motion';
import { X } from 'lucide-react';

interface ModalShellProps {
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

/**
 * Centred modal with a click-through scrim. Matches the dialog styling already
 * used by the employee detail modal.
 */
export function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidth = 'max-w-3xl',
}: ModalShellProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className={`relative bg-bg-card border border-border-default rounded-lg w-full ${maxWidth} max-h-[90vh] overflow-hidden shadow-modal flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border-default flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-text-primary font-semibold text-base truncate">{title}</h3>
            {subtitle && <p className="text-text-muted text-xs mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto scrollbar-thin flex-1 px-5 py-4">{children}</div>

        {footer && (
          <div className="px-5 py-3 border-t border-border-default bg-bg-secondary flex-shrink-0">{footer}</div>
        )}
      </motion.div>
    </motion.div>
  );
}
