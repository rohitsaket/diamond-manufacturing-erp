import { useState } from 'react';
import { Lock, CheckCircle, Circle, DollarSign, Download, AlertCircle, MessageCircle, LockKeyhole, BadgeCheck } from 'lucide-react';
import { SalaryPeriod, SalaryLine } from '../../data/mockData';
import { useApp } from '../../contexts/AppContext';

function exportPayoutCsv(period: SalaryPeriod, lines: SalaryLine[]) {
  const headers = ['Worker', 'Code', 'Total Carats', 'Lots', 'Labour Amount (₹)', 'Mgr Verified', 'Acct Verified', 'Paid At'];
  const escape = (v: string | number | boolean | undefined) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    headers.join(','),
    ...lines.map(l => [
      l.employeeName, l.empCode, l.totalCts.toFixed(1), l.lotsCount,
      l.totalAmount, l.managerVerified ? 'Yes' : 'No',
      l.accountVerified ? 'Yes' : 'No', l.paidAt ?? '',
    ].map(escape).join(',')),
    '',
    `Total,,${lines.reduce((s, l) => s + l.totalCts, 0).toFixed(1)},${lines.reduce((s, l) => s + l.lotsCount, 0)},${lines.reduce((s, l) => s + l.totalAmount, 0)}`,
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `payout-register-${period.label.replace(' ', '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function showWhatsAppSlip(line: SalaryLine, period: SalaryPeriod) {
  const msg = [
    `*Harene Diamond — Salary Slip*`,
    `Period: ${period.label}`,
    `Worker: ${line.employeeName} (${line.empCode})`,
    `Total Carats: ${line.totalCts.toFixed(1)} ct`,
    `Lots Processed: ${line.lotsCount}`,
    `Labour Amount: ₹${line.totalAmount.toLocaleString()}`,
    `Status: ${line.accountVerified ? '✅ Paid' : '⏳ Pending approval'}`,
    ``,
    `_Harene Diamond Manufacturing_`,
  ].join('\n');
  const encoded = encodeURIComponent(msg);
  window.open(`https://wa.me/?text=${encoded}`, '_blank', 'noopener,noreferrer');
}

function PeriodBadge({ status }: { status: SalaryPeriod['status'] }) {
  const cfg = {
    OPEN: { label: 'Open', cls: 'bg-warning-light text-warning border-warning/25' },
    LOCKED: { label: 'Locked', cls: 'bg-info-light text-primary border-primary/25' },
    PAID: { label: 'Paid', cls: 'bg-success-light text-success border-success/25' },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

export function Payroll() {
  const { salaryPeriods, salaryLines, managerVerify, accountVerify, lockPeriod, markPaid } = useApp();
  const [activePeriodId, setActivePeriodId] = useState<number | null>(null);

  const activePeriod = salaryPeriods.find(p => p.id === activePeriodId) ?? salaryPeriods[0];

  if (!activePeriod) {
    return <div className="text-text-muted text-sm">Loading payroll…</div>;
  }

  const periodLines = salaryLines.filter(l => l.periodId === activePeriod.id);

  const totals = {
    cts: periodLines.reduce((s, l) => s + l.totalCts, 0),
    amount: periodLines.reduce((s, l) => s + l.totalAmount, 0),
    mgrVerified: periodLines.filter(l => l.managerVerified).length,
    accVerified: periodLines.filter(l => l.accountVerified).length,
  };

  const handleMgrVerify = async (id: number) => {
    if (activePeriod.status !== 'OPEN') return;
    const line = periodLines.find(l => l.id === id);
    if (!line) return;
    try {
      await managerVerify(id, !line.managerVerified, activePeriod.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to update verification');
    }
  };

  const handleAccVerify = async (id: number) => {
    if (activePeriod.status !== 'OPEN') return;
    const line = periodLines.find(l => l.id === id);
    if (!line || !line.managerVerified) return;
    try {
      await accountVerify(id, !line.accountVerified, activePeriod.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to update verification');
    }
  };

  const handleLockPeriod = async () => {
    if (activePeriod.status !== 'OPEN') return;
    const unverified = periodLines.filter(l => !l.managerVerified || !l.accountVerified).length;
    if (unverified > 0) {
      if (!window.confirm(`${unverified} line(s) are not fully verified. Lock period anyway?`)) return;
    }
    try {
      await lockPeriod(activePeriod.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to lock period');
    }
  };

  const handleMarkPaid = async () => {
    if (activePeriod.status !== 'LOCKED') return;
    try {
      await markPaid(activePeriod.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to mark paid');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary">Salary & Payout</h2>
          <p className="text-text-secondary text-sm mt-1">Two-step verified payroll · piece-rate computed</p>
        </div>
        <div className="flex items-center gap-2">
          {activePeriod.status === 'OPEN' && (
            <button
              onClick={handleLockPeriod}
              className="flex items-center gap-2 px-4 py-2 rounded-md border border-primary/30 text-primary text-sm hover:bg-bg-selected transition-colors"
            >
              <LockKeyhole size={14} />
              Lock Period
            </button>
          )}
          {activePeriod.status === 'LOCKED' && (
            <button
              onClick={handleMarkPaid}
              className="flex items-center gap-2 px-4 py-2 rounded-md border border-success/30 text-success text-sm hover:bg-success-light transition-colors"
            >
              <BadgeCheck size={14} />
              Mark as Paid
            </button>
          )}
          <button
            onClick={() => exportPayoutCsv(activePeriod, periodLines)}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-border-default text-text-secondary text-sm hover:bg-bg-hover transition-colors"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-3">
        {salaryPeriods.map(p => (
          <button
            key={p.id}
            onClick={() => setActivePeriodId(p.id)}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-md border text-sm font-medium transition-all ${activePeriod.id === p.id ? 'bg-primary-light border-primary/30 text-primary' : 'border-border-default text-text-muted hover:border-text-muted hover:text-text-secondary'}`}
          >
            {p.label}
            <PeriodBadge status={p.status} />
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Workers', value: periodLines.length.toString(), color: 'text-text-primary', icon: DollarSign },
          { label: 'Total Carats', value: `${totals.cts.toFixed(1)} ct`, color: 'text-text-primary', icon: DollarSign },
          { label: 'Total Labour', value: `₹${totals.amount.toLocaleString()}`, color: 'text-success', icon: DollarSign },
          { label: 'Mgr Verified', value: `${totals.mgrVerified}/${periodLines.length}`, color: 'text-primary', icon: CheckCircle },
        ].map(card => (
          <div key={card.label} className="bg-bg-card border border-border-default rounded-md p-4">
            <p className="text-text-muted text-xs uppercase tracking-wider mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Two-man rule notice */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-md bg-info-light border border-primary/20">
        <AlertCircle size={16} className="text-primary flex-shrink-0" />
        <p className="text-text-secondary text-sm">
          <strong className="text-primary">Two-man rule:</strong> Manager verification and Account approval must be by different users. Payout is locked until both are confirmed.
          {activePeriod.status !== 'OPEN' && (
            <span className="ml-2 text-text-muted">· Period is <strong>{activePeriod.status}</strong> — no further changes allowed.</span>
          )}
        </p>
      </div>

      {/* Payroll table */}
      <div className="rounded-md border border-border-default overflow-hidden bg-white">
        <table className="w-full">
          <thead className="bg-bg-secondary border-b border-border-default">
            <tr>
              {['Worker', 'Code', 'Total Cts', 'Lots', 'Labour Amount', 'Mgr Verify', 'Acct Verify', 'Paid At', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {periodLines.map((line) => (
              <tr
                key={line.id}
                className="hover:bg-bg-hover transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-bg-hover border border-border-default flex items-center justify-center text-text-secondary text-[10px] font-bold flex-shrink-0">
                      {line.employeeName.split(' ').map(s => s[0]).join('').slice(0, 2)}
                    </div>
                    <span className="text-text-primary text-sm font-medium">{line.employeeName}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-text-muted text-xs font-mono">{line.empCode}</td>
                <td className="px-4 py-3 text-text-primary text-sm font-mono font-semibold">{line.totalCts.toFixed(1)}</td>
                <td className="px-4 py-3 text-text-muted text-xs font-mono">{line.lotsCount}</td>
                <td className="px-4 py-3">
                  <span className="text-success text-sm font-mono font-bold">₹{line.totalAmount.toLocaleString()}</span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleMgrVerify(line.id)}
                    disabled={activePeriod.status !== 'OPEN'}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${line.managerVerified ? 'bg-success-light border-success/25 text-success' : 'border-border-default text-text-muted hover:border-text-muted'} ${activePeriod.status !== 'OPEN' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                  >
                    {line.managerVerified ? <CheckCircle size={12} /> : <Circle size={12} />}
                    {line.managerVerified ? 'Verified' : 'Pending'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleAccVerify(line.id)}
                    disabled={activePeriod.status !== 'OPEN' || !line.managerVerified}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${line.accountVerified ? 'bg-bg-selected border-primary/25 text-primary' : line.managerVerified && activePeriod.status === 'OPEN' ? 'border-primary/20 text-text-muted hover:border-primary/30 cursor-pointer' : 'border-border-default text-text-muted cursor-not-allowed'}`}
                  >
                    {line.accountVerified ? <CheckCircle size={12} /> : <Lock size={12} />}
                    {line.accountVerified ? 'Approved' : 'Awaiting'}
                  </button>
                </td>
                <td className="px-4 py-3 text-text-muted text-xs font-mono">{line.paidAt ?? '—'}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => showWhatsAppSlip(line, activePeriod)}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border-default text-text-muted hover:border-success/30 hover:text-success transition-colors"
                  >
                    <MessageCircle size={10} />
                    WhatsApp
                  </button>
                </td>
              </tr>
            ))}
            {periodLines.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-text-muted text-sm">
                  No salary lines for this period.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-bg-secondary border-t border-border-default">
            <tr>
              <td colSpan={2} className="px-4 py-3 text-text-muted text-xs font-semibold">TOTALS</td>
              <td className="px-4 py-3 text-text-primary text-sm font-mono font-bold">{totals.cts.toFixed(1)}</td>
              <td className="px-4 py-3 text-text-muted text-xs">{periodLines.reduce((s, l) => s + l.lotsCount, 0)}</td>
              <td className="px-4 py-3 text-success text-sm font-mono font-bold">₹{totals.amount.toLocaleString()}</td>
              <td className="px-4 py-3 text-text-muted text-xs">{totals.mgrVerified}/{periodLines.length}</td>
              <td className="px-4 py-3 text-text-muted text-xs">{totals.accVerified}/{periodLines.length}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
