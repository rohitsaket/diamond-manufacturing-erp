import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, RefreshCw, Search, UserPlus, Info, Briefcase } from 'lucide-react';
import { orgApi } from '../../api/organization';
import type {
  Branch,
  CostCenter,
  Department,
  JobGrade,
  JobLevel,
  JobRole,
  Position,
} from '../../types/organization';
import {
  StatCard,
  Chip,
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
  inr,
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import {
  EntityFormModal,
  OrgStatusChip,
  DetailRow,
  formatDate,
  errMsg,
  type FieldDescriptor,
  type SelectOption,
} from './orgUi';

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const STATUSES = ['OPEN', 'FILLED', 'ON_HOLD', 'CLOSED'];

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERN', 'CONSULTANT'];

function niceType(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  return raw.replace(/_/g, ' ');
}

interface Options {
  jobRoles: SelectOption[];
  departments: SelectOption[];
  branches: SelectOption[];
  costCenters: SelectOption[];
  jobGrades: SelectOption[];
  jobLevels: SelectOption[];
  positions: SelectOption[];
}

const EMPTY_OPTIONS: Options = {
  jobRoles: [],
  departments: [],
  branches: [],
  costCenters: [],
  jobGrades: [],
  jobLevels: [],
  positions: [],
};

export function OrgPositions() {
  const [rows, setRows] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');

  const [detail, setDetail] = useState<Position | null>(null);
  const [editing, setEditing] = useState<Position | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const [options, setOptions] = useState<Options>(EMPTY_OPTIONS);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    orgApi.positions
      .list()
      .then((res) => setRows(asArray<Position>(res)))
      .catch((err: unknown) => {
        setError(errMsg(err, 'Failed to load positions'));
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Every select in the position form is filled by one round trip. */
  const loadOptions = useCallback(() => {
    if (optionsLoaded) return;
    Promise.all([
      orgApi.jobRoles.list(),
      orgApi.departments.list(),
      orgApi.branches.list(),
      orgApi.costCenters.list(),
      orgApi.jobGrades.list(),
      orgApi.jobLevels.list(),
      orgApi.positions.list(),
    ])
      .then(([jobRoles, departments, branches, costCenters, jobGrades, jobLevels, positions]) => {
        const opt = <T extends { id: number; name: string; code?: string }>(list: unknown): SelectOption[] =>
          asArray<T>(list).map((r) => ({
            value: r.id,
            label: r.code ? `${r.name} (${r.code})` : r.name,
          }));
        setOptions({
          jobRoles: opt<JobRole>(jobRoles),
          departments: opt<Department>(departments),
          branches: opt<Branch>(branches),
          costCenters: opt<CostCenter>(costCenters),
          jobGrades: opt<JobGrade>(jobGrades),
          jobLevels: opt<JobLevel>(jobLevels),
          positions: asArray<Position>(positions).map((p) => ({
            value: p.id,
            label: p.code ? `${p.title} (${p.code})` : p.title,
          })),
        });
        setOptionsLoaded(true);
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Failed to load form options')));
  }, [optionsLoaded]);

  // Stats -------------------------------------------------------------------
  const totals = useMemo(() => {
    let budgeted = 0;
    let filled = 0;
    let vacant = 0;
    for (const p of rows) {
      budgeted += num(p?.headcountBudgeted);
      filled += num(p?.occupancy);
      vacant += num(p?.vacancies);
    }
    return { budgeted, filled, vacant };
  }, [rows]);

  const fillRate = totals.budgeted > 0 ? (totals.filled / totals.budgeted) * 100 : null;

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of rows) map[String(p?.status ?? '')] = (map[String(p?.status ?? '')] ?? 0) + 1;
    return map;
  }, [rows]);

  const departmentFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of rows) {
      if (p?.departmentId != null) map.set(String(p.departmentId), String(p.departmentName ?? `#${p.departmentId}`));
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((p) => {
      if (status && String(p?.status ?? '') !== status) return false;
      if (departmentId && String(p?.departmentId ?? '') !== departmentId) return false;
      if (q) {
        const hay = `${p?.title ?? ''} ${p?.code ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, status, departmentId, search]);

  const vacancyRows = useMemo(
    () => rows.filter((p) => num(p?.vacancies) > 0).sort((a, b) => num(b?.vacancies) - num(a?.vacancies)),
    [rows],
  );

  // Form --------------------------------------------------------------------
  const fields: FieldDescriptor[] = useMemo(
    () => [
      { key: 'code', label: 'Code', type: 'text', required: true, placeholder: 'e.g. POS-QC-01' },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'jobRoleId', label: 'Job role', type: 'select', options: options.jobRoles, numeric: true },
      { key: 'departmentId', label: 'Department', type: 'select', options: options.departments, numeric: true },
      { key: 'branchId', label: 'Branch', type: 'select', options: options.branches, numeric: true },
      { key: 'costCenterId', label: 'Cost centre', type: 'select', options: options.costCenters, numeric: true },
      { key: 'jobGradeId', label: 'Job grade', type: 'select', options: options.jobGrades, numeric: true },
      { key: 'jobLevelId', label: 'Job level', type: 'select', options: options.jobLevels, numeric: true },
      {
        key: 'reportsToPositionId',
        label: 'Reports to position',
        type: 'select',
        options: options.positions.filter((o) => String(o.value) !== String(editing?.id ?? '')),
        numeric: true,
        full: true,
      },
      {
        key: 'headcountBudgeted',
        label: 'Budgeted headcount',
        type: 'number',
        required: true,
        hint: 'Must be at least 1 seat.',
      },
      { key: 'budgetAmount', label: 'Budget amount', type: 'number', hint: 'Annual cost allocated to this seat.' },
      {
        key: 'employmentType',
        label: 'Employment type',
        type: 'select',
        options: EMPLOYMENT_TYPES.map((t) => ({ value: t, label: niceType(t) })),
      },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        options: STATUSES.map((s) => ({ value: s, label: niceType(s) })),
      },
      { key: 'effectiveFrom', label: 'Effective from', type: 'date' },
    ],
    [options, editing],
  );

  const openCreate = () => {
    loadOptions();
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (p: Position) => {
    loadOptions();
    setCreating(false);
    setEditing(p);
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const submit = (values: Record<string, unknown>) => {
    const budgeted = Number(values.headcountBudgeted ?? 0);
    if (!Number.isFinite(budgeted) || budgeted < 1) {
      window.alert('Budgeted headcount must be at least 1.');
      return;
    }
    setSaving(true);
    const body = values as Partial<Position>;
    const req = editing ? orgApi.positions.update(num(editing.id), body) : orgApi.positions.create(body);
    req
      .then(() => {
        closeForm();
        setOptionsLoaded(false);
        load();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Failed to save position')))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-text-primary text-base font-semibold">Positions</h3>
          <p className="text-text-secondary text-xs mt-0.5">Budgeted seats, occupancy and open vacancies</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className={BTN_SECONDARY} onClick={load}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={14} /> Refresh
            </span>
          </button>
          <button className={BTN_PRIMARY} onClick={openCreate}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} /> New position
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total positions" value={rows.length} />
        <StatCard label="Budgeted seats" value={totals.budgeted} />
        <StatCard label="Filled" value={totals.filled} intent="success" />
        <StatCard label="Vacant" value={totals.vacant} intent={totals.vacant > 0 ? 'warning' : 'default'} />
        <StatCard
          label="Fill rate"
          value={fillRate === null ? '—' : `${fillRate.toFixed(1)}%`}
          hint={fillRate === null ? 'No budgeted seats' : `${totals.filled} of ${totals.budgeted} seats`}
          intent={fillRate === null ? 'default' : fillRate >= 90 ? 'success' : fillRate >= 70 ? 'warning' : 'danger'}
        />
      </div>

      {error && <ErrorBlock message={error} />}

      {/* Filters ---------------------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md p-3 space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setStatus('')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
              status === ''
                ? 'bg-primary-light border-primary/30 text-primary'
                : 'border-border-default text-text-muted hover:border-text-muted'
            }`}
          >
            All <span className="ml-1 text-text-muted">({rows.length})</span>
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(status === s ? '' : s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                status === s
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {niceType(s)} <span className="ml-1 text-text-muted">({statusCounts[s] ?? 0})</span>
            </button>
          ))}
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="w-56">
            <label className={LABEL_CLS} htmlFor="pos-dept">
              Department
            </label>
            <select
              id="pos-dept"
              className={INPUT_CLS}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">All departments</option>
              {departmentFilterOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className={LABEL_CLS} htmlFor="pos-search">
              Search
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                id="pos-search"
                className={`${INPUT_CLS} pl-8`}
                placeholder="Title or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table ------------------------------------------------------------ */}
      {loading ? (
        <LoadingBlock label="Loading positions…" />
      ) : filtered.length === 0 ? (
        <EmptyBlock
          message={rows.length === 0 ? 'No positions defined' : 'No positions match these filters'}
          hint={rows.length === 0 ? 'Create a position to start budgeting seats.' : 'Try clearing the filters.'}
        />
      ) : (
        <TableShell
          headers={[
            'Code',
            'Title',
            'Job role',
            'Department',
            'Branch',
            'Grade',
            'Budgeted',
            'Filled',
            'Vacant',
            'Status',
            '',
          ]}
        >
          {filtered.map((p) => {
            const vacant = num(p?.vacancies);
            return (
              <tr
                key={p?.id}
                onClick={() => setDetail(p)}
                className="hover:bg-bg-hover cursor-pointer"
              >
                <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{p?.code ?? '—'}</td>
                <td className="px-3 py-2 text-sm text-text-primary font-medium">{p?.title ?? '—'}</td>
                <td className="px-3 py-2 text-sm text-text-secondary">{p?.jobRoleName ?? '—'}</td>
                <td className="px-3 py-2 text-sm text-text-secondary">{p?.departmentName ?? '—'}</td>
                <td className="px-3 py-2 text-sm text-text-secondary">{p?.branchName ?? '—'}</td>
                <td className="px-3 py-2 text-sm text-text-secondary">
                  {p?.jobGradeId == null ? '—' : `#${p.jobGradeId}`}
                </td>
                <td className="px-3 py-2 text-sm text-text-primary tabular-nums">{num(p?.headcountBudgeted)}</td>
                <td className="px-3 py-2 text-sm text-text-primary tabular-nums">{num(p?.occupancy)}</td>
                <td
                  className={`px-3 py-2 text-sm tabular-nums ${vacant > 0 ? 'bg-warning-light text-warning font-medium' : 'text-text-secondary'}`}
                >
                  {vacant}
                </td>
                <td className="px-3 py-2">
                  <OrgStatusChip status={p?.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(p);
                    }}
                    aria-label="Edit position"
                    className="text-text-muted hover:text-primary transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </TableShell>
      )}

      {/* Vacancy panel ----------------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-text-primary text-sm font-semibold flex items-center gap-1.5">
              <Briefcase size={16} className="text-text-muted" /> Open vacancies
            </h3>
            <p className="text-text-muted text-[11px] mt-0.5">
              Seats budgeted but not occupied, most urgent first.
            </p>
          </div>
          <Chip label={`${totals.vacant} seats`} tone={totals.vacant > 0 ? 'warning' : 'default'} />
        </div>

        {vacancyRows.length === 0 ? (
          <EmptyBlock message="Every budgeted seat is filled" />
        ) : (
          <ul className="divide-y divide-border-light">
            {vacancyRows.map((p) => (
              <li key={p?.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-text-primary truncate">{p?.title ?? '—'}</p>
                  <p className="text-[11px] text-text-muted truncate">
                    {[p?.code, p?.departmentName, p?.branchName].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Chip label={`${num(p?.vacancies)} vacant`} tone="warning" />
                  <button
                    className={BTN_SECONDARY}
                    onClick={() =>
                      window.alert(
                        `Raise the requisition for “${p?.title ?? 'this position'}” on the Recruitment page — job openings and the candidate pipeline live there.`,
                      )
                    }
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <UserPlus size={14} /> Recruit
                    </span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-text-muted mt-3 flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          Requisitions themselves are not stored here — “Recruit” points you at the Recruitment page, where job
          openings and candidates are managed.
        </p>
      </div>

      {/* Detail ------------------------------------------------------------ */}
      {detail && (
        <ModalShell
          title={detail.title ?? 'Position'}
          subtitle={detail.code ?? null}
          onClose={() => setDetail(null)}
          maxWidth="max-w-xl"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button className={BTN_SECONDARY} onClick={() => setDetail(null)}>
                Close
              </button>
              <button
                className={BTN_PRIMARY}
                onClick={() => {
                  const target = detail;
                  setDetail(null);
                  openEdit(target);
                }}
              >
                Edit position
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <OrgStatusChip status={detail.status} />
              {num(detail.vacancies) > 0 && <Chip label={`${num(detail.vacancies)} vacant`} tone="warning" />}
            </div>

            <div>
              <DetailRow label="Job role" value={detail.jobRoleName ?? '—'} />
              <DetailRow label="Department" value={detail.departmentName ?? '—'} />
              <DetailRow label="Branch" value={detail.branchName ?? '—'} />
              <DetailRow label="Reports to" value={detail.reportsToTitle ?? '—'} />
              <DetailRow label="Employment type" value={niceType(detail.employmentType)} />
              <DetailRow label="Budgeted headcount" value={num(detail.headcountBudgeted)} />
              <DetailRow label="Filled" value={num(detail.occupancy)} />
              <DetailRow label="Vacant" value={num(detail.vacancies)} />
              <DetailRow
                label="Budget amount"
                value={detail.budgetAmount == null ? '—' : inr(detail.budgetAmount)}
              />
              <DetailRow label="Effective from" value={formatDate(detail.effectiveFrom)} />
              <DetailRow label="Effective to" value={formatDate(detail.effectiveTo)} />
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">Occupied by</p>
              {asArray<{ employeeId: number; employeeName: string; empCode: string }>(detail.occupiedBy).length ===
              0 ? (
                <p className="text-text-muted text-xs">Nobody holds this position yet.</p>
              ) : (
                <ul className="space-y-1">
                  {asArray<{ employeeId: number; employeeName: string; empCode: string }>(detail.occupiedBy).map(
                    (o) => (
                      <li
                        key={o?.employeeId}
                        className="flex items-center justify-between gap-2 text-sm text-text-primary"
                      >
                        <span>{o?.employeeName ?? '—'}</span>
                        <span className="text-text-muted text-xs">{o?.empCode ?? '—'}</span>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
          </div>
        </ModalShell>
      )}

      {/* Create / edit ------------------------------------------------------ */}
      {(creating || editing) && (
        <EntityFormModal
          title={editing ? 'Edit position' : 'New position'}
          subtitle={editing ? (editing.code ?? null) : 'Define a budgeted seat in the structure'}
          fields={fields}
          initial={editing as unknown as Record<string, unknown> | null}
          onClose={closeForm}
          onSubmit={submit}
          submitting={saving}
          submitLabel={editing ? 'Save changes' : 'Create position'}
        />
      )}
    </div>
  );
}
