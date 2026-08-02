import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, ArrowRight, X } from 'lucide-react';
import {
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
  inr,
} from '../../components/common/HrmsUI';
import { TabBar, type TabItem } from '../../components/common/TabBar';
import { orgApi } from '../../api/organization';
import type { JobFamily, JobFunction, JobGrade, JobLevel, JobRole, CareerPath } from '../../types/organization';
import { OrgStatusChip, EntityFormModal, errMsg, type FieldDescriptor, type SelectOption } from './orgUi';

type SubId = 'families' | 'functions' | 'grades' | 'levels' | 'roles' | 'paths';

const SUB_TABS: TabItem[] = [
  { id: 'families', label: 'Families' },
  { id: 'functions', label: 'Functions' },
  { id: 'grades', label: 'Grades' },
  { id: 'levels', label: 'Levels' },
  { id: 'roles', label: 'Roles' },
  { id: 'paths', label: 'Career paths' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const CAREER_STAGES: SelectOption[] = [
  { value: 'ENTRY', label: 'Entry' },
  { value: 'JUNIOR', label: 'Junior' },
  { value: 'MID', label: 'Mid' },
  { value: 'SENIOR', label: 'Senior' },
  { value: 'LEAD', label: 'Lead' },
  { value: 'MANAGEMENT', label: 'Management' },
  { value: 'EXECUTIVE', label: 'Executive' },
];

interface SimpleCrud {
  create: (body: Record<string, unknown>) => Promise<unknown>;
  update: (id: number, body: Record<string, unknown>) => Promise<unknown>;
  remove: (id: number) => Promise<{ success: boolean }>;
}

const CRUD: Record<Exclude<SubId, 'paths'>, SimpleCrud> = {
  families: orgApi.jobFamilies as unknown as SimpleCrud,
  functions: orgApi.jobFunctions as unknown as SimpleCrud,
  grades: orgApi.jobGrades as unknown as SimpleCrud,
  levels: orgApi.jobLevels as unknown as SimpleCrud,
  roles: orgApi.jobRoles as unknown as SimpleCrud,
};

const SINGULAR: Record<Exclude<SubId, 'paths'>, string> = {
  families: 'job family',
  functions: 'job function',
  grades: 'job grade',
  levels: 'job level',
  roles: 'job role',
};

const byRank = <T extends { rankOrder: number; code: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => a.rankOrder - b.rankOrder || a.code.localeCompare(b.code));

const salaryBand = (grade: JobGrade): string => {
  if (grade.minSalary === null && grade.maxSalary === null) return '—';
  return `${grade.minSalary === null ? '—' : inr(grade.minSalary)} – ${
    grade.maxSalary === null ? '—' : inr(grade.maxSalary)
  }`;
};

/** Job families, functions, grades, levels, roles and the paths between roles. */
export function OrgJobArchitecture({ canEdit }: { canEdit: boolean }) {
  const [sub, setSub] = useState<SubId>('families');

  const [families, setFamilies] = useState<JobFamily[]>([]);
  const [functions, setFunctions] = useState<JobFunction[]>([]);
  const [grades, setGrades] = useState<JobGrade[]>([]);
  const [levels, setLevels] = useState<JobLevel[]>([]);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [paths, setPaths] = useState<CareerPath[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      orgApi.jobFamilies.list({}),
      orgApi.jobFunctions.list({}),
      orgApi.jobGrades.list({}),
      orgApi.jobLevels.list({}),
      orgApi.jobRoles.list({}),
      orgApi.careerPaths(),
    ])
      .then(([f, fn, g, l, r, p]) => {
        setFamilies(f ?? []);
        setFunctions(fn ?? []);
        setGrades(g ?? []);
        setLevels(l ?? []);
        setRoles(r ?? []);
        setPaths(p ?? []);
      })
      .catch((err: unknown) => setError(errMsg(err, 'Could not load the job architecture')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const roleOptions = useMemo<SelectOption[]>(
    () => roles.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })),
    [roles],
  );

  const fields = useMemo<FieldDescriptor[]>(() => {
    const codeName: FieldDescriptor[] = [
      { key: 'code', label: 'Code', type: 'text', required: true, hint: 'Unique, short, uppercase' },
      { key: 'name', label: 'Name', type: 'text', required: true },
    ];
    const status: FieldDescriptor = { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS };
    const description: FieldDescriptor = { key: 'description', label: 'Description', type: 'textarea' };

    switch (sub) {
      case 'functions':
        return [
          ...codeName,
          {
            key: 'jobFamilyId',
            label: 'Job family',
            type: 'select',
            required: true,
            numeric: true,
            options: families.map((f) => ({ value: f.id, label: `${f.code} · ${f.name}` })),
          },
          description,
          status,
        ];
      case 'grades':
        return [
          ...codeName,
          { key: 'rankOrder', label: 'Rank order', type: 'number', hint: 'Lower ranks sort first' },
          { key: 'minSalary', label: 'Minimum salary', type: 'number' },
          { key: 'maxSalary', label: 'Maximum salary', type: 'number' },
          { key: 'currency', label: 'Currency', type: 'text', placeholder: 'INR' },
          description,
          status,
        ];
      case 'levels':
        return [
          ...codeName,
          { key: 'rankOrder', label: 'Rank order', type: 'number' },
          { key: 'careerStage', label: 'Career stage', type: 'select', options: CAREER_STAGES },
          description,
          status,
        ];
      case 'roles':
        return [
          ...codeName,
          {
            key: 'jobFunctionId',
            label: 'Job function',
            type: 'select',
            numeric: true,
            options: functions.map((f) => ({ value: f.id, label: `${f.code} · ${f.name}` })),
          },
          {
            key: 'jobGradeId',
            label: 'Job grade',
            type: 'select',
            numeric: true,
            options: grades.map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` })),
          },
          {
            key: 'jobLevelId',
            label: 'Job level',
            type: 'select',
            numeric: true,
            options: levels.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` })),
          },
          description,
          { key: 'responsibilities', label: 'Responsibilities', type: 'textarea' },
          status,
        ];
      case 'families':
      default:
        return [...codeName, description, status];
    }
  }, [sub, families, functions, grades, levels]);

  const submit = (values: Record<string, unknown>) => {
    if (sub === 'paths') return;
    setSaving(true);
    const id = editing ? Number(editing.id) : null;
    const action = id !== null ? CRUD[sub].update(id, values) : CRUD[sub].create(values);
    action
      .then(() => {
        setEditing(null);
        setCreating(false);
        load();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not save this record')))
      .finally(() => setSaving(false));
  };

  const remove = (id: number, name: string) => {
    if (sub === 'paths') return;
    if (!window.confirm(`Delete ${SINGULAR[sub]} "${name}"? This cannot be undone.`)) return;
    CRUD[sub]
      .remove(id)
      .then(() => load())
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not delete this record')));
  };

  const actionsCell = (row: { id: number; name: string }) =>
    canEdit ? (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          aria-label={`Edit ${row.name}`}
          onClick={() => setEditing(row as unknown as Record<string, unknown>)}
          className="text-text-muted hover:text-primary transition-colors"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          aria-label={`Delete ${row.name}`}
          onClick={() => remove(row.id, row.name)}
          className="text-text-muted hover:text-danger transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </span>
    ) : (
      <span className="text-text-muted text-xs">—</span>
    );

  const codeCell = (code: string) => (
    <td className="px-3 py-2 text-text-muted text-[11px] font-mono whitespace-nowrap">{code}</td>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <TabBar tabs={SUB_TABS} active={sub} onChange={(id) => setSub(id as SubId)} />
        <div className="flex items-center gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={load} aria-label="Reload the job architecture">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {canEdit && sub !== 'paths' && (
            <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} /> New {SINGULAR[sub]}
              </span>
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading the job architecture…" />
      ) : (
        <>
          {sub === 'families' &&
            (families.length === 0 ? (
              <Empty label="job families" />
            ) : (
              <TableShell headers={['Code', 'Name', 'Description', 'Status', '']}>
                {families.map((f) => (
                  <tr key={f.id} className="hover:bg-bg-hover transition-colors">
                    {codeCell(f.code)}
                    <td className="px-3 py-2 text-text-primary text-sm">{f.name}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs">{f.description ?? '—'}</td>
                    <td className="px-3 py-2">
                      <OrgStatusChip status={f.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{actionsCell(f)}</td>
                  </tr>
                ))}
              </TableShell>
            ))}

          {sub === 'functions' &&
            (functions.length === 0 ? (
              <Empty label="job functions" />
            ) : (
              <TableShell headers={['Code', 'Name', 'Family', 'Description', 'Status', '']}>
                {functions.map((fn) => (
                  <tr key={fn.id} className="hover:bg-bg-hover transition-colors">
                    {codeCell(fn.code)}
                    <td className="px-3 py-2 text-text-primary text-sm">{fn.name}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs">{fn.jobFamilyName ?? '—'}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs">{fn.description ?? '—'}</td>
                    <td className="px-3 py-2">
                      <OrgStatusChip status={fn.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{actionsCell(fn)}</td>
                  </tr>
                ))}
              </TableShell>
            ))}

          {sub === 'grades' &&
            (grades.length === 0 ? (
              <Empty label="job grades" />
            ) : (
              <TableShell headers={['Rank', 'Code', 'Name', 'Salary band', 'Status', '']}>
                {byRank(grades).map((g) => (
                  <tr key={g.id} className="hover:bg-bg-hover transition-colors">
                    <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">{g.rankOrder}</td>
                    {codeCell(g.code)}
                    <td className="px-3 py-2 text-text-primary text-sm">{g.name}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs tabular-nums whitespace-nowrap">
                      {salaryBand(g)}
                    </td>
                    <td className="px-3 py-2">
                      <OrgStatusChip status={g.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{actionsCell(g)}</td>
                  </tr>
                ))}
              </TableShell>
            ))}

          {sub === 'levels' &&
            (levels.length === 0 ? (
              <Empty label="job levels" />
            ) : (
              <TableShell headers={['Rank', 'Code', 'Name', 'Career stage', 'Status', '']}>
                {byRank(levels).map((l) => (
                  <tr key={l.id} className="hover:bg-bg-hover transition-colors">
                    <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">{l.rankOrder}</td>
                    {codeCell(l.code)}
                    <td className="px-3 py-2 text-text-primary text-sm">{l.name}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs">
                      {CAREER_STAGES.find((s) => s.value === l.careerStage)?.label ?? l.careerStage}
                    </td>
                    <td className="px-3 py-2">
                      <OrgStatusChip status={l.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{actionsCell(l)}</td>
                  </tr>
                ))}
              </TableShell>
            ))}

          {sub === 'roles' &&
            (roles.length === 0 ? (
              <Empty label="job roles" />
            ) : (
              <TableShell headers={['Code', 'Name', 'Function', 'Grade', 'Level', 'Status', '']}>
                {roles.map((r) => (
                  <tr key={r.id} className="hover:bg-bg-hover transition-colors">
                    {codeCell(r.code)}
                    <td className="px-3 py-2 text-text-primary text-sm">{r.name}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs">{r.jobFunctionName ?? '—'}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs font-mono">{r.jobGradeCode ?? '—'}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs font-mono">{r.jobLevelCode ?? '—'}</td>
                    <td className="px-3 py-2">
                      <OrgStatusChip status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{actionsCell(r)}</td>
                  </tr>
                ))}
              </TableShell>
            ))}

          {sub === 'paths' && (
            <CareerPaths
              canEdit={canEdit}
              paths={paths}
              roleOptions={roleOptions}
              onChanged={load}
            />
          )}
        </>
      )}

      {(creating || editing) && sub !== 'paths' && (
        <EntityFormModal
          title={editing ? `Edit ${SINGULAR[sub]}` : `New ${SINGULAR[sub]}`}
          subtitle={editing ? String(editing.name ?? '') : null}
          fields={fields}
          initial={editing}
          submitting={saving}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="bg-bg-card border border-border-default rounded-md">
      <EmptyBlock message={`No ${label} yet`} hint="Define them here so roles and positions can reference them." />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Career paths
// ---------------------------------------------------------------------------

function CareerPaths({
  canEdit,
  paths,
  roleOptions,
  onChanged,
}: {
  canEdit: boolean;
  paths: CareerPath[];
  roleOptions: SelectOption[];
  onChanged: () => void;
}) {
  const [fromRoleId, setFromRoleId] = useState('');
  const [toRoleId, setToRoleId] = useState('');
  const [typicalYears, setTypicalYears] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, CareerPath[]>();
    for (const p of paths) {
      const list = map.get(p.fromRoleName) ?? [];
      list.push(p);
      map.set(p.fromRoleName, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [paths]);

  const add = () => {
    if (!fromRoleId || !toRoleId) {
      window.alert('Choose both a source and a target role.');
      return;
    }
    if (fromRoleId === toRoleId) {
      window.alert('A career path needs two different roles.');
      return;
    }
    setBusy(true);
    orgApi
      .createCareerPath({
        fromRoleId: Number(fromRoleId),
        toRoleId: Number(toRoleId),
        typicalYears: typicalYears === '' ? undefined : Number(typicalYears),
        notes: notes.trim() || undefined,
      })
      .then(() => {
        setFromRoleId('');
        setToRoleId('');
        setTypicalYears('');
        setNotes('');
        onChanged();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not create this career path')))
      .finally(() => setBusy(false));
  };

  const remove = (path: CareerPath) => {
    if (!window.confirm(`Remove the path from ${path.fromRoleName} to ${path.toRoleName}?`)) return;
    orgApi
      .deleteCareerPath(path.id)
      .then(() => onChanged())
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not delete this career path')));
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="bg-bg-card border border-border-default rounded-md p-3">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">Add a career path</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_minmax(0,1fr)_auto] gap-2 items-end">
            <select
              className={INPUT_CLS}
              aria-label="From role"
              value={fromRoleId}
              onChange={(e) => setFromRoleId(e.target.value)}
            >
              <option value="">— from role —</option>
              {roleOptions.map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              className={INPUT_CLS}
              aria-label="To role"
              value={toRoleId}
              onChange={(e) => setToRoleId(e.target.value)}
            >
              <option value="">— to role —</option>
              {roleOptions.map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className={INPUT_CLS}
              type="number"
              min={0}
              step="0.5"
              placeholder="Years"
              aria-label="Typical years"
              value={typicalYears}
              onChange={(e) => setTypicalYears(e.target.value)}
            />
            <input
              className={INPUT_CLS}
              placeholder="Notes"
              aria-label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button type="button" className={BTN_PRIMARY} onClick={add} disabled={busy}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} /> Add
              </span>
            </button>
          </div>
        </div>
      )}

      {grouped.length === 0 ? (
        <div className="bg-bg-card border border-border-default rounded-md">
          <EmptyBlock
            message="No career paths defined"
            hint="Map how people progress from one role to the next."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {grouped.map(([fromName, list]) => (
            <div key={fromName} className="bg-bg-card border border-border-default rounded-md p-3">
              <p className="text-text-primary text-sm font-medium mb-2">{fromName}</p>
              <div className="space-y-1.5">
                {list.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-bg-secondary border border-border-light"
                  >
                    <ArrowRight size={14} className="text-primary mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-text-primary text-xs">{p.toRoleName}</p>
                      <p className="text-text-muted text-[10px]">
                        {p.typicalYears === null ? 'Typical duration not set' : `Typically ${p.typicalYears} yr`}
                        {p.notes ? ` · ${p.notes}` : ''}
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Delete the path from ${p.fromRoleName} to ${p.toRoleName}`}
                        onClick={() => remove(p)}
                        className="text-text-muted hover:text-danger transition-colors shrink-0"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
