import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronRight,
  ChevronDown,
  Search,
  Maximize2,
  Minimize2,
  RefreshCw,
  Move,
  Users,
  X,
} from 'lucide-react';
import {
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import { orgApi } from '../../api/organization';
import { ORG_ENTITY_LABELS, type OrgTreeNode } from '../../types/organization';
import { EntityIcon, OrgStatusChip, HeadcountPill, DetailRow, errMsg } from './orgUi';

interface FlatRow {
  node: OrgTreeNode;
  depth: number;
  parentKey: string | null;
  hasChildren: boolean;
  expanded: boolean;
  pos: number;
  size: number;
}

interface DropState {
  key: string;
  valid: boolean;
}

const entityLabel = (type: string): string => ORG_ENTITY_LABELS[type] ?? type.replace(/_/g, ' ');

/** Depth-first walk over the whole tree, ignoring expansion and filters. */
function walkAll(nodes: OrgTreeNode[], depth: number, parentKey: string | null, visit: (n: OrgTreeNode, depth: number, parentKey: string | null) => void) {
  for (const n of nodes) {
    visit(n, depth, parentKey);
    if (n.children.length > 0) walkAll(n.children, depth + 1, n.key, visit);
  }
}

/**
 * Interactive company hierarchy: expand/collapse, live search, drag-and-drop
 * reparenting (with a keyboard-accessible "Move…" alternative) and a detail
 * panel for the selected unit.
 */
export function OrgStructureTree({
  canEdit,
  onNavigate,
}: {
  canEdit: boolean;
  onNavigate: (page: string) => void;
}) {
  const [nodes, setNodes] = useState<OrgTreeNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showTeams, setShowTeams] = useState(true);
  const [showEmployees, setShowEmployees] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropState | null>(null);
  const [moveNode, setMoveNode] = useState<OrgTreeNode | null>(null);
  const [busy, setBusy] = useState(false);

  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const seeded = useRef(false);

  // -- data ------------------------------------------------------------------

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    orgApi
      .tree({ includeTeams: showTeams, includeEmployees: showEmployees })
      .then((rows) => {
        setNodes(rows);
        if (!seeded.current) {
          seeded.current = true;
          setExpanded(new Set(rows.map((r) => r.key)));
        }
      })
      .catch((err: unknown) => setError(errMsg(err, 'Could not load the organization structure')))
      .finally(() => setLoading(false));
  }, [showTeams, showEmployees]);

  useEffect(() => {
    load();
  }, [load]);

  // -- indexes ---------------------------------------------------------------

  const index = useMemo(() => {
    const byKey = new Map<string, OrgTreeNode>();
    const parentOf = new Map<string, string | null>();
    const depthOf = new Map<string, number>();
    const order: string[] = [];
    walkAll(nodes ?? [], 0, null, (n, depth, parentKey) => {
      byKey.set(n.key, n);
      parentOf.set(n.key, parentKey);
      depthOf.set(n.key, depth);
      order.push(n.key);
    });
    return { byKey, parentOf, depthOf, order };
  }, [nodes]);

  const isDescendantOf = useCallback(
    (candidateKey: string, ancestorKey: string): boolean => {
      let cursor = index.parentOf.get(candidateKey) ?? null;
      while (cursor) {
        if (cursor === ancestorKey) return true;
        cursor = index.parentOf.get(cursor) ?? null;
      }
      return false;
    },
    [index],
  );

  // -- search ----------------------------------------------------------------

  const trimmed = query.trim().toLowerCase();

  const { matches, visible } = useMemo(() => {
    const matched = new Set<string>();
    const vis = new Set<string>();
    if (!trimmed) return { matches: matched, visible: vis };
    for (const key of index.order) {
      const n = index.byKey.get(key);
      if (!n) continue;
      const haystack = `${n.name} ${n.code ?? ''} ${n.subtitle ?? ''}`.toLowerCase();
      if (!haystack.includes(trimmed)) continue;
      matched.add(key);
      vis.add(key);
      let cursor = index.parentOf.get(key) ?? null;
      while (cursor) {
        vis.add(cursor);
        cursor = index.parentOf.get(cursor) ?? null;
      }
    }
    return { matches: matched, visible: vis };
  }, [trimmed, index]);

  // -- flattened visible rows -------------------------------------------------

  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    const searching = trimmed !== '';

    const walk = (list: OrgTreeNode[], depth: number, parentKey: string | null) => {
      const siblings = searching ? list.filter((n) => visible.has(n.key)) : list;
      siblings.forEach((n, i) => {
        const hasChildren = n.children.length > 0;
        const isOpen = searching ? true : expanded.has(n.key);
        out.push({
          node: n,
          depth,
          parentKey,
          hasChildren,
          expanded: isOpen,
          pos: i + 1,
          size: siblings.length,
        });
        if (hasChildren && isOpen) walk(n.children, depth + 1, n.key);
      });
    };

    walk(nodes ?? [], 0, null);
    return out;
  }, [nodes, expanded, visible, trimmed]);

  // -- focus management -------------------------------------------------------

  useEffect(() => {
    if (!focusedKey) return;
    itemRefs.current.get(focusedKey)?.focus();
  }, [focusedKey, rows]);

  const setOpen = (key: string, open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const expandAll = () => {
    const next = new Set<string>();
    walkAll(nodes ?? [], 0, null, (n) => {
      if (n.children.length > 0) next.add(n.key);
    });
    setExpanded(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const idx = rows.findIndex((r) => r.node.key === focusedKey);
    if (idx < 0) {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        setFocusedKey(rows[0].node.key);
      }
      return;
    }
    const row = rows[idx];

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (idx < rows.length - 1) setFocusedKey(rows[idx + 1].node.key);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (idx > 0) setFocusedKey(rows[idx - 1].node.key);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (row.hasChildren && !row.expanded) setOpen(row.node.key, true);
        else if (row.hasChildren && idx < rows.length - 1) setFocusedKey(rows[idx + 1].node.key);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (row.hasChildren && row.expanded) setOpen(row.node.key, false);
        else if (row.parentKey) setFocusedKey(row.parentKey);
        break;
      case 'Home':
        e.preventDefault();
        setFocusedKey(rows[0].node.key);
        break;
      case 'End':
        e.preventDefault();
        setFocusedKey(rows[rows.length - 1].node.key);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        setSelectedKey(row.node.key);
        break;
      case 'm':
      case 'M':
        if (canEdit) {
          e.preventDefault();
          setMoveNode(row.node);
        }
        break;
      default:
        break;
    }
  };

  // -- reparenting ------------------------------------------------------------

  const dropAllowed = useCallback(
    (sourceKey: string, targetKey: string): boolean => {
      if (!canEdit) return false;
      if (sourceKey === targetKey) return false;
      if (isDescendantOf(targetKey, sourceKey)) return false;
      if ((index.parentOf.get(sourceKey) ?? null) === targetKey) return false;
      return true;
    },
    [canEdit, isDescendantOf, index],
  );

  const reparent = useCallback(
    (source: OrgTreeNode, parentType: string | undefined, parentId: number | null) => {
      setBusy(true);
      orgApi
        .reparent({ entityType: source.entityType, id: source.id, newParentType: parentType, newParentId: parentId })
        .then(() => {
          setMoveNode(null);
          load();
        })
        .catch((err: unknown) => window.alert(errMsg(err, `Could not move ${source.name}`)))
        .finally(() => setBusy(false));
    },
    [load],
  );

  const handleDrop = (targetKey: string) => {
    const sourceKey = dragKey;
    setDragKey(null);
    setDropTarget(null);
    if (!sourceKey || !dropAllowed(sourceKey, targetKey)) return;
    const source = index.byKey.get(sourceKey);
    const target = index.byKey.get(targetKey);
    if (!source || !target) return;
    reparent(source, target.entityType, target.id);
  };

  // -- selection --------------------------------------------------------------

  const selected = selectedKey ? (index.byKey.get(selectedKey) ?? null) : null;
  const selectedParent = selectedKey ? index.parentOf.get(selectedKey) ?? null : null;
  const selectedParentNode = selectedParent ? index.byKey.get(selectedParent) ?? null : null;

  // -- render -----------------------------------------------------------------

  if (loading && !nodes) return <LoadingBlock label="Loading the organization structure…" />;
  if (error) return <ErrorBlock message={error} />;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="bg-bg-card border border-border-default rounded-md p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className={`${INPUT_CLS} pl-8`}
            placeholder="Search units, codes or owners…"
            aria-label="Search the organization structure"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={showTeams} onChange={(e) => setShowTeams(e.target.checked)} />
          Show teams
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={showEmployees} onChange={(e) => setShowEmployees(e.target.checked)} />
          Show employees
        </label>

        <div className="flex items-center gap-1.5 ml-auto">
          <button type="button" className={BTN_SECONDARY} onClick={expandAll} aria-label="Expand all nodes">
            <span className="inline-flex items-center gap-1.5">
              <Maximize2 size={14} /> Expand all
            </span>
          </button>
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => setExpanded(new Set())}
            aria-label="Collapse all nodes"
          >
            <span className="inline-flex items-center gap-1.5">
              <Minimize2 size={14} /> Collapse all
            </span>
          </button>
          <button type="button" className={BTN_SECONDARY} onClick={load} aria-label="Reload the structure">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-text-muted text-[11px]">
        {showEmployees && <span>Employees are included — this loads the full workforce and can be slow.</span>}
        {trimmed && (
          <span className="text-text-secondary">
            {matches.size} match{matches.size === 1 ? '' : 'es'}
          </span>
        )}
        <span>
          Keyboard: ↑/↓ move, → expand, ← collapse, Enter select{canEdit ? ', M move' : ''}.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-3 items-start">
        {/* Tree */}
        <div className="bg-bg-card border border-border-default rounded-md overflow-hidden">
          {rows.length === 0 ? (
            <EmptyBlock
              message={trimmed ? 'No units match that search' : 'No organization units yet'}
              hint={trimmed ? 'Try a different code or name.' : 'Create a company on the Entities tab to begin.'}
            />
          ) : (
            <div
              role="tree"
              aria-label="Organization structure"
              aria-busy={busy}
              className="py-1 max-h-[640px] overflow-y-auto scrollbar-thin"
              onKeyDown={handleKeyDown}
            >
              {rows.map((row) => {
                const { node, depth } = row;
                const isMatch = matches.has(node.key);
                const isSelected = selectedKey === node.key;
                const isDragging = dragKey === node.key;
                const drop = dropTarget?.key === node.key ? dropTarget : null;

                const tone = drop
                  ? drop.valid
                    ? 'bg-success-light border-success'
                    : 'bg-danger-light border-danger'
                  : isSelected
                    ? 'bg-bg-selected border-primary/40'
                    : isMatch
                      ? 'bg-warning-light border-transparent'
                      : 'border-transparent hover:bg-bg-hover';

                return (
                  <div
                    key={node.key}
                    ref={(el) => {
                      itemRefs.current.set(node.key, el);
                    }}
                    role="treeitem"
                    aria-level={depth + 1}
                    aria-posinset={row.pos}
                    aria-setsize={row.size}
                    aria-selected={isSelected}
                    aria-expanded={row.hasChildren ? row.expanded : undefined}
                    aria-label={`${node.name}, ${entityLabel(node.entityType)}`}
                    tabIndex={focusedKey === node.key ? 0 : -1}
                    draggable={canEdit}
                    onClick={() => {
                      setSelectedKey(node.key);
                      setFocusedKey(node.key);
                    }}
                    onFocus={() => setFocusedKey(node.key)}
                    onDragStart={(e) => {
                      if (!canEdit) return;
                      setDragKey(node.key);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', node.key);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragKey || dragKey === node.key) return;
                      const valid = dropAllowed(dragKey, node.key);
                      if (valid) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }
                      setDropTarget({ key: node.key, valid });
                    }}
                    onDragLeave={() => {
                      setDropTarget((prev) => (prev?.key === node.key ? null : prev));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(node.key);
                    }}
                    className={`group flex items-center gap-2 pr-2 py-1.5 border-l-2 cursor-pointer outline-none focus:ring-1 focus:ring-primary/40 transition-colors ${tone} ${
                      isDragging ? 'opacity-50' : ''
                    }`}
                    style={{ paddingLeft: 8 + depth * 18 }}
                  >
                    {row.hasChildren ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${node.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(node.key, !row.expanded);
                        }}
                        className="text-text-muted hover:text-text-primary shrink-0"
                      >
                        {row.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : (
                      <span className="w-[14px] shrink-0" />
                    )}

                    <EntityIcon entityType={node.entityType} size={14} />

                    <span className="text-text-primary text-sm truncate">{node.name}</span>
                    {node.code && <span className="text-text-muted text-[10px] font-mono shrink-0">{node.code}</span>}
                    {node.subtitle && (
                      <span className="text-text-muted text-[10px] truncate hidden md:inline">{node.subtitle}</span>
                    )}

                    <span className="ml-auto flex items-center gap-2 shrink-0">
                      <HeadcountPill count={node.headcount} vacancies={node.vacancies} />
                      {node.status && <OrgStatusChip status={node.status} />}
                      {canEdit && (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={`Move ${node.name} to another parent`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMoveNode(node);
                          }}
                          className="text-text-muted hover:text-primary opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <Move size={14} />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <motion.aside
          key={selected?.key ?? 'none'}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="bg-bg-card border border-border-default rounded-md p-4"
        >
          {!selected ? (
            <div className="text-center py-6">
              <p className="text-text-secondary text-sm">Select a unit</p>
              <p className="text-text-muted text-xs mt-1">Its details, headcount and vacancies appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <EntityIcon entityType={selected.entityType} size={18} className="text-primary mt-0.5" />
                <div className="min-w-0">
                  <p className="text-text-primary font-semibold text-sm break-words">{selected.name}</p>
                  <p className="text-text-muted text-[10px] font-mono">{selected.code ?? '—'}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <OrgStatusChip status={selected.status} />
                <HeadcountPill count={selected.headcount} vacancies={selected.vacancies} />
              </div>

              <div>
                <DetailRow label="Type" value={entityLabel(selected.entityType)} />
                <DetailRow label="Parent" value={selectedParentNode ? selectedParentNode.name : 'Top level'} />
                <DetailRow label="Detail" value={selected.subtitle ?? '—'} />
                <DetailRow label="Headcount" value={Number(selected.headcount ?? 0)} />
                <DetailRow label="Vacancies" value={Number(selected.vacancies ?? 0)} />
                <DetailRow label="Direct children" value={selected.children.length} />
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={() => onNavigate('employees')}
                  aria-label={`View employees in ${selected.name}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Users size={14} /> View employees
                  </span>
                </button>
                {canEdit && (
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    onClick={() => setMoveNode(selected)}
                    aria-label={`Move ${selected.name} to another parent`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Move size={14} /> Move…
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}
        </motion.aside>
      </div>

      {moveNode && (
        <MoveModal
          node={moveNode}
          nodes={nodes ?? []}
          busy={busy}
          disallowed={(candidateKey) => !dropAllowed(moveNode.key, candidateKey)}
          onClose={() => setMoveNode(null)}
          onMove={(parentType, parentId) => reparent(moveNode, parentType, parentId)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard-accessible alternative to drag and drop
// ---------------------------------------------------------------------------

function MoveModal({
  node,
  nodes,
  busy,
  disallowed,
  onClose,
  onMove,
}: {
  node: OrgTreeNode;
  nodes: OrgTreeNode[];
  busy: boolean;
  disallowed: (candidateKey: string) => boolean;
  onClose: () => void;
  onMove: (parentType: string | undefined, parentId: number | null) => void;
}) {
  const [target, setTarget] = useState('');

  const candidates = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    walkAll(nodes, 0, null, (n, depth) => {
      if (disallowed(n.key)) return;
      out.push({
        key: n.key,
        label: `${'  '.repeat(depth)}${n.name} · ${entityLabel(n.entityType)}`,
      });
    });
    return out;
  }, [nodes, disallowed]);

  const byKey = useMemo(() => {
    const map = new Map<string, OrgTreeNode>();
    walkAll(nodes, 0, null, (n) => map.set(n.key, n));
    return map;
  }, [nodes]);

  const submit = () => {
    if (target === '__root__') {
      onMove(undefined, null);
      return;
    }
    const picked = byKey.get(target);
    if (!picked) {
      window.alert('Choose a new parent first.');
      return;
    }
    onMove(picked.entityType, picked.id);
  };

  return (
    <ModalShell
      title={`Move ${node.name}`}
      subtitle={`${entityLabel(node.entityType)}${node.code ? ` · ${node.code}` : ''}`}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={busy || !target}>
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
            New parent
          </span>
          <select
            className={INPUT_CLS}
            value={target}
            aria-label="New parent"
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">— choose a parent —</option>
            <option value="__root__">Top level (no parent)</option>
            {candidates.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-text-muted text-[11px]">
          The unit itself and everything beneath it are excluded. The server refuses moves that would break the
          hierarchy and its reason is shown here.
        </p>
      </div>
    </ModalShell>
  );
}
