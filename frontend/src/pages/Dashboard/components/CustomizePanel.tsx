import { memo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Eye, EyeOff, ChevronUp, ChevronDown, RotateCcw, Check, Settings2 } from 'lucide-react';

export interface WidgetDef {
  id: string;
  title: string;
}

const STORAGE_KEY = 'harene_dash_widgets';

export interface WidgetConfig {
  visible: Record<string, boolean>;
  order: string[];
}

export function useWidgetConfig(defs: WidgetDef[]): {
  config: WidgetConfig;
  visibleWidgets: WidgetDef[];
  toggle: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  reset: () => void;
} {
  const defaults = (): WidgetConfig => ({
    visible: Object.fromEntries(defs.map((d) => [d.id, true])),
    order: defs.map((d) => d.id),
  });

  const [config, setConfig] = useState<WidgetConfig>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WidgetConfig;
        return {
          visible: { ...defaults().visible, ...(parsed.visible ?? {}) },
          order: [...defaults().order.filter((id) => (parsed.order ?? []).includes(id)), ...defaults().order.filter((id) => !(parsed.order ?? []).includes(id))],
        };
      }
    } catch { /* ignore */ }
    return defaults();
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch { /* ignore */ }
  }, [config]);

  const toggle = (id: string) =>
    setConfig((c) => ({ ...c, visible: { ...c.visible, [id]: !c.visible[id] } }));

  const move = (id: string, dir: -1 | 1) =>
    setConfig((c) => {
      const i = c.order.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= c.order.length) return c;
      const order = [...c.order];
      [order[i], order[j]] = [order[j], order[i]];
      return { ...c, order };
    });

  const reset = () => setConfig(defaults());

  const visibleWidgets = config.order
    .map((id) => defs.find((d) => d.id === id))
    .filter((d): d is WidgetDef => !!d && config.visible[d.id]);

  return { config, visibleWidgets, toggle, move, reset };
}

interface CustomizePanelProps {
  open: boolean;
  onClose: () => void;
  defs: WidgetDef[];
  config: WidgetConfig;
  onToggle: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onReset: () => void;
}

function CustomizePanelBase({ open, onClose, defs, config, onToggle, onMove, onReset }: CustomizePanelProps) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) setSaved(false);
  }, [open]);

  const handleDone = () => {
    setSaved(true);
    setTimeout(onClose, 350);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Dashboard personalization"
        >
          <div className="absolute inset-0 bg-black/40" />
          <motion.div
            initial={{ scale: 0.95, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 16 }}
            className="relative bg-bg-card border border-border-default rounded-lg w-full max-w-lg shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-5 py-4 border-b border-border-light">
              <div className="flex items-center gap-2.5">
                <Settings2 size={16} className="text-text-muted" />
                <div>
                  <h3 className="text-text-primary font-semibold text-sm">Customize Dashboard</h3>
                  <p className="text-text-muted text-xs mt-0.5">Show, hide or reorder widgets. Saved locally.</p>
                </div>
              </div>
              <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-secondary ml-3 flex-shrink-0">
                <X size={16} />
              </button>
            </div>

            <div className="px-3 py-2 max-h-[55vh] overflow-y-auto">
              {defs.map((d, idx) => {
                const visible = config.visible[d.id];
                return (
                  <div key={d.id} className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-bg-hover transition-colors">
                    <div className="flex flex-col">
                      <button onClick={() => onMove(d.id, -1)} disabled={idx === 0} aria-label={`Move ${d.title} up`} className="text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed">
                        <ChevronUp size={12} />
                      </button>
                      <button onClick={() => onMove(d.id, 1)} disabled={idx === defs.length - 1} aria-label={`Move ${d.title} down`} className="text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed">
                        <ChevronDown size={12} />
                      </button>
                    </div>
                    <span className={`flex-1 text-xs ${visible ? 'text-text-primary font-medium' : 'text-text-muted'}`}>{d.title}</span>
                    <button
                      onClick={() => onToggle(d.id)}
                      aria-label={visible ? `Hide ${d.title}` : `Show ${d.title}`}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                        visible ? 'bg-success-light text-success border-success/30' : 'bg-bg-hover text-text-muted border-border-default'
                      }`}
                    >
                      {visible ? <Eye size={12} /> : <EyeOff size={12} />}
                      {visible ? 'Visible' : 'Hidden'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border-light">
              <button onClick={onReset} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border-default text-text-secondary text-xs hover:bg-bg-hover transition-colors">
                <RotateCcw size={13} /> Reset layout
              </button>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-3 py-2 rounded-md border border-border-default text-text-muted text-xs hover:bg-bg-hover transition-colors">
                  Cancel
                </button>
                <button onClick={handleDone} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition-colors">
                  <Check size={13} /> {saved ? 'Saved' : 'Save layout'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const CustomizePanel = memo(CustomizePanelBase);
