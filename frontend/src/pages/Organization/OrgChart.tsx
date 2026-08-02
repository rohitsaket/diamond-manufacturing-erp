import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  ChevronUp,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Printer,
  Download,
  RefreshCw,
  Maximize2,
  Minimize2,
  Plus,
  Minus,
  ArrowRight,
  Users,
} from 'lucide-react';
import { orgApi } from '../../api/organization';
import type { OrgChartNodeFull, OrgTreeNode } from '../../types/organization';
import {
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  Chip,
  BTN_PRIMARY,
  BTN_SECONDARY,
  INPUT_CLS,
} from '../../components/common/HrmsUI';
import { TabBar, type TabItem } from '../../components/common/TabBar';
import { ModalShell } from '../../components/common/ModalShell';
import { errMsg } from './orgUi';

// ---------------------------------------------------------------------------
// The chart renders two different payloads (people and positions) through one
// view-model so the connector/expand/search machinery is written only once.
// ---------------------------------------------------------------------------
interface ChartVM {
  id: string;
  name: string;
  code: string | null;
  subtitle: string | null;
  meta: string | null;
  photoUrl: string | null;
  direct: number;
  total: number;
  employeeId: number | null;
  children: ChartVM[];
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function initials(name: string): string {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Only render an <img> when the payload gave us something a browser can load. */
function usablePhoto(url: string | null | undefined): string | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/') || raw.startsWith('data:')) return raw;
  return null;
}

function peopleToVm(nodes: OrgChartNodeFull[]): ChartVM[] {
  return asArray<OrgChartNodeFull>(nodes).map((n) => ({
    id: `e-${n?.employeeId ?? Math.random().toString(36).slice(2)}`,
    name: String(n?.fullName ?? 'Unnamed'),
    code: n?.empCode ?? null,
    subtitle: n?.designation ?? null,
    meta: n?.department ?? null,
    photoUrl: n?.photoUrl ?? null,
    direct: num(n?.directReports),
    total: num(n?.totalReports),
    employeeId: n?.employeeId ?? null,
    children: peopleToVm(asArray<OrgChartNodeFull>(n?.reports)),
  }));
}

/** Positions arrive as an OrgTreeNode forest; totals are counted client-side. */
function positionsToVm(nodes: OrgTreeNode[]): ChartVM[] {
  return asArray<OrgTreeNode>(nodes).map((n) => {
    const children = positionsToVm(asArray<OrgTreeNode>(n?.children));
    const total = children.reduce((sum, c) => sum + c.total + 1, 0);
    return {
      id: String(n?.key ?? `${n?.entityType ?? 'p'}-${n?.id ?? 0}`),
      name: String(n?.name ?? 'Untitled'),
      code: n?.code ?? null,
      subtitle: n?.subtitle ?? null,
      meta: n?.vacancies ? `${num(n.headcount)} filled · ${num(n.vacancies)} vacant` : `${num(n?.headcount)} filled`,
      photoUrl: null,
      direct: children.length,
      total,
      employeeId: null,
      children,
    };
  });
}

function walk(nodes: ChartVM[], visit: (node: ChartVM, parent: ChartVM | null, depth: number) => void): void {
  const step = (list: ChartVM[], parent: ChartVM | null, depth: number) => {
    for (const node of list) {
      visit(node, parent, depth);
      step(node.children, node, depth + 1);
    }
  };
  step(nodes, null, 0);
}

/** Every ancestor of a node, so search can open the path down to a match. */
function buildParentMap(nodes: ChartVM[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  walk(nodes, (node, parent) => map.set(node.id, parent ? parent.id : null));
  return map;
}

const PRINT_CSS = `
@media print {
  body.org-chart-print aside,
  body.org-chart-print nav,
  body.org-chart-print header,
  body.org-chart-print .org-no-print { display: none !important; }
  body.org-chart-print .org-chart-canvas { transform: none !important; }
  body.org-chart-print .org-chart-scroll { overflow: visible !important; max-height: none !important; }
}
`;

export function OrgChart({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [tab, setTab] = useState<string>('people');
  const [people, setPeople] = useState<OrgChartNodeFull[] | null>(null);
  const [positions, setPositions] = useState<OrgTreeNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState<string>('');
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<ChartVM | null>(null);

  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const loadPeople = useCallback(() => {
    setLoading(true);
    setError(null);
    orgApi
      .chart()
      .then((rows) => setPeople(asArray<OrgChartNodeFull>(rows)))
      .catch((err: unknown) => {
        setError(errMsg(err, 'Failed to load the reporting chart'));
        setPeople([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const loadPositions = useCallback(() => {
    setLoading(true);
    setError(null);
    orgApi
      .positionChart()
      .then((rows) => setPositions(asArray<OrgTreeNode>(rows)))
      .catch((err: unknown) => {
        setError(errMsg(err, 'Failed to load the position chart'));
        setPositions([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'people' && people === null) loadPeople();
    if (tab === 'positions' && positions === null) loadPositions();
    if ((tab === 'people' && people !== null) || (tab === 'positions' && positions !== null)) setLoading(false);
  }, [tab, people, positions, loadPeople, loadPositions]);

  const roots: ChartVM[] = useMemo(
    () => (tab === 'people' ? peopleToVm(people ?? []) : positionsToVm(positions ?? [])),
    [tab, people, positions],
  );

  const parentMap = useMemo(() => buildParentMap(roots), [roots]);

  const allIds = useMemo(() => {
    const ids: string[] = [];
    walk(roots, (node) => ids.push(node.id));
    return ids;
  }, [roots]);

  const nodeCount = allIds.length;

  // Seed: first two levels open, once per tab/payload.
  useEffect(() => {
    const stamp = `${tab}:${nodeCount}`;
    if (nodeCount === 0 || seeded === stamp) return;
    const next = new Set<string>();
    walk(roots, (node, _parent, depth) => {
      if (depth < 2 && node.children.length > 0) next.add(node.id);
    });
    setExpanded(next);
    setSeeded(stamp);
  }, [roots, nodeCount, tab, seeded]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as string[];
    const hits: string[] = [];
    walk(roots, (node) => {
      const hay = `${node.name} ${node.code ?? ''} ${node.subtitle ?? ''}`.toLowerCase();
      if (hay.includes(q)) hits.push(node.id);
    });
    return hits;
  }, [roots, query]);

  const matchSet = useMemo(() => new Set(matches), [matches]);

  // Auto-open the path to every match.
  useEffect(() => {
    if (matches.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of matches) {
        let cursor = parentMap.get(id) ?? null;
        while (cursor) {
          next.add(cursor);
          cursor = parentMap.get(cursor) ?? null;
        }
      }
      return next;
    });
    setMatchIndex(0);
  }, [matches, parentMap]);

  const scrollToMatch = useCallback((id: string | undefined) => {
    if (!id) return;
    const el = nodeRefs.current.get(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, []);

  useEffect(() => {
    if (matches.length === 0) return;
    const timer = window.setTimeout(() => scrollToMatch(matches[matchIndex]), 60);
    return () => window.clearTimeout(timer);
  }, [matches, matchIndex, scrollToMatch]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const next = new Set<string>();
    walk(roots, (node) => {
      if (node.children.length > 0) next.add(node.id);
    });
    setExpanded(next);
  }, [roots]);

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  const handlePrint = useCallback(() => {
    document.body.classList.add('org-chart-print');
    const cleanup = () => {
      document.body.classList.remove('org-chart-print');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    try {
      window.print();
    } catch (err: unknown) {
      cleanup();
      window.alert(errMsg(err, 'Print failed'));
    }
    window.setTimeout(cleanup, 2000);
  }, []);

  const handleExportCsv = useCallback(() => {
    try {
      const header = ['Employee', 'Code', 'Designation', 'Department', 'Manager', 'Direct reports', 'Total reports'];
      const lines: string[][] = [];
      walk(roots, (node, parent) => {
        lines.push([
          node.name,
          node.code ?? '',
          node.subtitle ?? '',
          node.meta ?? '',
          parent ? parent.name : '',
          String(node.direct),
          String(node.total),
        ]);
      });
      const esc = (cell: string) => `"${String(cell ?? '').replace(/"/g, '""')}"`;
      const csv = [header, ...lines].map((row) => row.map(esc).join(',')).join('\r\n');
      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = tab === 'people' ? 'org-chart-people.csv' : 'org-chart-positions.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      window.alert(errMsg(err, 'CSV export failed'));
    }
  }, [roots, tab]);

  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  }, []);

  const tabs: TabItem[] = [
    { id: 'people', label: 'People', count: people ? people.length : null },
    { id: 'positions', label: 'Positions', count: positions ? positions.length : null },
  ];

  const refresh = tab === 'people' ? loadPeople : loadPositions;

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>

      <div className="org-no-print flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-text-primary text-base font-semibold">Organization chart</h3>
          <p className="text-text-secondary text-xs mt-0.5">
            Reporting lines top-down · expand, search, zoom, print or export
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className={BTN_SECONDARY} onClick={refresh}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={14} /> Refresh
            </span>
          </button>
          <button className={BTN_SECONDARY} onClick={handlePrint}>
            <span className="inline-flex items-center gap-1.5">
              <Printer size={14} /> Print
            </span>
          </button>
          <button className={BTN_PRIMARY} onClick={handleExportCsv}>
            <span className="inline-flex items-center gap-1.5">
              <Download size={14} /> Export CSV
            </span>
          </button>
        </div>
      </div>

      <div className="org-no-print">
        <TabBar
          tabs={tabs}
          active={tab}
          onChange={(id) => {
            setTab(id);
            setQuery('');
            setSeeded('');
          }}
        />
      </div>

      {/* Toolbar ---------------------------------------------------------- */}
      <div className="org-no-print flex items-center gap-2 flex-wrap bg-bg-card border border-border-default rounded-md px-3 py-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className={`${INPUT_CLS} pl-8`}
            placeholder={tab === 'people' ? 'Search name or emp code…' : 'Search position or code…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {query.trim() !== '' && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted tabular-nums">
              {matches.length === 0 ? 'No matches' : `${matchIndex + 1} / ${matches.length} matches`}
            </span>
            <button
              className="p-1.5 rounded-md border border-border-default text-text-muted hover:bg-bg-hover disabled:opacity-40"
              disabled={matches.length === 0}
              aria-label="Previous match"
              onClick={() => setMatchIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0))}
            >
              <ChevronUp size={14} />
            </button>
            <button
              className="p-1.5 rounded-md border border-border-default text-text-muted hover:bg-bg-hover disabled:opacity-40"
              disabled={matches.length === 0}
              aria-label="Next match"
              onClick={() => setMatchIndex((i) => (matches.length ? (i + 1) % matches.length : 0))}
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}

        <div className="h-5 w-px bg-border-default" />

        <button
          className="px-2.5 py-1.5 rounded-md border border-border-default text-xs text-text-secondary hover:bg-bg-hover inline-flex items-center gap-1.5"
          onClick={expandAll}
        >
          <Maximize2 size={14} /> Expand all
        </button>
        <button
          className="px-2.5 py-1.5 rounded-md border border-border-default text-xs text-text-secondary hover:bg-bg-hover inline-flex items-center gap-1.5"
          onClick={collapseAll}
        >
          <Minimize2 size={14} /> Collapse all
        </button>

        <div className="h-5 w-px bg-border-default" />

        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded-md border border-border-default text-text-muted hover:bg-bg-hover disabled:opacity-40"
            aria-label="Zoom out"
            disabled={zoom <= 0.6}
            onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10))}
          >
            <ZoomOut size={14} />
          </button>
          <span className="text-xs text-text-muted tabular-nums w-11 text-center">{Math.round(zoom * 100)}%</span>
          <button
            className="p-1.5 rounded-md border border-border-default text-text-muted hover:bg-bg-hover disabled:opacity-40"
            aria-label="Zoom in"
            disabled={zoom >= 1.4}
            onClick={() => setZoom((z) => Math.min(1.4, Math.round((z + 0.1) * 10) / 10))}
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {error && (
        <div className="org-no-print">
          <ErrorBlock message={error} />
        </div>
      )}

      {/* Canvas ----------------------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md">
        {loading ? (
          <LoadingBlock label="Loading chart…" />
        ) : roots.length === 0 ? (
          <EmptyBlock
            message={tab === 'people' ? 'No reporting chart to show' : 'No position hierarchy to show'}
            hint={
              tab === 'people'
                ? 'Set a reporting manager on employee records to build the chart.'
                : 'Create positions and set “reports to” to build the position chart.'
            }
          />
        ) : (
          <div className="org-chart-scroll overflow-auto p-6 max-h-[calc(100vh-320px)]">
            <div
              className="org-chart-canvas inline-block origin-top-left transition-transform"
              style={{ transform: `scale(${zoom})` }}
            >
              <div className="flex items-start gap-8">
                {roots.map((root) => (
                  <ChartBranch
                    key={root.id}
                    node={root}
                    expanded={expanded}
                    matchSet={matchSet}
                    activeMatch={matches[matchIndex] ?? null}
                    onToggle={toggle}
                    onSelect={setSelected}
                    registerRef={registerRef}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <ModalShell
          title={selected.name}
          subtitle={selected.subtitle ?? selected.code ?? null}
          onClose={() => setSelected(null)}
          maxWidth="max-w-lg"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button className={BTN_SECONDARY} onClick={() => setSelected(null)}>
                Close
              </button>
              {selected.employeeId !== null && (
                <button
                  className={BTN_PRIMARY}
                  onClick={() => {
                    setSelected(null);
                    onNavigate('hrprofile');
                  }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    View profile <ArrowRight size={14} />
                  </span>
                </button>
              )}
            </div>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={selected.name} photoUrl={selected.photoUrl} size={48} />
              <div className="min-w-0">
                <p className="text-text-primary font-semibold">{selected.name}</p>
                <p className="text-text-secondary text-sm">{selected.subtitle ?? '—'}</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Code" value={selected.code} />
              <Detail label={tab === 'people' ? 'Department' : 'Occupancy'} value={selected.meta} />
              <Detail label="Direct reports" value={String(selected.direct)} />
              <Detail label="Total reports" value={String(selected.total)} />
            </dl>
            {selected.children.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
                  Direct reports
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.children.map((child) => (
                    <Chip key={child.id} label={child.name} tone="default" />
                  ))}
                </div>
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-text-muted font-medium">{label}</dt>
      <dd className="text-text-primary mt-0.5 break-words">{value && value !== '' ? value : '—'}</dd>
    </div>
  );
}

function Avatar({ name, photoUrl, size = 32 }: { name: string; photoUrl: string | null; size?: number }) {
  const src = usablePhoto(photoUrl);
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover border border-border-light flex-shrink-0"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size / 2.8)) }}
      className="rounded-full bg-primary-light text-primary font-semibold inline-flex items-center justify-center flex-shrink-0"
    >
      {initials(name)}
    </span>
  );
}

interface BranchProps {
  node: ChartVM;
  expanded: Set<string>;
  matchSet: Set<string>;
  activeMatch: string | null;
  onToggle: (id: string) => void;
  onSelect: (node: ChartVM) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}

/**
 * One node plus, when open, its children in a row. Connectors are plain
 * bordered divs: a stub down from the parent, an absolutely-positioned rule
 * across the siblings, and a stub down into each child.
 */
function ChartBranch({ node, expanded, matchSet, activeMatch, onToggle, onSelect, registerRef }: BranchProps) {
  const hasKids = node.children.length > 0;
  const isOpen = hasKids && expanded.has(node.id);
  const isMatch = matchSet.has(node.id);
  const isActive = activeMatch === node.id;

  return (
    <div className="flex flex-col items-center">
      <div
        ref={(el) => registerRef(node.id, el)}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(node);
          }
        }}
        className={`relative bg-bg-card border border-border-default rounded-md px-3 py-2 min-w-[170px] max-w-[210px] cursor-pointer hover:bg-bg-hover transition-colors ${
          isMatch ? 'ring-1 ring-primary' : ''
        } ${isActive ? 'bg-bg-selected' : ''}`}
      >
        <div className="flex items-start gap-2">
          <Avatar name={node.name} photoUrl={node.photoUrl} size={32} />
          <div className="min-w-0 flex-1">
            <p className="text-text-primary text-xs font-semibold truncate" title={node.name}>
              {node.name}
            </p>
            <p className="text-text-secondary text-[11px] truncate" title={node.subtitle ?? ''}>
              {node.subtitle ?? '—'}
            </p>
            <p className="text-text-muted text-[10px] truncate" title={node.meta ?? ''}>
              {node.meta ?? '—'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 mt-1.5">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-bg-secondary border border-border-light text-[10px] text-text-secondary tabular-nums">
            <Users size={11} /> {node.direct} direct
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-bg-secondary border border-border-light text-[10px] text-text-muted tabular-nums">
            {node.total} total
          </span>
        </div>

        {hasKids && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            className="org-no-print absolute -bottom-2.5 left-1/2 -translate-x-1/2 z-10 w-5 h-5 rounded-full bg-bg-card border border-border-default text-text-muted hover:text-primary hover:border-primary inline-flex items-center justify-center"
          >
            {isOpen ? <Minus size={11} /> : <Plus size={11} />}
          </button>
        )}
      </div>

      {isOpen && (
        <>
          {/* stub down out of the parent */}
          <div className="h-6 border-l border-border-default" />
          <div className="flex items-start">
            {node.children.map((child, i) => (
              <div key={child.id} className="relative flex flex-col items-center px-3">
                {node.children.length > 1 && (
                  <div
                    className="absolute top-0 border-t border-border-default"
                    style={{
                      left: i === 0 ? '50%' : 0,
                      right: i === node.children.length - 1 ? '50%' : 0,
                    }}
                  />
                )}
                {/* stub down into the child */}
                <div className="h-6 border-l border-border-default" />
                <ChartBranch
                  node={child}
                  expanded={expanded}
                  matchSet={matchSet}
                  activeMatch={activeMatch}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  registerRef={registerRef}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
