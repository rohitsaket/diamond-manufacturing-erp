import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit3, Save, Plus, Info, X, Calendar } from 'lucide-react';
import { RateCardRow, ShapeCategory } from '../../data/mockData';
import { useApp } from '../../contexts/AppContext';
import { api } from '../../api/client';

const categoryTabs: { key: ShapeCategory; label: string; color: string }[] = [
  { key: 'ROUND', label: 'Round', color: 'text-primary' },
  { key: 'FANCY', label: 'Fancy', color: 'text-text-primary' },
  { key: 'BLOCKING', label: 'Blocking', color: 'text-text-secondary' },
];

interface AuditEntry {
  date: string;
  actor: string;
  change: string;
  type: 'increase' | 'decrease' | 'bulk';
}

function computeImpact(rates: RateCardRow[], changedId: number, newRate: number, lots: { polishedWt?: number; shapeCategory: ShapeCategory; lab?: string }[]): number {
  const changed = rates.find(r => r.id === changedId);
  if (!changed) return 0;
  const affectedLots = lots.filter(l =>
    l.polishedWt &&
    l.shapeCategory === changed.shapeCategory &&
    (changed.lab === 'ANY' || l.lab === changed.lab) &&
    l.polishedWt >= changed.ctsMin &&
    l.polishedWt <= changed.ctsMax
  );
  return affectedLots.reduce((sum, l) => sum + (l.polishedWt ?? 0) * (newRate - changed.ratePerCt), 0);
}

function NewVersionModal({ activeFrom, onClose, onConfirm }: {
  activeFrom: string;
  onClose: () => void;
  onConfirm: (date: string) => void;
}) {
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });

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
        initial={{ scale: 0.95, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 16 }}
        className="relative bg-white border border-border-default rounded-lg w-full max-w-sm p-6 shadow-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-text-primary font-semibold text-sm">Create New Rate Version</h3>
            <p className="text-text-muted text-xs mt-1">All current rates will be cloned with the new effective date. You can then edit individual rates.</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary ml-3 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="mb-2">
          <p className="text-text-muted text-[10px] uppercase tracking-wider font-medium mb-1">Current effective from</p>
          <p className="text-text-secondary text-sm font-mono">{activeFrom}</p>
        </div>

        <div className="mt-4">
          <label className="text-text-muted text-[10px] uppercase tracking-wider font-medium block mb-1">
            <Calendar size={10} className="inline mr-1" />
            New effective date *
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full bg-white border border-border-default rounded-md px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-md border border-border-default text-text-muted text-sm hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => date && onConfirm(date)}
            className="flex-1 py-2 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors"
          >
            Create Version
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function RateCard() {
  const { rateCard: rates, lots, updateRate, newRateVersion } = useApp();
  const [activeCategory, setActiveCategory] = useState<ShapeCategory>('ROUND');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<number>(0);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [impact, setImpact] = useState<number | null>(null);
  const [showNewVersion, setShowNewVersion] = useState(false);

  const loadAuditLogs = useCallback(() => {
    api.get<AuditEntry[]>('/rate-card/audit-logs')
      .then(setAuditLogs)
      .catch(() => { /* audit trail stays empty on failure */ });
  }, []);

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  const filtered = rates.filter(r => r.shapeCategory === activeCategory);
  const igiRates = filtered.filter(r => r.lab === 'IGI' || r.lab === 'ANY');
  const giaRates = filtered.filter(r => r.lab === 'GIA');

  const effectiveFrom = rates.reduce((latest, r) =>
    r.effectiveFrom > latest ? r.effectiveFrom : latest, '0000-00-00');

  const handleEdit = (row: RateCardRow) => {
    setEditingId(row.id);
    setEditValue(row.ratePerCt);
    setImpact(null);
  };

  const handleSave = async (row: RateCardRow) => {
    const diff = computeImpact(rates, row.id, editValue, lots);
    try {
      await updateRate(row.id, editValue);
      setSessionCount(c => c + 1);
      loadAuditLogs();
      setImpact(diff);
      setEditingId(null);
      setTimeout(() => setImpact(null), 5000);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to update rate');
    }
  };

  const handleNewVersion = async (newDate: string) => {
    try {
      await newRateVersion(newDate);
      setSessionCount(c => c + 1);
      loadAuditLogs();
      setShowNewVersion(false);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to create new version');
    }
  };

  const bucketLabels: Record<string, string> = {
    '0.00': '0.00 – 0.49 ct',
    '0.50': '0.50 – 0.99 ct',
    '1.00': '1.00 – 1.99 ct',
    '2.00': '2.00 – 2.99 ct',
    '3.00': '3.00 – 4.99 ct',
    '5.00': '5.00 – 9.99 ct',
    '10.00': '10.00+ ct',
  };


  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary">Rate Card Manager</h2>
          <p className="text-text-secondary text-sm mt-1">Effective-dated pricing · replaces VALIDATION sheet</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-success-light border border-success/20 text-success text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            Effective from {effectiveFrom}
          </div>
          <button
            onClick={() => setShowNewVersion(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-border-default text-text-secondary text-sm font-medium hover:bg-bg-hover transition-colors"
          >
            <Plus size={14} />
            New Version
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-md bg-bg-selected border border-primary/20">
        <Info size={15} className="text-primary flex-shrink-0" />
        <p className="text-text-secondary text-sm">
          Rate changes are <strong className="text-primary">effective-dated</strong> and <strong className="text-primary">append-only</strong>. Historical payroll is never retroactively altered. Every edit is logged in the audit trail.
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-2 border-b border-border-default pb-4">
        {categoryTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveCategory(tab.key); setEditingId(null); }}
            className={`px-5 py-2 rounded-md text-sm font-medium border transition-all ${activeCategory === tab.key ? 'bg-bg-selected border-primary/30 text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}
          >
            <span className={activeCategory === tab.key ? tab.color : ''}>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Impact preview alert */}
      <AnimatePresence>
        {impact !== null && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`flex items-center gap-3 px-4 py-3 rounded-md ${impact >= 0 ? 'bg-bg-selected border border-primary/25' : 'bg-warning-light border border-warning/25'}`}
          >
            <Info size={14} className={impact >= 0 ? 'text-primary' : 'text-warning'} />
            <p className={`text-sm ${impact >= 0 ? 'text-text-primary' : 'text-warning'}`}>
              Rate updated! This period's payroll impact on affected polished lots:{' '}
              <strong className="text-text-primary">
                {impact >= 0 ? '+' : ''}₹{Math.abs(Math.round(impact)).toLocaleString()}
              </strong>.
              {' '}Change is logged and effective from today.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rate matrix table */}
      <div className="rounded-md border border-border-default overflow-hidden bg-white">
        <div className="px-4 py-3 border-b border-border-default flex items-center gap-4">
          <span className="text-text-muted text-xs uppercase tracking-wider font-medium">Weight Bucket</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary/50" />
            <span className="text-text-muted text-xs">IGI / ANY rates (₹/ct)</span>
          </div>
          {activeCategory !== 'BLOCKING' && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-text-muted" />
              <span className="text-text-muted text-xs">GIA rates (₹/ct) — premium</span>
            </div>
          )}
        </div>

        <table className="w-full">
          <thead className="bg-bg-secondary border-b border-border-default">
            <tr>
              <th className="px-5 py-3 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider">Weight Range</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold text-primary uppercase tracking-wider">{activeCategory === 'BLOCKING' ? 'ANY' : 'IGI'} Rate (₹/ct)</th>
              {activeCategory !== 'BLOCKING' && (
                <th className="px-5 py-3 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider">GIA Rate (₹/ct)</th>
              )}
              <th className="px-5 py-3 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider">GIA Premium</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {igiRates.map((row, i) => {
              const giaRow = giaRates[i];
              const premium = giaRow ? Math.round(((giaRow.ratePerCt - row.ratePerCt) / row.ratePerCt) * 100) : null;
              const bucketLabel = bucketLabels[row.ctsMin.toFixed(2)] || `${row.ctsMin.toFixed(2)} – ${row.ctsMax < 900 ? row.ctsMax.toFixed(2) : '∞'} ct`;

              return (
                <tr
                  key={row.id}
                  className="hover:bg-bg-hover group"
                >
                  <td className="px-5 py-3.5">
                    <span className="text-text-primary text-sm font-medium">{bucketLabel}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    {editingId === row.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-text-muted text-sm">₹</span>
                        <input
                          type="number"
                          value={editValue}
                          onChange={e => setEditValue(Number(e.target.value))}
                          className="w-20 bg-white border border-primary/40 rounded-md px-2 py-1 text-primary text-sm font-mono font-bold focus:outline-none focus:ring-1 focus:ring-primary/20"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSave(row)}
                          className="p-1 rounded-md bg-success-light text-success hover:bg-success/20"
                        >
                          <Save size={12} />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded-md bg-bg-hover text-text-muted hover:bg-border-default"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-primary text-sm font-mono font-bold">₹{row.ratePerCt.toLocaleString()}</span>
                    )}
                  </td>
                  {activeCategory !== 'BLOCKING' && (
                    <td className="px-5 py-3.5">
                      <span className="text-text-secondary text-sm font-mono font-bold">
                        {giaRow ? `₹${giaRow.ratePerCt.toLocaleString()}` : '—'}
                      </span>
                    </td>
                  )}
                  <td className="px-5 py-3.5">
                    {premium !== null ? (
                      <span className="text-text-secondary text-xs font-mono">+{premium}%</span>
                    ) : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => handleEdit(row)}
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border-default text-text-muted hover:border-primary/40 hover:text-primary transition-all"
                    >
                      <Edit3 size={10} />
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Audit trail */}
      <div className="bg-white border border-border-default rounded-md p-5">
        <h3 className="text-text-primary text-sm font-medium mb-4">
          Rate History & Audit Log
          {sessionCount > 0 && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-success-light text-success font-medium">
              {sessionCount} new this session
            </span>
          )}
        </h3>
        <div className="space-y-2">
          {auditLogs.length === 0 && (
            <p className="text-text-muted text-xs px-1 py-2">No rate changes recorded yet.</p>
          )}
          {auditLogs.map((entry, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-md bg-bg-hover border border-border-default">
              <span className="text-text-muted text-[10px] font-mono w-20 flex-shrink-0">{entry.date}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                entry.type === 'bulk' ? 'bg-bg-selected text-primary' :
                entry.type === 'increase' ? 'bg-success-light text-success' :
                'bg-warning-light text-warning'
              }`}>
                {entry.type === 'bulk' ? 'BULK' : entry.type === 'increase' ? 'UP' : 'DOWN'}
              </span>
              <span className="text-text-secondary text-xs flex-1">{entry.change}</span>
              <span className="text-text-muted text-[10px]">{entry.actor}</span>
            </div>
          ))}
        </div>
      </div>

      {/* New Version Modal */}
      <AnimatePresence>
        {showNewVersion && (
          <NewVersionModal
            activeFrom={effectiveFrom}
            onClose={() => setShowNewVersion(false)}
            onConfirm={handleNewVersion}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
