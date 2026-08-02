import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Plus, AlertTriangle, X, Check, ShieldCheck } from 'lucide-react';
import { Lot, LotStatus, LabType, LOT_SLA_DAYS, YIELD_TARGET_PCT } from '../../data/mockData';
import { StatusChip } from '../../components/common/StatusChip';
import { useApp } from '../../contexts/AppContext';

const COLUMNS: { status: LotStatus; label: string; color: string; bg: string }[] = [
  { status: 'ISSUED', label: 'Issued', color: 'text-text-muted', bg: 'bg-bg-card border-border-default' },
  { status: 'IN_PROGRESS', label: 'In Progress', color: 'text-warning', bg: 'bg-bg-secondary border-border-default' },
  { status: 'RECEIVED', label: 'Received', color: 'text-primary', bg: 'bg-bg-secondary border-border-default' },
  { status: 'VERIFIED', label: 'Verified', color: 'text-success', bg: 'bg-bg-secondary border-border-default' },
];

const TODAY = new Date().toISOString().slice(0, 10);

const SHAPES = ['Round', 'Emerald', 'Radiant', 'Pear', 'Oval', 'Cushion', 'Princess', 'Marquise', 'Heart', 'Asscher'];

interface IssueForm {
  workerId: string;
  lotId: string;
  lotName: string;
  shape: string;
  qty: string;
  issueWt: string;
  estimateWt: string;
  issueDate: string;
  lab: LabType | '';
  labourHead: string;
}

interface ReceiveForm {
  polishedWt: string;
  color: string;
  clarity: string;
  cut: string;
  grader: string;
  receivedDate: string;
}

const INPUT_CLS = 'w-full bg-bg-card border border-border-default rounded-md px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors placeholder:text-text-muted';
const LABEL_CLS = 'text-text-secondary text-[10px] uppercase tracking-wider font-medium block mb-1';

function LotCard({ lot, onClick }: { lot: Lot; onClick: () => void }) {
  const daysElapsed = Math.floor((Date.now() - new Date(lot.issueDate).getTime()) / 86400000);
  const isOverdue = (lot.status === 'ISSUED' || lot.status === 'IN_PROGRESS') && daysElapsed > LOT_SLA_DAYS;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={onClick}
      className={`bg-bg-card border rounded-md p-3 cursor-pointer hover:border-primary/30 transition-colors duration-150 group ${isOverdue ? 'border-danger/40' : 'border-border-default'}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-text-primary text-xs font-semibold font-mono">{lot.lotName}</p>
          <p className="text-text-muted text-[10px] mt-0.5">{lot.lotId}</p>
        </div>
        {isOverdue && (
          <span className="flex items-center gap-1 text-danger text-[9px] font-medium">
            <AlertTriangle size={9} />
            {daysElapsed}d
          </span>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-text-muted text-[10px]">{lot.employeeName.split(' ')[0]}</span>
          <span className="text-text-secondary text-[10px] font-mono">{lot.issueWeight.toFixed(2)} ct</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted text-[10px]">{lot.shape} · {lot.qty}pcs</span>
          {lot.polishedWt && (
            <span className="text-success text-[10px] font-mono">→ {lot.polishedWt.toFixed(2)} ct</span>
          )}
        </div>
      </div>
      {lot.labourAmount && (
        <div className="mt-2 pt-2 border-t border-border-light flex items-center justify-between">
          <span className="text-text-muted text-[10px]">Labour</span>
          <span className="text-text-secondary text-[10px] font-mono font-semibold">₹{lot.labourAmount.toLocaleString()}</span>
        </div>
      )}
    </motion.div>
  );
}

function IssueLotPanel({ onClose, onSubmit }: { onClose: () => void; onSubmit: (f: IssueForm) => void }) {
  const { employees, labourHeads } = useApp();
  const [form, setForm] = useState<IssueForm>({
    workerId: '', lotId: '', lotName: '', shape: 'Round',
    qty: '', issueWt: '', estimateWt: '', issueDate: TODAY, lab: 'IGI', labourHead: 'Full Polished',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof IssueForm, string>>>({});

  const set = <K extends keyof IssueForm>(key: K, value: IssueForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: Partial<Record<keyof IssueForm, string>> = {};
    if (!form.workerId) e.workerId = 'Required';
    if (!form.lotId.trim()) e.lotId = 'Required';
    if (!form.lotName.trim()) e.lotName = 'Required';
    if (!form.qty || isNaN(Number(form.qty)) || Number(form.qty) <= 0) e.qty = 'Must be a positive number';
    if (!form.issueWt || isNaN(Number(form.issueWt)) || Number(form.issueWt) <= 0) e.issueWt = 'Must be a positive number';
    if (!form.estimateWt || isNaN(Number(form.estimateWt)) || Number(form.estimateWt) <= 0) e.estimateWt = 'Must be a positive number';
    if (!form.issueDate) e.issueDate = 'Required';
    else if (form.issueDate > TODAY) e.issueDate = 'Cannot be in the future';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) onSubmit(form);
  };

  const textFields: { label: string; key: keyof IssueForm; placeholder: string }[] = [
    { label: 'Lot / Packet ID', key: 'lotId', placeholder: '92124978' },
    { label: 'Lot Name', key: 'lotName', placeholder: '643-019AAA' },
    { label: 'Qty (pcs)', key: 'qty', placeholder: '12' },
    { label: 'Issue Weight (ct)', key: 'issueWt', placeholder: '18.50' },
    { label: 'Estimate Weight (ct)', key: 'estimateWt', placeholder: '12.65' },
  ];

  return (
    <motion.div
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="w-80 bg-bg-card border-l border-border-default flex flex-col"
    >
      <div className="p-4 border-b border-border-default flex items-center justify-between">
        <h3 className="text-text-primary font-semibold text-sm">Issue New Lot</h3>
        <button onClick={onClose} className="text-text-muted hover:text-text-secondary transition-colors">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div>
          <label className={LABEL_CLS}>Karigar</label>
          <select
            value={form.workerId}
            onChange={e => set('workerId', e.target.value)}
            className={`${INPUT_CLS} ${errors.workerId ? 'border-danger' : ''}`}
          >
            <option value="">Select karigar...</option>
            {employees.filter(e => e.workStatus === 'WORKING').map(e => (
              <option key={e.id} value={String(e.id)}>{e.fullName} ({e.empCode})</option>
            ))}
          </select>
          {errors.workerId && <p className="text-danger text-[9px] mt-0.5">{errors.workerId}</p>}
        </div>

        {textFields.map(f => (
          <div key={f.key}>
            <label className={LABEL_CLS}>{f.label}</label>
            <input
              type="text"
              placeholder={f.placeholder}
              value={form[f.key] as string}
              onChange={e => set(f.key, e.target.value)}
              className={`${INPUT_CLS} ${errors[f.key] ? 'border-danger' : ''}`}
            />
            {errors[f.key] && <p className="text-danger text-[9px] mt-0.5">{errors[f.key]}</p>}
          </div>
        ))}

        <div>
          <label className={LABEL_CLS}>Issue Date</label>
          <input
            type="date"
            value={form.issueDate}
            max={TODAY}
            onChange={e => set('issueDate', e.target.value)}
            className={`${INPUT_CLS} ${errors.issueDate ? 'border-danger' : ''}`}
          />
          {errors.issueDate && <p className="text-danger text-[9px] mt-0.5">{errors.issueDate}</p>}
        </div>

        <div>
          <label className={LABEL_CLS}>Shape</label>
          <select
            value={form.shape}
            onChange={e => set('shape', e.target.value)}
            className={INPUT_CLS}
          >
            {SHAPES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className={LABEL_CLS}>Lab</label>
          <div className="flex gap-2">
            {(['IGI', 'GIA', 'US'] as LabType[]).map(lab => (
              <button
                key={lab}
                onClick={() => set('lab', lab)}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-all ${form.lab === lab ? 'bg-primary-light border-primary/40 text-primary' : 'border-border-default text-text-muted hover:border-text-muted'}`}
              >
                {lab}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={LABEL_CLS}>Labour Head</label>
          <select
            value={form.labourHead}
            onChange={e => set('labourHead', e.target.value)}
            className={INPUT_CLS}
          >
            {labourHeads.map(h => <option key={h.id} value={h.name}>{h.name}</option>)}
          </select>
        </div>
      </div>
      <div className="p-4 border-t border-border-default">
        <button
          onClick={handleSubmit}
          className="w-full py-2.5 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors"
        >
          Issue Lot
        </button>
      </div>
    </motion.div>
  );
}

function ReceiveLotPanel({
  lot,
  onClose,
  onReceive,
}: {
  lot: Lot;
  onClose: () => void;
  onReceive: (lotId: number, form: ReceiveForm) => void;
}) {
  const [form, setForm] = useState<ReceiveForm>({
    polishedWt: '', color: '', clarity: '', cut: '', grader: '', receivedDate: TODAY,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ReceiveForm, string>>>({});

  const set = <K extends keyof ReceiveForm>(key: K, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: Partial<Record<keyof ReceiveForm, string>> = {};
    if (!form.polishedWt || isNaN(Number(form.polishedWt)) || Number(form.polishedWt) <= 0)
      e.polishedWt = 'Required — must be positive';
    if (Number(form.polishedWt) >= lot.issueWeight)
      e.polishedWt = 'Cannot exceed issue weight';
    if (!form.receivedDate) e.receivedDate = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) onReceive(lot.id, form);
  };

  return (
    <motion.div
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="w-80 bg-bg-card border-l border-border-default flex flex-col"
    >
      <div className="p-4 border-b border-border-default flex items-center justify-between">
        <div>
          <h3 className="text-text-primary font-semibold text-sm">Receive Lot</h3>
          <p className="text-text-muted text-[10px] font-mono mt-0.5">{lot.lotName}</p>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="p-3 rounded-md bg-info-light border border-primary/30 text-text-secondary text-xs">
          Issue wt: <strong className="text-text-primary">{lot.issueWeight.toFixed(2)} ct</strong> ·
          Est: <strong className="text-text-secondary">{lot.estimateWt.toFixed(2)} ct</strong>
        </div>

        <div>
          <label className={LABEL_CLS}>Polished Weight (ct) *</label>
          <input
            type="number"
            step="0.01"
            placeholder="12.48"
            value={form.polishedWt}
            onChange={e => set('polishedWt', e.target.value)}
            className={`${INPUT_CLS} ${errors.polishedWt ? 'border-danger' : ''}`}
          />
          {errors.polishedWt && <p className="text-danger text-[9px] mt-0.5">{errors.polishedWt}</p>}
          {form.polishedWt && !isNaN(Number(form.polishedWt)) && Number(form.polishedWt) > 0 && Number(form.polishedWt) < lot.issueWeight && (
            <p className="text-text-muted text-[9px] mt-1">
              Yield: <span className={`font-mono font-semibold ${(Number(form.polishedWt) / lot.issueWeight * 100) >= YIELD_TARGET_PCT ? 'text-success' : 'text-warning'}`}>
                {(Number(form.polishedWt) / lot.issueWeight * 100).toFixed(1)}%
              </span> ·
              Loss: <span className="text-warning font-mono">{(lot.issueWeight - Number(form.polishedWt)).toFixed(2)} ct</span>
            </p>
          )}
        </div>

        <div>
          <label className={LABEL_CLS}>Received Date *</label>
          <input
            type="date"
            value={form.receivedDate}
            onChange={e => set('receivedDate', e.target.value)}
            className={`${INPUT_CLS} ${errors.receivedDate ? 'border-danger' : ''}`}
          />
        </div>

        {[
          { label: 'Color', key: 'color' as keyof ReceiveForm, placeholder: 'F' },
          { label: 'Clarity', key: 'clarity' as keyof ReceiveForm, placeholder: 'VS1' },
          { label: 'Cut (ex. EX EX EX)', key: 'cut' as keyof ReceiveForm, placeholder: 'EX EX EX' },
          { label: 'Grader Initial', key: 'grader' as keyof ReceiveForm, placeholder: 'J.J.' },
        ].map(f => (
          <div key={f.key}>
            <label className={LABEL_CLS}>{f.label}</label>
            <input
              type="text"
              placeholder={f.placeholder}
              value={form[f.key]}
              onChange={e => set(f.key, e.target.value)}
              className={INPUT_CLS}
            />
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-border-default">
        <button
          onClick={handleSubmit}
          className="w-full py-2.5 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors"
        >
          <Check size={14} className="inline mr-2" />
          Confirm Receipt
        </button>
      </div>
    </motion.div>
  );
}

export function FloorManager() {
  const { lots: lotList, employees, labourHeads, issueLot, receiveLot, verifyLot } = useApp();
  const [search, setSearch] = useState('');
  const [showIssuePanel, setShowIssuePanel] = useState(false);
  const [selectedLot, setSelectedLot] = useState<Lot | null>(null);
  const [receivingLot, setReceivingLot] = useState<Lot | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<number | null>(null);

  const workingEmployees = employees.filter(e => e.workStatus === 'WORKING');

  const filteredLots = lotList.filter(lot => {
    const matchSearch =
      search === '' ||
      lot.lotName.toLowerCase().includes(search.toLowerCase()) ||
      lot.lotId.includes(search) ||
      lot.employeeName.toLowerCase().includes(search.toLowerCase());
    const matchWorker = selectedWorker === null || lot.employeeId === selectedWorker;
    return matchSearch && matchWorker;
  });

  const handleIssueLot = async (form: IssueForm) => {
    const worker = employees.find(e => e.id === Number(form.workerId));
    if (!worker) return;
    const roundShape = form.shape === 'Round';
    const labourHeadId = labourHeads.find(h => h.name === form.labourHead)?.id ?? labourHeads[0]?.id;
    if (!labourHeadId) {
      window.alert('Labour heads not loaded yet. Please try again in a moment.');
      return;
    }
    try {
      await issueLot({
        workerId: worker.id,
        lotId: form.lotId.trim(),
        lotName: form.lotName.trim(),
        shape: form.shape,
        shapeCategory: roundShape ? 'ROUND' : form.labourHead === 'Blocking' ? 'BLOCKING' : 'FANCY',
        qty: Number(form.qty),
        issueWt: Number(form.issueWt),
        estimateWt: Number(form.estimateWt),
        issueDate: form.issueDate,
        lab: form.lab || '',
        labourHeadId,
      });
      setShowIssuePanel(false);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to issue lot');
    }
  };

  const handleReceiveLot = async (lotId: number, form: ReceiveForm) => {
    try {
      await receiveLot(lotId, {
        polishedWt: Number(form.polishedWt),
        color: form.color || undefined,
        clarity: form.clarity || undefined,
        cut: form.cut || undefined,
        grader: form.grader || undefined,
        receivedDate: form.receivedDate,
      });
      setReceivingLot(null);
      setSelectedLot(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to receive lot');
    }
  };

  const handleVerifyLot = async (lotId: number) => {
    try {
      await verifyLot(lotId);
      setSelectedLot(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to verify lot');
    }
  };

  const syncSelectedLot = (lot: Lot) => {
    const current = lotList.find(l => l.id === lot.id) ?? lot;
    setSelectedLot(current);
  };

  const currentSelectedLot = selectedLot
    ? (lotList.find(l => l.id === selectedLot.id) ?? selectedLot)
    : null;

  return (
    <div className="flex h-full gap-0">
      {/* Left: Karigar List */}
      <div className="w-52 flex-shrink-0 border-r border-border-default pr-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-text-muted text-xs font-medium uppercase tracking-wider">Karigars</h3>
          <span className="text-text-muted text-[10px]">{workingEmployees.length} active</span>
        </div>
        <div className="space-y-1">
          <button
            onClick={() => setSelectedWorker(null)}
            className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs transition-all ${selectedWorker === null ? 'bg-bg-selected text-primary border border-primary/30' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover border border-transparent'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
            All Workers
          </button>
          {workingEmployees.map(emp => {
            const empLots = lotList.filter(l => l.employeeId === emp.id && (l.status === 'ISSUED' || l.status === 'IN_PROGRESS'));
            return (
              <button
                key={emp.id}
                onClick={() => setSelectedWorker(emp.id === selectedWorker ? null : emp.id)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs transition-all ${selectedWorker === emp.id ? 'bg-bg-selected text-primary border border-primary/30' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover border border-transparent'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${empLots.length > 0 ? 'bg-warning' : 'bg-success/50'}`} />
                <span className="truncate flex-1 text-left">{emp.fullName.split(' ')[0]}</span>
                {empLots.length > 0 && (
                  <span className="text-[9px] bg-warning-light text-warning px-1 rounded-full">{empLots.length}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Center: Kanban */}
      <div className="flex-1 min-w-0 px-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search lots, workers..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-bg-card border border-border-default rounded-md pl-9 pr-3 py-2 text-text-primary text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-text-muted"
            />
          </div>
          <button
            onClick={() => { setShowIssuePanel(true); setSelectedLot(null); setReceivingLot(null); }}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors flex-shrink-0"
          >
            <Plus size={14} />
            Issue Lot
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3 h-[calc(100vh-220px)]">
          {COLUMNS.map(col => {
            const colLots = filteredLots.filter(l => l.status === col.status);
            return (
              <div key={col.status} className={`border ${col.bg} rounded-md flex flex-col overflow-hidden`}>
                <div className="px-3 py-2.5 border-b border-border-default flex items-center justify-between">
                  <span className={`text-xs font-semibold ${col.color}`}>{col.label}</span>
                  <span className="text-text-muted text-[10px] font-mono bg-bg-hover px-1.5 rounded-full">{colLots.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin">
                  <AnimatePresence>
                    {colLots.map(lot => (
                      <LotCard
                        key={lot.id}
                        lot={lot}
                        onClick={() => { syncSelectedLot(lot); setShowIssuePanel(false); setReceivingLot(null); }}
                      />
                    ))}
                  </AnimatePresence>
                  {colLots.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-24 text-text-muted text-xs">
                      <span className="text-2xl mb-1">◇</span>
                      No lots
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Panels */}
      <AnimatePresence>
        {showIssuePanel && (
          <IssueLotPanel
            key="issue"
            onClose={() => setShowIssuePanel(false)}
            onSubmit={handleIssueLot}
          />
        )}

        {receivingLot && !showIssuePanel && (
          <ReceiveLotPanel
            key="receive"
            lot={receivingLot}
            onClose={() => setReceivingLot(null)}
            onReceive={handleReceiveLot}
          />
        )}

        {currentSelectedLot && !showIssuePanel && !receivingLot && (
          <motion.div
            key="detail"
            initial={{ x: 320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 320, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-80 bg-bg-card border-l border-border-default flex flex-col"
          >
            <div className="p-4 border-b border-border-default flex items-center justify-between">
              <div>
                <h3 className="text-text-primary font-semibold text-sm">{currentSelectedLot.lotName}</h3>
                <p className="text-text-muted text-[10px] font-mono mt-0.5">{currentSelectedLot.lotId}</p>
              </div>
              <button onClick={() => setSelectedLot(null)} className="text-text-muted hover:text-text-secondary">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <StatusChip status={currentSelectedLot.status} />

              <div className="space-y-3">
                <h4 className="text-text-muted text-[10px] uppercase tracking-wider font-medium">Issue Details</h4>
                {([
                  ['Worker', currentSelectedLot.employeeName],
                  ['Shape', currentSelectedLot.shape],
                  ['Qty', `${currentSelectedLot.qty} pcs`],
                  ['Issue Date', currentSelectedLot.issueDate],
                  ['Issue Weight', `${currentSelectedLot.issueWeight.toFixed(2)} ct`],
                  ['Est. Weight', `${currentSelectedLot.estimateWt.toFixed(2)} ct`],
                  ['Labour Head', currentSelectedLot.labourHead],
                  ['Lab', currentSelectedLot.lab ?? '—'],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-text-muted text-xs">{k}</span>
                    <span className="text-text-primary text-xs font-medium">{v}</span>
                  </div>
                ))}
              </div>

              {currentSelectedLot.polishedWt && (
                <div className="space-y-3 pt-3 border-t border-border-light">
                  <h4 className="text-text-muted text-[10px] uppercase tracking-wider font-medium">Received Details</h4>
                  {([
                    ['Received Date', currentSelectedLot.receivedDate ?? '—'],
                    ['Polished Weight', `${currentSelectedLot.polishedWt.toFixed(2)} ct`],
                    ['Color', currentSelectedLot.color ?? '—'],
                    ['Clarity', currentSelectedLot.clarity ?? '—'],
                    ['Cut', currentSelectedLot.cut ?? '—'],
                    ['Grader', currentSelectedLot.grader ?? '—'],
                    ['Days Consumed', currentSelectedLot.daysConsumed !== undefined ? `${currentSelectedLot.daysConsumed}d` : '—'],
                    ['Weight Loss', currentSelectedLot.weightDiff ? `${currentSelectedLot.weightDiff.toFixed(2)} ct` : '—'],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-text-muted text-xs">{k}</span>
                      <span className={`text-xs font-medium ${k === 'Weight Loss' ? 'text-warning' : 'text-text-primary'}`}>{v}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-border-light">
                    <span className="text-text-secondary text-xs font-medium">Labour Amount</span>
                    <span className="text-text-primary text-sm font-semibold font-mono">
                      {currentSelectedLot.labourAmount ? `₹${currentSelectedLot.labourAmount.toLocaleString()}` : '—'}
                    </span>
                  </div>
                </div>
              )}

              {currentSelectedLot.remarks && (
                <div className="p-3 rounded-md bg-warning-light border border-warning/20">
                  <p className="text-warning text-xs">{currentSelectedLot.remarks}</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border-default space-y-2">
              {(currentSelectedLot.status === 'ISSUED' || currentSelectedLot.status === 'IN_PROGRESS') && (
                <button
                  onClick={() => setReceivingLot(currentSelectedLot)}
                  className="w-full py-2.5 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors"
                >
                  <Check size={14} className="inline mr-2" />
                  Receive This Lot
                </button>
              )}
              {currentSelectedLot.status === 'RECEIVED' && (
                <button
                  onClick={() => handleVerifyLot(currentSelectedLot.id)}
                  className="w-full py-2.5 rounded-md bg-success text-white text-sm font-semibold hover:bg-success/90 transition-colors"
                >
                  <ShieldCheck size={14} className="inline mr-2" />
                  Verify &amp; Close Lot
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
