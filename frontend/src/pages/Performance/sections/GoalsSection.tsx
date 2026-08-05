import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { performanceApi } from '../../../api/performance';
import { orgApi } from '../../../api/organization';
import { useApp } from '../../../contexts/AppContext';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  TableShell,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { TabBar } from '../../../components/common/TabBar';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const SCOPES = ['ALL', 'ORGANIZATION', 'DEPARTMENT', 'TEAM', 'INDIVIDUAL'] as const;
const STATUSES = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'REJECTED'] as const;
const KINDS = ['GOAL', 'OBJECTIVE', 'KEY_RESULT'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const VISIBILITIES = ['PRIVATE', 'MANAGER', 'ORGANIZATION'] as const;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function fmtDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'info';
    case 'COMPLETED':
      return 'success';
    case 'PENDING_APPROVAL':
      return 'warning';
    case 'CANCELLED':
    case 'REJECTED':
      return 'danger';
    case 'DRAFT':
    default:
      return 'default';
  }
}

function kindTone(kind: unknown): Tone {
  switch (String(kind ?? '').toUpperCase()) {
    case 'OBJECTIVE':
      return 'primary';
    case 'KEY_RESULT':
      return 'info';
    default:
      return 'default';
  }
}

function owner(goal: any): string {
  if (goal?.employeeName) return String(goal.employeeName);
  if (goal?.teamName) return `Team: ${goal.teamName}`;
  if (goal?.departmentName) return `Dept: ${goal.departmentName}`;
  return 'Organization';
}

function ProgressBar({ pct }: { pct: number | null }) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="h-1.5 flex-1 rounded-full bg-bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full ${p >= 100 ? 'bg-success' : 'bg-primary'}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className="text-text-secondary text-[11px] font-mono tabular-nums w-11 text-right">
        {pct === null ? '—' : `${p.toFixed(0)}%`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OKR tree node
// ---------------------------------------------------------------------------

function GoalNode({ node, depth, onOpen }: { node: any; depth: number; onOpen: (id: number) => void }) {
  const [open, setOpen] = useState(true);
  const children: any[] = Array.isArray(node?.children) ? node.children : [];
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-bg-hover transition-colors"
        style={{ marginLeft: depth * 22 }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            className="text-text-muted hover:text-text-primary flex-shrink-0"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-[14px] flex-shrink-0" />
        )}
        <Chip label={text(node?.kind).replace(/_/g, ' ')} tone={kindTone(node?.kind)} />
        <button
          type="button"
          className="text-text-primary text-xs font-medium truncate hover:text-primary text-left"
          onClick={() => onOpen(Number(node?.id))}
        >
          {text(node?.title)}
        </button>
        <span className="text-text-muted text-[11px] flex-shrink-0">w {num(node?.weightagePct) ?? 0}%</span>
        <div className="w-40 flex-shrink-0 ml-auto">
          <ProgressBar pct={num(node?.progressPct)} />
        </div>
      </div>
      {open &&
        children.map((child) => (
          <GoalNode key={child?.id} node={child} depth={depth + 1} onOpen={onOpen} />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function GoalsSection() {
  const { employees } = useApp();

  const [tab, setTab] = useState('list');

  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);

  // List tab state.
  const [goals, setGoals] = useState<any[]>([]);
  const [scope, setScope] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [kind, setKind] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tree tab.
  const [tree, setTree] = useState<any[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  // Templates tab.
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  // Detail modal.
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [updates, setUpdates] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [progressPct, setProgressPct] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [progressNote, setProgressNote] = useState('');
  const [msTitle, setMsTitle] = useState('');
  const [msDue, setMsDue] = useState('');

  // Create goal modal.
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [gForm, setGForm] = useState({
    kind: 'GOAL',
    scope: 'INDIVIDUAL',
    employeeId: '',
    teamId: '',
    departmentId: '',
    parentGoalId: '',
    title: '',
    description: '',
    category: '',
    metricName: '',
    metricUnit: '',
    startValue: '',
    targetValue: '',
    weightagePct: '',
    priority: 'MEDIUM',
    visibility: 'MANAGER',
    dueDate: '',
  });

  // Template modals.
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [tplEditing, setTplEditing] = useState<any>(null);
  const [tplError, setTplError] = useState<string | null>(null);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplForm, setTplForm] = useState({
    code: '',
    name: '',
    kind: 'GOAL',
    scope: 'INDIVIDUAL',
    category: '',
    titleTemplate: '',
    descriptionTemplate: '',
    metricName: '',
    metricUnit: '',
    suggestedWeightagePct: '',
  });

  const [assignTpl, setAssignTpl] = useState<any>(null);
  const [assignEmployeeIds, setAssignEmployeeIds] = useState<number[]>([]);
  const [assignTarget, setAssignTarget] = useState('');
  const [assignDue, setAssignDue] = useState('');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<any>(null);

  // Reference data once.
  useEffect(() => {
    performanceApi
      .cycles()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setCycles(list);
        const active = list.find((c) => String(c?.status) === 'ACTIVE') ?? list[0];
        setCycleId(active ? Number(active.id) : null);
        if (!active) {
          setLoading(false);
          setFirstLoad(false);
        }
      })
      .catch((err) => {
        setError(reason(err));
        setLoading(false);
        setFirstLoad(false);
      });
    orgApi.departments.list().then((d) => setDepartments(Array.isArray(d) ? d : [])).catch(() => {});
    orgApi.teams.list().then((t) => setTeams(Array.isArray(t) ? t : [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (cycleId === null) return;
    setLoading(true);
    setError(null);
    performanceApi
      .goals({
        cycleId,
        scope: scope === 'ALL' ? undefined : scope,
        status: status === 'ALL' ? undefined : status,
        kind: kind === 'ALL' ? undefined : kind,
      })
      .then((rows) => setGoals(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [cycleId, scope, status, kind]);

  useEffect(() => {
    load();
  }, [load]);

  const loadTree = useCallback(() => {
    if (cycleId === null) return;
    setTreeLoading(true);
    setTreeError(null);
    performanceApi
      .goalTree(cycleId)
      .then((rows) => setTree(Array.isArray(rows) ? rows : []))
      .catch((err) => setTreeError(reason(err)))
      .finally(() => setTreeLoading(false));
  }, [cycleId]);

  const loadTemplates = useCallback(() => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    performanceApi
      .goalTemplates()
      .then((rows) => setTemplates(Array.isArray(rows) ? rows : []))
      .catch((err) => setTemplatesError(reason(err)))
      .finally(() => setTemplatesLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'tree') loadTree();
    if (tab === 'templates') loadTemplates();
  }, [tab, loadTree, loadTemplates]);

  const openDetail = useCallback((id: number) => {
    setDetailId(id);
    setDetail(null);
    setUpdates([]);
    setDetailError(null);
    setDetailLoading(true);
    setProgressPct('');
    setCurrentValue('');
    setProgressNote('');
    setMsTitle('');
    setMsDue('');
    Promise.all([performanceApi.goal(id), performanceApi.goalUpdates(id).catch(() => [] as any[])])
      .then(([g, u]) => {
        setDetail(g ?? null);
        setUpdates(Array.isArray(u) ? u : []);
      })
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setDetailLoading(false));
  }, []);

  const refreshDetail = useCallback(() => {
    if (detailId !== null) openDetail(detailId);
    load();
    if (tab === 'tree') loadTree();
  }, [detailId, openDetail, load, loadTree, tab]);

  const act = (fn: () => Promise<any>) => {
    setActing(true);
    setDetailError(null);
    fn()
      .then(() => refreshDetail())
      // 400s (weightage caps and the like) surface verbatim.
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setActing(false));
  };

  const filteredGoals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return goals;
    return goals.filter(
      (g) =>
        String(g?.title ?? '').toLowerCase().includes(q) ||
        owner(g).toLowerCase().includes(q) ||
        String(g?.category ?? '').toLowerCase().includes(q),
    );
  }, [goals, search]);

  // Parent goal options for the create modal — a KEY_RESULT may only hang off
  // an OBJECTIVE; the backend enforces this and the select mirrors it.
  const parentOptions = useMemo(() => {
    if (gForm.kind === 'KEY_RESULT') return goals.filter((g) => String(g?.kind) === 'OBJECTIVE');
    return goals;
  }, [goals, gForm.kind]);

  const submitCreate = () => {
    setCreating(true);
    setCreateError(null);
    const body: Record<string, unknown> = {
      cycleId,
      kind: gForm.kind,
      scope: gForm.scope,
      title: gForm.title.trim(),
      description: gForm.description.trim() || undefined,
      category: gForm.category.trim() || undefined,
      priority: gForm.priority,
      visibility: gForm.visibility,
      dueDate: gForm.dueDate || undefined,
      parentGoalId: gForm.parentGoalId === '' ? undefined : Number(gForm.parentGoalId),
      employeeId: gForm.scope === 'INDIVIDUAL' && gForm.employeeId !== '' ? Number(gForm.employeeId) : undefined,
      teamId: gForm.scope === 'TEAM' && gForm.teamId !== '' ? Number(gForm.teamId) : undefined,
      departmentId:
        gForm.scope === 'DEPARTMENT' && gForm.departmentId !== '' ? Number(gForm.departmentId) : undefined,
      metricName: gForm.metricName.trim() || undefined,
      metricUnit: gForm.metricUnit.trim() || undefined,
      startValue: gForm.startValue === '' ? undefined : Number(gForm.startValue),
      targetValue: gForm.targetValue === '' ? undefined : Number(gForm.targetValue),
      weightagePct: gForm.weightagePct === '' ? undefined : Number(gForm.weightagePct),
    };
    performanceApi
      .createGoal(body)
      .then(() => {
        setCreateOpen(false);
        load();
      })
      // The weightage-cap 400 (and every other validation) is shown verbatim.
      .catch((err) => setCreateError(reason(err)))
      .finally(() => setCreating(false));
  };

  const openTplModal = (tpl: any | null) => {
    setTplEditing(tpl);
    setTplError(null);
    setTplForm({
      code: String(tpl?.code ?? ''),
      name: String(tpl?.name ?? ''),
      kind: String(tpl?.kind ?? 'GOAL'),
      scope: String(tpl?.scope ?? 'INDIVIDUAL'),
      category: String(tpl?.category ?? ''),
      titleTemplate: String(tpl?.titleTemplate ?? ''),
      descriptionTemplate: String(tpl?.descriptionTemplate ?? ''),
      metricName: String(tpl?.metricName ?? ''),
      metricUnit: String(tpl?.metricUnit ?? ''),
      suggestedWeightagePct: tpl?.suggestedWeightagePct === null || tpl?.suggestedWeightagePct === undefined ? '' : String(tpl.suggestedWeightagePct),
    });
    setTplModalOpen(true);
  };

  const saveTemplate = () => {
    setTplSaving(true);
    setTplError(null);
    const body: Record<string, unknown> = {
      code: tplForm.code.trim(),
      name: tplForm.name.trim(),
      kind: tplForm.kind,
      scope: tplForm.scope,
      category: tplForm.category.trim() || null,
      titleTemplate: tplForm.titleTemplate.trim(),
      descriptionTemplate: tplForm.descriptionTemplate.trim() || null,
      metricName: tplForm.metricName.trim() || null,
      metricUnit: tplForm.metricUnit.trim() || null,
      suggestedWeightagePct: tplForm.suggestedWeightagePct === '' ? undefined : Number(tplForm.suggestedWeightagePct),
    };
    const call = tplEditing
      ? performanceApi.updateGoalTemplate(Number(tplEditing.id), body)
      : performanceApi.createGoalTemplate(body);
    call
      .then(() => {
        setTplModalOpen(false);
        loadTemplates();
      })
      .catch((err) => setTplError(reason(err)))
      .finally(() => setTplSaving(false));
  };

  const runAssign = () => {
    if (!assignTpl || cycleId === null) return;
    setAssigning(true);
    setAssignError(null);
    setAssignResult(null);
    performanceApi
      .bulkGoalsFromTemplate({
        templateId: Number(assignTpl.id),
        cycleId,
        employeeIds: assignEmployeeIds,
        targetValue: assignTarget === '' ? undefined : Number(assignTarget),
        dueDate: assignDue || undefined,
      })
      .then((res) => {
        setAssignResult(res ?? null);
        load();
      })
      .catch((err) => setAssignError(reason(err)))
      .finally(() => setAssigning(false));
  };

  const toggleAssignEmployee = (id: number) => {
    setAssignEmployeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const cycleSelect = (
    <div className="w-64">
      <label className={LABEL_CLS} htmlFor="goals-cycle">
        Cycle
      </label>
      <select
        id="goals-cycle"
        className={INPUT_CLS}
        value={cycleId ?? ''}
        onChange={(e) => setCycleId(e.target.value === '' ? null : Number(e.target.value))}
      >
        {cycles.length === 0 && <option value="">No cycles</option>}
        {cycles.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} ({c.status})
          </option>
        ))}
      </select>
    </div>
  );

  if (firstLoad && loading) return <LoadingBlock label="Loading goals…" />;

  const milestones: any[] = Array.isArray(detail?.milestones) ? detail.milestones : [];
  const detailStatus = String(detail?.status ?? '');
  const progressMode = String(detail?.progressMode ?? 'MANUAL');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar
          tabs={[
            { id: 'list', label: 'Goal List' },
            { id: 'tree', label: 'OKR Tree' },
            { id: 'templates', label: 'Templates' },
          ]}
          active={tab}
          onChange={setTab}
        />
        {tab !== 'templates' && (
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
            disabled={cycleId === null}
          >
            <span className="inline-flex items-center gap-2">
              <Plus size={14} />
              New goal
            </span>
          </button>
        )}
      </div>

      {/* --- List tab ------------------------------------------------------- */}
      {tab === 'list' && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            {cycleSelect}
            <div>
              <label className={LABEL_CLS} htmlFor="goals-kind">
                Kind
              </label>
              <select
                id="goals-kind"
                className={`${INPUT_CLS} w-40`}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="ALL">All kinds</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <label className={LABEL_CLS} htmlFor="goals-search">
                Search
              </label>
              <Search size={14} className="absolute left-2.5 bottom-2.5 text-text-muted" />
              <input
                id="goals-search"
                className={`${INPUT_CLS} w-56 pl-8`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="title, owner, category"
              />
            </div>
            <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
              <span className="inline-flex items-center gap-2">
                <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
                Refresh
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                  s === scope
                    ? 'bg-primary-light border-primary/30 text-primary'
                    : 'border-border-default text-text-muted hover:border-text-muted'
                }`}
              >
                {s === 'ALL' ? 'All scopes' : s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                  s === status
                    ? 'bg-primary-light border-primary/30 text-primary'
                    : 'border-border-default text-text-muted hover:border-text-muted'
                }`}
              >
                {s === 'ALL' ? 'All statuses' : s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          {error && (
            <div className="space-y-2">
              <ErrorBlock message={error} />
              <button type="button" className={BTN_SECONDARY} onClick={load}>
                Retry
              </button>
            </div>
          )}

          {filteredGoals.length === 0 && !error ? (
            <EmptyBlock message="No goals match these filters" />
          ) : (
            <TableShell headers={['Title', 'Owner', 'Kind', 'Weightage', 'Progress', 'Status', 'Due']}>
              {filteredGoals.map((g) => (
                <tr
                  key={g?.id}
                  className="hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={() => openDetail(Number(g.id))}
                >
                  <td className="px-3 py-2 text-xs text-text-primary max-w-[320px]">
                    <span className="line-clamp-2">{text(g?.title)}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{owner(g)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(g?.kind).replace(/_/g, ' ')} tone={kindTone(g?.kind)} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {num(g?.weightagePct) ?? 0}%
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <ProgressBar pct={num(g?.progressPct)} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(g?.status).replace(/_/g, ' ')} tone={statusTone(g?.status)} dot />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(g?.dueDate)}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* --- Tree tab ------------------------------------------------------- */}
      {tab === 'tree' && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            {cycleSelect}
            <button type="button" className={BTN_SECONDARY} onClick={loadTree} disabled={treeLoading}>
              <span className="inline-flex items-center gap-2">
                <RefreshCw size={14} className={treeLoading ? 'animate-spin' : undefined} />
                Refresh
              </span>
            </button>
          </div>
          {treeLoading && <LoadingBlock label="Loading the OKR tree…" />}
          {treeError && <ErrorBlock message={treeError} />}
          {!treeLoading && !treeError && tree.length === 0 && (
            <EmptyBlock message="No goals in this cycle" hint="Create an OBJECTIVE and hang KEY_RESULTs off it." />
          )}
          {!treeLoading && !treeError && tree.length > 0 && (
            <div className="bg-bg-card border border-border-default rounded-md p-3">
              {tree.map((node) => (
                <GoalNode key={node?.id} node={node} depth={0} onOpen={openDetail} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- Templates tab --------------------------------------------------- */}
      {tab === 'templates' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-text-muted text-xs">
              Templates stamp out individual goals in bulk; {'{target}'} in the title is replaced per assignment.
            </p>
            <button type="button" className={BTN_PRIMARY} onClick={() => openTplModal(null)}>
              <span className="inline-flex items-center gap-2">
                <Plus size={14} />
                New template
              </span>
            </button>
          </div>
          {templatesLoading && <LoadingBlock label="Loading templates…" />}
          {templatesError && <ErrorBlock message={templatesError} />}
          {!templatesLoading && !templatesError && templates.length === 0 && (
            <EmptyBlock message="No goal templates yet" />
          )}
          {!templatesLoading && !templatesError && templates.length > 0 && (
            <TableShell headers={['Code', 'Name', 'Kind', 'Scope', 'Metric', 'Suggested weight', 'Active', 'Actions']}>
              {templates.map((t) => (
                <tr key={t?.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-muted font-mono whitespace-nowrap">{text(t?.code)}</td>
                  <td className="px-3 py-2 text-xs text-text-primary">
                    {text(t?.name)}
                    <p className="text-text-muted text-[11px]">{text(t?.titleTemplate)}</p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(t?.kind).replace(/_/g, ' ')} tone={kindTone(t?.kind)} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(t?.scope)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {t?.metricName ? `${t.metricName} (${text(t?.metricUnit)})` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {num(t?.suggestedWeightagePct) === null ? '—' : `${t.suggestedWeightagePct}%`}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={t?.isActive ? 'Active' : 'Inactive'} tone={t?.isActive ? 'success' : 'default'} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        onClick={() => openTplModal(t)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline inline-flex items-center gap-1"
                        onClick={() => {
                          setAssignTpl(t);
                          setAssignEmployeeIds([]);
                          setAssignTarget('');
                          setAssignDue('');
                          setAssignError(null);
                          setAssignResult(null);
                        }}
                      >
                        <Users size={12} /> Assign
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* --- Detail modal ----------------------------------------------------- */}
      <AnimatePresence>
        {detailId !== null && (
          <ModalShell
            title={detail ? String(detail.title ?? 'Goal') : 'Goal'}
            subtitle={detail ? `${owner(detail)} · ${text(detail.kind).replace(/_/g, ' ')}` : null}
            onClose={() => setDetailId(null)}
            maxWidth="max-w-2xl"
          >
            {detailLoading && <LoadingBlock label="Loading goal…" />}
            {detailError && <ErrorBlock message={detailError} />}
            {!detailLoading && detail && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip label={text(detail.status).replace(/_/g, ' ')} tone={statusTone(detail.status)} dot />
                  <Chip label={`Priority ${text(detail.priority)}`} tone="default" />
                  <Chip label={`Visibility ${text(detail.visibility)}`} tone="default" />
                  <span className="text-text-muted text-xs">
                    Weightage {num(detail.weightagePct) ?? 0}% · due {fmtDate(detail.dueDate)}
                  </span>
                </div>

                {detail.description && (
                  <p className="text-text-secondary text-sm">{String(detail.description)}</p>
                )}

                <div>
                  <ProgressBar pct={num(detail.progressPct)} />
                </div>

                {/* Metric ------------------------------------------------------ */}
                {(detail.metricName || detail.targetValue !== null) && (
                  <div className="rounded-md border border-border-light bg-bg-secondary p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <p className="text-text-muted text-[10px] uppercase tracking-wider">Metric</p>
                      <p className="text-text-primary text-xs font-medium">{text(detail.metricName)}</p>
                    </div>
                    <div>
                      <p className="text-text-muted text-[10px] uppercase tracking-wider">Start</p>
                      <p className="text-text-primary text-xs font-mono">
                        {num(detail.startValue) ?? '—'} {text(detail.metricUnit) === '—' ? '' : detail.metricUnit}
                      </p>
                    </div>
                    <div>
                      <p className="text-text-muted text-[10px] uppercase tracking-wider">Current</p>
                      <p className="text-text-primary text-xs font-mono">{num(detail.currentValue) ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-text-muted text-[10px] uppercase tracking-wider">Target</p>
                      <p className="text-text-primary text-xs font-mono">{num(detail.targetValue) ?? '—'}</p>
                    </div>
                  </div>
                )}

                {/* Actions by status ------------------------------------------- */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(detailStatus === 'DRAFT' || detailStatus === 'REJECTED') && (
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={acting}
                      onClick={() => act(() => performanceApi.submitGoal(Number(detail.id)))}
                    >
                      Submit for approval
                    </button>
                  )}
                  {detailStatus === 'PENDING_APPROVAL' && (
                    <>
                      <button
                        type="button"
                        className={BTN_PRIMARY}
                        disabled={acting}
                        onClick={() => act(() => performanceApi.approveGoal(Number(detail.id)))}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={acting}
                        onClick={() => {
                          const r = window.prompt('Reason for rejecting this goal:');
                          if (r && r.trim()) act(() => performanceApi.rejectGoal(Number(detail.id), r.trim()));
                        }}
                      >
                        Reject…
                      </button>
                    </>
                  )}
                  {detailStatus === 'ACTIVE' && (
                    <>
                      <button
                        type="button"
                        className={BTN_PRIMARY}
                        disabled={acting}
                        onClick={() => act(() => performanceApi.completeGoal(Number(detail.id)))}
                      >
                        Mark completed
                      </button>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={acting}
                        onClick={() => {
                          if (window.confirm('Cancel this goal?'))
                            act(() => performanceApi.cancelGoal(Number(detail.id)));
                        }}
                      >
                        Cancel goal
                      </button>
                    </>
                  )}
                </div>

                {/* Progress update --------------------------------------------- */}
                {detailStatus === 'ACTIVE' && (
                  <div className="rounded-md border border-border-default p-3 space-y-2">
                    <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">
                      Update progress
                    </p>
                    {progressMode === 'METRIC' && (
                      <div className="flex items-end gap-2 flex-wrap">
                        <div>
                          <label className={LABEL_CLS}>Current value ({text(detail.metricUnit)})</label>
                          <input
                            type="number"
                            className={`${INPUT_CLS} w-36`}
                            value={currentValue}
                            onChange={(e) => setCurrentValue(e.target.value)}
                          />
                        </div>
                        <div className="flex-1 min-w-[160px]">
                          <label className={LABEL_CLS}>Note</label>
                          <input
                            className={INPUT_CLS}
                            value={progressNote}
                            onChange={(e) => setProgressNote(e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          className={BTN_PRIMARY}
                          disabled={acting || currentValue === ''}
                          onClick={() =>
                            act(() =>
                              performanceApi.goalProgress(Number(detail.id), {
                                currentValue: Number(currentValue),
                                note: progressNote.trim() || undefined,
                              }),
                            )
                          }
                        >
                          Record
                        </button>
                      </div>
                    )}
                    {progressMode === 'MANUAL' && (
                      <div className="flex items-end gap-2 flex-wrap">
                        <div>
                          <label className={LABEL_CLS}>Progress %</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            className={`${INPUT_CLS} w-28`}
                            value={progressPct}
                            onChange={(e) => setProgressPct(e.target.value)}
                          />
                        </div>
                        <div className="flex-1 min-w-[160px]">
                          <label className={LABEL_CLS}>Note</label>
                          <input
                            className={INPUT_CLS}
                            value={progressNote}
                            onChange={(e) => setProgressNote(e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          className={BTN_PRIMARY}
                          disabled={acting || progressPct === ''}
                          onClick={() =>
                            act(() =>
                              performanceApi.goalProgress(Number(detail.id), {
                                progressPct: Number(progressPct),
                                note: progressNote.trim() || undefined,
                              }),
                            )
                          }
                        >
                          Record
                        </button>
                      </div>
                    )}
                    {(progressMode === 'MILESTONES' || progressMode === 'CHILDREN') && (
                      <p className="text-text-muted text-xs italic">
                        Progress on this goal is derived automatically from its{' '}
                        {progressMode === 'MILESTONES' ? 'milestones' : 'child goals'} and cannot be entered
                        directly.
                      </p>
                    )}
                  </div>
                )}

                {/* Milestones --------------------------------------------------- */}
                <div className="space-y-2">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">Milestones</p>
                  {milestones.length === 0 && <p className="text-text-muted text-xs italic">No milestones.</p>}
                  {milestones.map((m) => (
                    <div
                      key={m?.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border-light"
                    >
                      <div className="min-w-0">
                        <p className="text-text-primary text-xs">{text(m?.title)}</p>
                        <p className="text-text-muted text-[11px]">{fmtDate(m?.dueDate)}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Chip
                          label={text(m?.status)}
                          tone={
                            String(m?.status) === 'COMPLETED'
                              ? 'success'
                              : String(m?.status) === 'MISSED'
                                ? 'danger'
                                : 'default'
                          }
                        />
                        {String(m?.status) !== 'COMPLETED' && (
                          <button
                            type="button"
                            className="text-success text-xs font-medium hover:underline"
                            disabled={acting}
                            onClick={() =>
                              act(() => performanceApi.updateMilestone(Number(m.id), { status: 'COMPLETED' }))
                            }
                          >
                            Complete
                          </button>
                        )}
                        {String(m?.status) === 'PENDING' && (
                          <button
                            type="button"
                            className="text-danger text-xs font-medium hover:underline"
                            disabled={acting}
                            onClick={() =>
                              act(() => performanceApi.updateMilestone(Number(m.id), { status: 'MISSED' }))
                            }
                          >
                            Miss
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {detailStatus !== 'COMPLETED' && detailStatus !== 'CANCELLED' && (
                    <div className="flex items-end gap-2 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <label className={LABEL_CLS}>New milestone</label>
                        <input
                          className={INPUT_CLS}
                          value={msTitle}
                          onChange={(e) => setMsTitle(e.target.value)}
                          placeholder="title"
                        />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Due</label>
                        <input
                          type="date"
                          className={`${INPUT_CLS} w-40`}
                          value={msDue}
                          onChange={(e) => setMsDue(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={acting || msTitle.trim() === ''}
                        onClick={() =>
                          act(() =>
                            performanceApi.addMilestone(Number(detail.id), {
                              title: msTitle.trim(),
                              dueDate: msDue || undefined,
                            }),
                          )
                        }
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>

                {/* Updates history ---------------------------------------------- */}
                <div className="space-y-2">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">
                    Update history
                  </p>
                  {updates.length === 0 && <p className="text-text-muted text-xs italic">No updates recorded.</p>}
                  <ul className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-thin">
                    {updates.map((u, index) => (
                      <li key={u?.id ?? index} className="px-3 py-2 rounded-md bg-bg-secondary border border-border-light">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-text-primary text-xs font-medium">
                            {text(u?.updateType ?? u?.type)}
                            {num(u?.progressPct) !== null && ` · ${u.progressPct}%`}
                          </span>
                          <span className="text-text-muted text-[11px]">{fmtDateTime(u?.createdAt)}</span>
                        </div>
                        {(u?.note ?? u?.comment) && (
                          <p className="text-text-secondary text-[11px] mt-0.5">{String(u.note ?? u.comment)}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Create goal modal ------------------------------------------------ */}
      <AnimatePresence>
        {createOpen && (
          <ModalShell
            title="New goal"
            subtitle={cycles.find((c) => Number(c.id) === cycleId)?.name ?? null}
            onClose={() => setCreateOpen(false)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setCreateOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={submitCreate}
                  disabled={creating || gForm.title.trim() === ''}
                >
                  {creating ? 'Creating…' : 'Create goal'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {createError && <ErrorBlock message={createError} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Kind</label>
                  <select
                    className={INPUT_CLS}
                    value={gForm.kind}
                    onChange={(e) => setGForm((f) => ({ ...f, kind: e.target.value, parentGoalId: '' }))}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Scope</label>
                  <select
                    className={INPUT_CLS}
                    value={gForm.scope}
                    onChange={(e) => setGForm((f) => ({ ...f, scope: e.target.value }))}
                  >
                    {['INDIVIDUAL', 'TEAM', 'DEPARTMENT', 'ORGANIZATION'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                {gForm.scope === 'INDIVIDUAL' && (
                  <div>
                    <label className={LABEL_CLS}>Employee</label>
                    <select
                      className={INPUT_CLS}
                      value={gForm.employeeId}
                      onChange={(e) => setGForm((f) => ({ ...f, employeeId: e.target.value }))}
                    >
                      <option value="">Select employee…</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.fullName} ({e.empCode})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {gForm.scope === 'TEAM' && (
                  <div>
                    <label className={LABEL_CLS}>Team</label>
                    <select
                      className={INPUT_CLS}
                      value={gForm.teamId}
                      onChange={(e) => setGForm((f) => ({ ...f, teamId: e.target.value }))}
                    >
                      <option value="">Select team…</option>
                      {teams.map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {gForm.scope === 'DEPARTMENT' && (
                  <div>
                    <label className={LABEL_CLS}>Department</label>
                    <select
                      className={INPUT_CLS}
                      value={gForm.departmentId}
                      onChange={(e) => setGForm((f) => ({ ...f, departmentId: e.target.value }))}
                    >
                      <option value="">Select department…</option>
                      {departments.map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className={LABEL_CLS}>
                    Parent goal {gForm.kind === 'KEY_RESULT' ? '(OBJECTIVE required)' : '(alignment, optional)'}
                  </label>
                  <select
                    className={INPUT_CLS}
                    value={gForm.parentGoalId}
                    onChange={(e) => setGForm((f) => ({ ...f, parentGoalId: e.target.value }))}
                  >
                    <option value="">{gForm.kind === 'KEY_RESULT' ? 'Select objective…' : 'None'}</option>
                    {parentOptions.map((g) => (
                      <option key={g.id} value={g.id}>
                        [{g.kind}] {g.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={LABEL_CLS}>Title</label>
                <input
                  className={INPUT_CLS}
                  value={gForm.title}
                  onChange={(e) => setGForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Description</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[60px]`}
                  value={gForm.description}
                  onChange={(e) => setGForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={LABEL_CLS}>Metric name</label>
                  <input
                    className={INPUT_CLS}
                    value={gForm.metricName}
                    onChange={(e) => setGForm((f) => ({ ...f, metricName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Unit</label>
                  <input
                    className={INPUT_CLS}
                    value={gForm.metricUnit}
                    onChange={(e) => setGForm((f) => ({ ...f, metricUnit: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Start value</label>
                  <input
                    type="number"
                    className={INPUT_CLS}
                    value={gForm.startValue}
                    onChange={(e) => setGForm((f) => ({ ...f, startValue: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Target value</label>
                  <input
                    type="number"
                    className={INPUT_CLS}
                    value={gForm.targetValue}
                    onChange={(e) => setGForm((f) => ({ ...f, targetValue: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={LABEL_CLS}>Weightage %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={INPUT_CLS}
                    value={gForm.weightagePct}
                    onChange={(e) => setGForm((f) => ({ ...f, weightagePct: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Priority</label>
                  <select
                    className={INPUT_CLS}
                    value={gForm.priority}
                    onChange={(e) => setGForm((f) => ({ ...f, priority: e.target.value }))}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Visibility</label>
                  <select
                    className={INPUT_CLS}
                    value={gForm.visibility}
                    onChange={(e) => setGForm((f) => ({ ...f, visibility: e.target.value }))}
                  >
                    {VISIBILITIES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Due date</label>
                  <input
                    type="date"
                    className={INPUT_CLS}
                    value={gForm.dueDate}
                    onChange={(e) => setGForm((f) => ({ ...f, dueDate: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Category</label>
                <input
                  className={INPUT_CLS}
                  value={gForm.category}
                  onChange={(e) => setGForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Production"
                />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Template create/edit modal -------------------------------------- */}
      <AnimatePresence>
        {tplModalOpen && (
          <ModalShell
            title={tplEditing ? `Edit template ${tplEditing.code}` : 'New goal template'}
            subtitle="Use {target} in the title template to inject the per-assignment target."
            onClose={() => setTplModalOpen(false)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setTplModalOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={saveTemplate} disabled={tplSaving}>
                  {tplSaving ? 'Saving…' : tplEditing ? 'Save changes' : 'Create template'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {tplError && <ErrorBlock message={tplError} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Code</label>
                  <input
                    className={INPUT_CLS}
                    value={tplForm.code}
                    onChange={(e) => setTplForm((f) => ({ ...f, code: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Name</label>
                  <input
                    className={INPUT_CLS}
                    value={tplForm.name}
                    onChange={(e) => setTplForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Kind</label>
                  <select
                    className={INPUT_CLS}
                    value={tplForm.kind}
                    onChange={(e) => setTplForm((f) => ({ ...f, kind: e.target.value }))}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Scope</label>
                  <select
                    className={INPUT_CLS}
                    value={tplForm.scope}
                    onChange={(e) => setTplForm((f) => ({ ...f, scope: e.target.value }))}
                  >
                    {['INDIVIDUAL', 'TEAM', 'DEPARTMENT', 'ORGANIZATION'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Title template</label>
                <input
                  className={INPUT_CLS}
                  value={tplForm.titleTemplate}
                  onChange={(e) => setTplForm((f) => ({ ...f, titleTemplate: e.target.value }))}
                  placeholder="Polish {target} verified pieces this cycle"
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Description template</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[60px]`}
                  value={tplForm.descriptionTemplate}
                  onChange={(e) => setTplForm((f) => ({ ...f, descriptionTemplate: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={LABEL_CLS}>Metric name</label>
                  <input
                    className={INPUT_CLS}
                    value={tplForm.metricName}
                    onChange={(e) => setTplForm((f) => ({ ...f, metricName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Unit</label>
                  <input
                    className={INPUT_CLS}
                    value={tplForm.metricUnit}
                    onChange={(e) => setTplForm((f) => ({ ...f, metricUnit: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Suggested weight %</label>
                  <input
                    type="number"
                    className={INPUT_CLS}
                    value={tplForm.suggestedWeightagePct}
                    onChange={(e) => setTplForm((f) => ({ ...f, suggestedWeightagePct: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Category</label>
                  <input
                    className={INPUT_CLS}
                    value={tplForm.category}
                    onChange={(e) => setTplForm((f) => ({ ...f, category: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Assign template modal -------------------------------------------- */}
      <AnimatePresence>
        {assignTpl && (
          <ModalShell
            title={`Assign "${assignTpl.name}" to employees`}
            subtitle={`Cycle: ${cycles.find((c) => Number(c.id) === cycleId)?.code ?? '—'}`}
            onClose={() => setAssignTpl(null)}
            maxWidth="max-w-2xl"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setAssignTpl(null)}>
                  Close
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={runAssign}
                  disabled={assigning || assignEmployeeIds.length === 0 || cycleId === null}
                >
                  {assigning ? 'Assigning…' : `Create goals (${assignEmployeeIds.length})`}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {assignError && <ErrorBlock message={assignError} />}

              {assignResult && (
                <div className="rounded-md bg-bg-secondary border border-border-light p-3 space-y-2">
                  <p className="text-text-primary text-xs font-medium">
                    {num(assignResult.created) ?? 0} goal(s) created ·{' '}
                    {Array.isArray(assignResult.skipped) ? assignResult.skipped.length : 0} skipped
                  </p>
                  {Array.isArray(assignResult.skipped) && assignResult.skipped.length > 0 && (
                    <ul className="space-y-1 list-disc list-inside">
                      {assignResult.skipped.map((s: any, index: number) => {
                        const emp = employees.find((e) => e.id === Number(s?.employeeId));
                        return (
                          <li key={index} className="text-text-secondary text-xs">
                            {emp ? emp.fullName : `Employee ${s?.employeeId}`} — {text(s?.reason)}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Target value (replaces {'{target}'})</label>
                  <input
                    type="number"
                    className={INPUT_CLS}
                    value={assignTarget}
                    onChange={(e) => setAssignTarget(e.target.value)}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Due date</label>
                  <input
                    type="date"
                    className={INPUT_CLS}
                    value={assignDue}
                    onChange={(e) => setAssignDue(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className={LABEL_CLS}>Employees ({assignEmployeeIds.length} selected)</label>
                <div className="max-h-64 overflow-y-auto scrollbar-thin rounded-md border border-border-default divide-y divide-border-light">
                  {employees.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={assignEmployeeIds.includes(e.id)}
                        onChange={() => toggleAssignEmployee(e.id)}
                      />
                      {e.fullName}
                      <span className="text-text-muted font-mono">{e.empCode}</span>
                      <span className="text-text-muted ml-auto">{e.department ?? ''}</span>
                    </label>
                  ))}
                  {employees.length === 0 && (
                    <p className="px-3 py-2 text-text-muted text-xs italic">No employees loaded.</p>
                  )}
                </div>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
