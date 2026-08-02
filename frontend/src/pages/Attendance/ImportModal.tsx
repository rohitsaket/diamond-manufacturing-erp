import { useMemo, useState } from 'react';
import { Loader2, FileText } from 'lucide-react';
import { attendanceApi } from '../../api/hrms';
import type { PunchImportResult } from '../../types/hrms';
import { ModalShell } from '../../components/common/ModalShell';
import { StatCard, ErrorBlock, BTN_PRIMARY, BTN_SECONDARY } from '../../components/common/HrmsUI';

interface ImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

/** Preview-only split — the server does the authoritative parsing. */
function previewRows(csvText: string): string[][] {
  return csvText
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 8)
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

export function ImportModal({ onClose, onImported }: ImportModalProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PunchImportResult | null>(null);

  const preview = useMemo(() => previewRows(csvText), [csvText]);

  const handleFile = (file: File | null) => {
    setResult(null);
    setError(null);
    if (!file) {
      setFileName(null);
      setCsvText('');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csvText.trim()) {
      setError('Choose a CSV file first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await attendanceApi.importPunches(csvText);
      setResult(res);
      onImported();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      setError(message);
      window.alert(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Import biometric punches"
      subtitle="Upload a punch export and let the server build attendance"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Close
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={busy || !csvText.trim()}
            className={`${BTN_PRIMARY} flex items-center gap-2`}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Import
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="bg-bg-secondary border border-border-default rounded-md p-3">
          <p className="text-text-secondary text-xs">
            Expected header:{' '}
            <code className="font-mono text-text-primary">emp_code,date,in_time,out_time</code>
          </p>
          <p className="text-text-muted text-[11px] mt-1">
            Dates are <span className="font-mono">YYYY-MM-DD</span> and times{' '}
            <span className="font-mono">HH:MM</span>. Several rows for the same employee on the same
            day are collapsed into the earliest in-time and the latest out-time.
          </p>
        </div>

        <div>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-text-secondary file:mr-3 file:px-3 file:py-2 file:rounded-md file:border file:border-border-default file:bg-bg-secondary file:text-text-secondary file:text-xs file:font-medium hover:file:bg-bg-hover file:cursor-pointer"
          />
          {fileName && (
            <p className="flex items-center gap-1.5 text-text-muted text-[11px] mt-2">
              <FileText size={12} />
              {fileName}
            </p>
          )}
        </div>

        {preview.length > 0 && (
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider font-medium mb-1.5">
              Preview · first {preview.length} line{preview.length === 1 ? '' : 's'}
            </p>
            <div className="rounded-md border border-border-default overflow-x-auto">
              <table className="w-full">
                <tbody className="divide-y divide-border-light">
                  {preview.map((cells, rowIdx) => (
                    <tr key={rowIdx} className={rowIdx === 0 ? 'bg-bg-secondary' : ''}>
                      {cells.map((cell, cellIdx) => (
                        <td
                          key={cellIdx}
                          className={`px-2 py-1 text-[11px] font-mono whitespace-nowrap ${
                            rowIdx === 0 ? 'text-text-secondary font-semibold' : 'text-text-primary'
                          }`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {error && <ErrorBlock message={error} />}

        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Imported" value={result.imported} intent="success" />
              <StatCard
                label="Skipped"
                value={result.skipped}
                intent={result.skipped > 0 ? 'warning' : 'default'}
              />
            </div>
            {result.errors.length > 0 && (
              <div>
                <p className="text-text-muted text-[10px] uppercase tracking-wider font-medium mb-1.5">
                  {result.errors.length} row error{result.errors.length === 1 ? '' : 's'}
                </p>
                <div className="max-h-40 overflow-y-auto rounded-md border border-danger/30 bg-danger-light p-2 space-y-1">
                  {result.errors.map((e, i) => (
                    <p key={`${e.line}-${i}`} className="text-danger text-xs">
                      <span className="font-mono">Line {e.line}</span> — {e.reason}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
