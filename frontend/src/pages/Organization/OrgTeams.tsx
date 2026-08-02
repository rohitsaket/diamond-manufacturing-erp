import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search, RefreshCw, UserPlus, X } from 'lucide-react';
import {
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import { orgApi } from '../../api/organization';
import type { Team, TeamMember, Company, Department } from '../../types/organization';
import { useApp } from '../../contexts/AppContext';
import {
  OrgStatusChip,
  EntityFormModal,
  CapacityBar,
  formatDate,
  errMsg,
  type FieldDescriptor,
  type SelectOption,
} from './orgUi';

const TEAM_TYPES: SelectOption[] = [
  { value: 'FUNCTIONAL', label: 'Functional' },
  { value: 'CROSS_FUNCTIONAL', label: 'Cross functional' },
  { value: 'PROJECT', label: 'Project' },
  { value: 'SHIFT', label: 'Shift' },
  { value: 'OTHER', label: 'Other' },
];

const TEAM_STATUSES: SelectOption[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'COMPLETED', label: 'Completed' },
];

const typeLabel = (value: string | null | undefined): string =>
  TEAM_TYPES.find((t) => t.value === value)?.label ?? '—';

/** Teams register with membership management and allocation tracking. */
export function OrgTeams({ canEdit }: { canEdit: boolean }) {
  const { employees } = useApp();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [editing, setEditing] = useState<Team | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openTeam, setOpenTeam] = useState<Team | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    orgApi.teams
      .list({})
      .then((rows) => setTeams(Array.isArray(rows) ? rows : []))
      .catch((err: unknown) => setError(errMsg(err, 'Could not load teams')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    orgApi.companies
      .list({})
      .then((rows) => setCompanies(Array.isArray(rows) ? rows : []))
      .catch(() => setCompanies([]));
    orgApi.departments
      .list({})
      .then((rows) => setDepartments(Array.isArray(rows) ? rows : []))
      .catch(() => setDepartments([]));
  }, []);

  const employeeOptions = useMemo<SelectOption[]>(
    () => employees.map((e) => ({ value: e.id, label: `${e.empCode} · ${e.fullName}` })),
    [employees],
  );

  const fields = useMemo<FieldDescriptor[]>(
    () => [
      { key: 'code', label: 'Code', type: 'text', required: true, hint: 'Unique, short, uppercase' },
      { key: 'name', label: 'Name', type: 'text', required: true },
      {
        key: 'companyId',
        label: 'Company',
        type: 'select',
        required: true,
        numeric: true,
        options: companies.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
      },
      {
        key: 'departmentId',
        label: 'Department',
        type: 'select',
        numeric: true,
        options: departments.map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` })),
      },
      { key: 'teamType', label: 'Team type', type: 'select', options: TEAM_TYPES },
      { key: 'leadEmployeeId', label: 'Team lead', type: 'select', numeric: true, options: employeeOptions },
      { key: 'capacity', label: 'Capacity', type: 'number', hint: 'Maximum members' },
      { key: 'startDate', label: 'Start date', type: 'date' },
      { key: 'endDate', label: 'End date', type: 'date' },
      { key: 'objectives', label: 'Objectives', type: 'textarea' },
      { key: 'status', label: 'Status', type: 'select', options: TEAM_STATUSES },
    ],
    [companies, departments, employeeOptions],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (!q) return true;
      return `${t.code} ${t.name} ${t.departmentName ?? ''} ${t.leadEmployeeName ?? ''}`.toLowerCase().includes(q);
    });
  }, [teams, query, statusFilter]);

  const submit = (values: Record<string, unknown>) => {
    setSaving(true);
    const action = editing
      ? orgApi.teams.update(editing.id, values as Partial<Team>)
      : orgApi.teams.create(values as Partial<Team>);
    action
      .then(() => {
        setEditing(null);
        setCreating(false);
        load();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not save this team')))
      .finally(() => setSaving(false));
  };

  const remove = (team: Team) => {
    if (!window.confirm(`Delete team "${team.name}"? This cannot be undone.`)) return;
    orgApi.teams
      .remove(team.id)
      .then(() => load())
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not delete this team')));
  };

  return (
    <div className="space-y-3">
      <div className="bg-bg-card border border-border-default rounded-md p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className={`${INPUT_CLS} pl-8`}
            placeholder="Search teams, departments or leads…"
            aria-label="Search teams"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className={`${INPUT_CLS} w-auto min-w-[140px]`}
          aria-label="Filter teams by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {TEAM_STATUSES.map((s) => (
            <option key={String(s.value)} value={String(s.value)}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" className={BTN_SECONDARY} onClick={load} aria-label="Reload teams">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        {canEdit && (
          <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} /> New team
            </span>
          </button>
        )}
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading teams…" />
      ) : filtered.length === 0 ? (
        <div className="bg-bg-card border border-border-default rounded-md">
          <EmptyBlock
            message="No teams found"
            hint={query || statusFilter ? 'Try clearing the filters.' : 'Create a team to group people across departments.'}
          />
        </div>
      ) : (
        <TableShell headers={['Code', 'Name', 'Type', 'Department', 'Lead', 'Members', 'Status', '']}>
          {filtered.map((team) => (
            <tr key={team.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-text-muted text-[11px] font-mono whitespace-nowrap">{team.code}</td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => setOpenTeam(team)}
                  className="text-text-primary text-sm hover:text-primary transition-colors text-left"
                >
                  {team.name}
                </button>
              </td>
              <td className="px-3 py-2 text-text-secondary text-xs">{typeLabel(team.teamType)}</td>
              <td className="px-3 py-2 text-text-secondary text-xs">{team.departmentName ?? '—'}</td>
              <td className="px-3 py-2 text-text-secondary text-xs">{team.leadEmployeeName ?? '—'}</td>
              <td className="px-3 py-2">
                <CapacityBar used={Number(team.memberCount ?? 0)} total={team.capacity} />
              </td>
              <td className="px-3 py-2">
                <OrgStatusChip status={team.status} />
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Manage members of ${team.name}`}
                    onClick={() => setOpenTeam(team)}
                    className="text-text-muted hover:text-primary transition-colors"
                  >
                    <UserPlus size={14} />
                  </button>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        aria-label={`Edit ${team.name}`}
                        onClick={() => setEditing(team)}
                        className="text-text-muted hover:text-primary transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${team.name}`}
                        onClick={() => remove(team)}
                        className="text-text-muted hover:text-danger transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {(creating || editing) && (
        <EntityFormModal
          title={editing ? 'Edit team' : 'New team'}
          subtitle={editing ? editing.name : 'Teams span departments and track allocation'}
          fields={fields}
          initial={editing as unknown as Record<string, unknown> | null}
          submitting={saving}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={submit}
        />
      )}

      {openTeam && (
        <TeamMembersModal
          team={openTeam}
          canEdit={canEdit}
          employeeOptions={employeeOptions}
          onClose={() => setOpenTeam(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

function TeamMembersModal({
  team,
  canEdit,
  employeeOptions,
  onClose,
  onChanged,
}: {
  team: Team;
  canEdit: boolean;
  employeeOptions: SelectOption[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [employeeId, setEmployeeId] = useState('');
  const [roleInTeam, setRoleInTeam] = useState('');
  const [allocationPct, setAllocationPct] = useState('100');

  const load = useCallback(() => {
    setError(null);
    orgApi
      .teamMembers(team.id)
      .then((rows) => setMembers(Array.isArray(rows) ? rows : []))
      .catch((err: unknown) => {
        setMembers([]);
        setError(errMsg(err, 'Could not load the team members'));
      });
  }, [team.id]);

  useEffect(() => {
    load();
  }, [load]);

  const add = () => {
    if (!employeeId) {
      window.alert('Choose an employee first.');
      return;
    }
    setBusy(true);
    orgApi
      .addTeamMember(team.id, {
        employeeId: Number(employeeId),
        roleInTeam: roleInTeam.trim() || undefined,
        allocationPct: allocationPct === '' ? undefined : Number(allocationPct),
      })
      .then(() => {
        setEmployeeId('');
        setRoleInTeam('');
        setAllocationPct('100');
        load();
        onChanged();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not add this member')))
      .finally(() => setBusy(false));
  };

  const remove = (member: TeamMember) => {
    if (!window.confirm(`Remove ${member.employeeName} from ${team.name}?`)) return;
    setBusy(true);
    orgApi
      .removeTeamMember(team.id, member.employeeId)
      .then(() => {
        load();
        onChanged();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not remove this member')))
      .finally(() => setBusy(false));
  };

  const count = members?.length ?? 0;

  return (
    <ModalShell
      title={team.name}
      subtitle={`${team.code} · ${typeLabel(team.teamType)}${team.departmentName ? ` · ${team.departmentName}` : ''}`}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="max-w-[240px] w-full">
            <CapacityBar used={count} total={team.capacity} />
          </div>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBlock message={error} />}

        {canEdit && (
          <div className="bg-bg-secondary border border-border-light rounded-md p-3">
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">Add a member</p>
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_90px_auto] gap-2 items-end">
              <label className="block">
                <span className="sr-only">Employee</span>
                <select
                  className={INPUT_CLS}
                  aria-label="Employee"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                >
                  <option value="">— choose an employee —</option>
                  {employeeOptions.map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <input
                className={INPUT_CLS}
                placeholder="Role in team"
                aria-label="Role in team"
                value={roleInTeam}
                onChange={(e) => setRoleInTeam(e.target.value)}
              />
              <input
                className={INPUT_CLS}
                type="number"
                min={1}
                max={100}
                placeholder="%"
                aria-label="Allocation percent"
                value={allocationPct}
                onChange={(e) => setAllocationPct(e.target.value)}
              />
              <button type="button" className={BTN_PRIMARY} onClick={add} disabled={busy}>
                <span className="inline-flex items-center gap-1.5">
                  <UserPlus size={14} /> Add
                </span>
              </button>
            </div>
            <p className="text-text-muted text-[10px] mt-2">
              Total allocation across all of an employee's teams is capped at 100% by the server.
            </p>
          </div>
        )}

        {members === null ? (
          <LoadingBlock label="Loading members…" />
        ) : members.length === 0 ? (
          <EmptyBlock message="No members yet" hint={canEdit ? 'Add someone using the form above.' : undefined} />
        ) : (
          <TableShell headers={['Employee', 'Role in team', 'Allocation', 'Joined', '']}>
            {members.map((m) => (
              <tr key={m.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2">
                  <span className="text-text-primary text-sm">{m.employeeName}</span>
                  <span className="text-text-muted text-[10px] font-mono ml-2">{m.empCode}</span>
                </td>
                <td className="px-3 py-2 text-text-secondary text-xs">{m.roleInTeam ?? '—'}</td>
                <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">
                  {Number(m.allocationPct ?? 0)}%
                </td>
                <td className="px-3 py-2 text-text-secondary text-xs">{formatDate(m.joinedOn)}</td>
                <td className="px-3 py-2 text-right">
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove ${m.employeeName} from the team`}
                      onClick={() => remove(m)}
                      disabled={busy}
                      className="text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                    >
                      <X size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </div>
    </ModalShell>
  );
}
