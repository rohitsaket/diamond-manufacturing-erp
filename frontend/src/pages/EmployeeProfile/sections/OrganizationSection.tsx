import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { profileApi, profileCoreApi } from '../../../api/profile';
import type { OrganizationDetails, OrgChartNode } from '../../../types/profile';
import { Chip, EmptyBlock, ErrorBlock, LoadingBlock } from '../../../components/common/HrmsUI';
import { EditText, FieldGrid, FieldRow, SectionCard, errorMessage } from '../ProfileField';

const MAX_DEPTH = 4;

interface OrgForm {
  company: string;
  businessUnit: string;
  division: string;
  department: string;
  section: string;
  team: string;
  branch: string;
  region: string;
  country: string;
  legalEntity: string;
}

function buildForm(d: OrganizationDetails): OrgForm {
  return {
    company: d.company ?? '',
    businessUnit: d.businessUnit ?? '',
    division: d.division ?? '',
    department: d.department ?? '',
    section: d.section ?? '',
    team: d.team ?? '',
    branch: d.branch ?? '',
    region: d.region ?? '',
    country: d.country ?? '',
    legalEntity: d.legalEntity ?? '',
  };
}

const str = (v: string): string | null => (v.trim() === '' ? null : v.trim());

function countReports(node: OrgChartNode): number {
  return Array.isArray(node.reports) ? node.reports.length : 0;
}

function OrgNode({
  node,
  depth,
  highlightId,
}: {
  node: OrgChartNode;
  depth: number;
  highlightId: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const reports = Array.isArray(node.reports) ? node.reports : [];
  const isSelf = node.employeeId === highlightId;
  const atCap = depth >= MAX_DEPTH - 1;

  return (
    <li>
      <div
        className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${
          isSelf ? 'bg-bg-selected' : 'hover:bg-bg-hover'
        }`}
        style={{ marginLeft: depth * 16 }}
      >
        {reports.length > 0 && !atCap ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="mt-0.5 text-text-muted hover:text-text-primary transition-colors"
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-[14px] flex-shrink-0" aria-hidden />
        )}
        <div className="min-w-0">
          <p className={`text-sm truncate ${isSelf ? 'text-primary font-semibold' : 'text-text-primary'}`}>
            {node.fullName}
            <span className="text-text-muted text-xs font-normal ml-1.5">{node.empCode}</span>
          </p>
          <p className="text-text-muted text-xs truncate">
            {node.designation || '—'}
            {node.department ? ` · ${node.department}` : ''}
          </p>
        </div>
        {reports.length > 0 && (
          <span className="ml-auto flex-shrink-0">
            <Chip label={`${countReports(node)} report${reports.length === 1 ? '' : 's'}`} />
          </span>
        )}
      </div>

      {reports.length > 0 && atCap && (
        <p className="text-text-muted text-xs mt-1" style={{ marginLeft: (depth + 1) * 16 + 22 }}>
          … {reports.length} more level{reports.length === 1 ? '' : 's'} below are not shown
        </p>
      )}

      {reports.length > 0 && open && !atCap && (
        <ul className="mt-1 space-y-1">
          {reports.map((r) => (
            <OrgNode key={r.employeeId} node={r} depth={depth + 1} highlightId={highlightId} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrganizationSection({ employeeId }: { employeeId: number }) {
  const [details, setDetails] = useState<OrganizationDetails | null>(null);
  const [chain, setChain] = useState<OrgChartNode[]>([]);
  const [chart, setChart] = useState<OrgChartNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<OrgForm | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      profileCoreApi.organization(employeeId),
      profileApi.reportingChain(employeeId).catch(() => [] as OrgChartNode[]),
      profileApi.orgChart(employeeId).catch(() => [] as OrgChartNode[]),
    ])
      .then(([d, c, tree]) => {
        setDetails(d);
        setChain(Array.isArray(c) ? c : []);
        setChart(Array.isArray(tree) ? tree : tree ? [tree] : []);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key: keyof OrgForm, value: string) =>
    setForm((prev) => (prev === null ? prev : { ...prev, [key]: value }));

  const handleSave = () => {
    if (!form) return;
    const body: Record<string, unknown> = {
      company: str(form.company),
      businessUnit: str(form.businessUnit),
      division: str(form.division),
      department: str(form.department),
      section: str(form.section),
      team: str(form.team),
      branch: str(form.branch),
      region: str(form.region),
      country: str(form.country),
      legalEntity: str(form.legalEntity),
    };
    setSaving(true);
    profileCoreApi
      .update(employeeId, body)
      .then(() => {
        setEditing(false);
        load();
      })
      .catch((e: unknown) => window.alert(errorMessage(e)))
      .finally(() => setSaving(false));
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!details) return <EmptyBlock message="No organization details available" />;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Organization"
        subtitle="Where this employee sits in the company structure"
        editing={editing}
        onEdit={() => {
          setForm(buildForm(details));
          setEditing(true);
        }}
        onCancel={() => setEditing(false)}
        onSave={handleSave}
        saving={saving}
      >
        {!editing || form === null ? (
          <FieldGrid>
            <FieldRow label="Company" value={details.company} />
            <FieldRow label="Business unit" value={details.businessUnit} />
            <FieldRow label="Division" value={details.division} />
            <FieldRow label="Department" value={details.department} />
            <FieldRow label="Section" value={details.section} />
            <FieldRow label="Team" value={details.team} />
            <FieldRow label="Branch" value={details.branch} />
            <FieldRow label="Region" value={details.region} />
            <FieldRow label="Country" value={details.country} />
            <FieldRow label="Legal entity" value={details.legalEntity} />
          </FieldGrid>
        ) : (
          <FieldGrid>
            <EditText label="Company" value={form.company} onChange={(v) => set('company', v)} />
            <EditText label="Business unit" value={form.businessUnit} onChange={(v) => set('businessUnit', v)} />
            <EditText label="Division" value={form.division} onChange={(v) => set('division', v)} />
            <EditText label="Department" value={form.department} onChange={(v) => set('department', v)} />
            <EditText label="Section" value={form.section} onChange={(v) => set('section', v)} />
            <EditText label="Team" value={form.team} onChange={(v) => set('team', v)} />
            <EditText label="Branch" value={form.branch} onChange={(v) => set('branch', v)} />
            <EditText label="Region" value={form.region} onChange={(v) => set('region', v)} />
            <EditText label="Country" value={form.country} onChange={(v) => set('country', v)} />
            <EditText label="Legal entity" value={form.legalEntity} onChange={(v) => set('legalEntity', v)} />
          </FieldGrid>
        )}
      </SectionCard>

      <SectionCard title="Reporting hierarchy" subtitle="From the top of the organisation down to this employee">
        {chain.length === 0 ? (
          <EmptyBlock message="No reporting chain" hint="No reporting manager is set for this employee." />
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {chain.map((n, i) => (
              <span key={n.employeeId} className="inline-flex items-center gap-1.5">
                {i > 0 && <ChevronRight size={14} className="text-text-muted" aria-hidden />}
                <span
                  className={`px-2.5 py-1 rounded-md border text-xs ${
                    n.employeeId === employeeId
                      ? 'bg-primary-light border-primary/30 text-primary font-medium'
                      : 'bg-bg-secondary border-border-default text-text-secondary'
                  }`}
                >
                  {n.fullName}
                  {n.designation && <span className="text-text-muted ml-1.5">{n.designation}</span>}
                </span>
              </span>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Organisation chart" subtitle={`Direct and indirect reports, up to ${MAX_DEPTH} levels`}>
        {chart.length === 0 ? (
          <EmptyBlock message="No reports" hint="This employee has no direct reports." />
        ) : (
          <>
            <ul className="space-y-1">
              {chart.map((n) => (
                <OrgNode key={n.employeeId} node={n} depth={0} highlightId={employeeId} />
              ))}
            </ul>
            <p className="text-text-muted text-[11px] mt-3 inline-flex items-center gap-1.5">
              <Users size={14} /> Depth is capped at {MAX_DEPTH} levels; deeper reports are summarised with “…”.
            </p>
          </>
        )}
      </SectionCard>
    </div>
  );
}
