import { LotStatus } from '../../data/mockData';

const statusConfig: Record<LotStatus, { label: string; classes: string; dot: string }> = {
  ISSUED: { label: 'Issued', classes: 'bg-bg-hover text-text-secondary border-border-default', dot: 'bg-text-muted' },
  IN_PROGRESS: { label: 'In Progress', classes: 'bg-warning-light text-warning border-warning/30', dot: 'bg-warning' },
  RECEIVED: { label: 'Received', classes: 'bg-info-light text-primary border-primary/30', dot: 'bg-primary' },
  VERIFIED: { label: 'Verified', classes: 'bg-success-light text-success border-success/30', dot: 'bg-success' },
  REWORK: { label: 'Rework', classes: 'bg-warning-light text-warning border-warning/30', dot: 'bg-warning' },
  LOST: { label: 'Lost', classes: 'bg-danger-light text-danger border-danger/30', dot: 'bg-danger' },
};

export function StatusChip({ status }: { status: LotStatus }) {
  const cfg = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export function WorkerStatusDot({ status }: { status: 'WORKING' | 'RESIGN' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${status === 'WORKING' ? 'bg-success-light text-success border-success/30' : 'bg-danger-light text-danger border-danger/30'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'WORKING' ? 'bg-success' : 'bg-danger'}`} />
      {status === 'WORKING' ? 'Working' : 'Resigned'}
    </span>
  );
}
