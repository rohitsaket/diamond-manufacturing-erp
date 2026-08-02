import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { engagementApi } from '../../../api/hrms';
import {
  TableShell,
  Chip,
  StatCard,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  BTN_SECONDARY,
} from '../../../components/common/HrmsUI';
import { formatDate, errorMessage } from '../ProfileField';

interface AssetRow {
  id: number;
  assetCode: string;
  name: string;
  category: string;
  serialNo: string | null;
  status: string;
  assignedToId: number | null;
  assignedToName: string | null;
  assignedOn: string | null;
}

/** Tones for the asset categories the register actually uses. */
const CATEGORY_TONE: Record<string, 'default' | 'info' | 'primary' | 'warning'> = {
  TOOL: 'primary',
  MACHINE: 'warning',
  DEVICE: 'info',
  FURNITURE: 'default',
  OTHER: 'default',
};

const CATEGORY_LABEL: Record<string, string> = {
  TOOL: 'Tool',
  MACHINE: 'Machine',
  DEVICE: 'Device',
  FURNITURE: 'Furniture',
  OTHER: 'Other',
};

export function AssetsSection({
  employeeId,
  onNavigate,
}: {
  employeeId: number;
  onNavigate?: (page: string) => void;
}) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('ALL');

  const load = useCallback(() => {
    setLoading(true);
    engagementApi
      .assets({})
      .then((rows) => {
        setAssets((rows ?? []) as AssetRow[]);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const mine = useMemo(
    () => assets.filter((a) => Number(a.assignedToId) === Number(employeeId)),
    [assets, employeeId],
  );

  // Only offer filters for categories this employee actually holds, so the
  // chips never promise a group that turns up empty.
  const categories = useMemo(() => {
    const set = new Set(mine.map((a) => a.category ?? 'OTHER'));
    return [...set];
  }, [mine]);

  const visible = category === 'ALL' ? mine : mine.filter((a) => (a.category ?? 'OTHER') === category);

  if (loading && assets.length === 0) return <LoadingBlock label="Loading assigned assets…" />;
  if (error && assets.length === 0) return <ErrorBlock message={error} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Assets held" value={mine.length} />
        <StatCard label="Categories" value={categories.length} />
        <StatCard
          label="Longest held"
          value={
            mine.length === 0
              ? '—'
              : formatDate(
                  mine
                    .map((a) => a.assignedOn)
                    .filter(Boolean)
                    .sort()[0] as string,
                ) || '—'
          }
        />
      </div>

      {categories.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          {['ALL', ...categories].map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                category === c
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {c === 'ALL' ? 'All' : (CATEGORY_LABEL[c] ?? c)}
              <span className="ml-1.5 text-text-muted">
                ({c === 'ALL' ? mine.length : mine.filter((a) => (a.category ?? 'OTHER') === c).length})
              </span>
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyBlock
          message="No assets assigned"
          hint="Tools, devices and access cards issued to this employee will be listed here."
        />
      ) : (
        <TableShell headers={['Asset code', 'Name', 'Category', 'Serial no.', 'Assigned on']}>
          {visible.map((a) => (
            <tr key={a.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-text-primary text-xs font-mono">{a.assetCode}</td>
              <td className="px-3 py-2 text-text-primary text-xs font-medium">{a.name}</td>
              <td className="px-3 py-2">
                <Chip
                  label={CATEGORY_LABEL[a.category] ?? a.category}
                  tone={CATEGORY_TONE[a.category] ?? 'default'}
                />
              </td>
              <td className="px-3 py-2 text-text-secondary text-xs font-mono">{a.serialNo ?? '—'}</td>
              <td className="px-3 py-2 text-text-secondary text-xs">{formatDate(a.assignedOn) || '—'}</td>
            </tr>
          ))}
        </TableShell>
      )}

      {onNavigate && (
        <button
          onClick={() => onNavigate('hr')}
          className={`${BTN_SECONDARY} inline-flex items-center gap-1.5`}
        >
          Assign or return assets <ArrowRight size={13} />
        </button>
      )}

      <p className="text-text-muted text-[11px]">
        Assets are issued from the shared register, so assignment and return are handled on the HR page.
      </p>
    </div>
  );
}
