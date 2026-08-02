import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { profileApi } from '../../../api/profile';
import type { TimelineEvent, TimelineEventType } from '../../../types/profile';
import { ModalShell } from '../../../components/common/ModalShell';
import {
  Chip,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
  inr,
} from '../../../components/common/HrmsUI';
import { formatDate, toDateInput, errorMessage } from '../ProfileField';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const EVENT_META: Record<TimelineEventType, { label: string; tone: Tone; dot: string }> = {
  JOINED: { label: 'Joined', tone: 'success', dot: 'bg-success' },
  CONFIRMED: { label: 'Confirmed', tone: 'success', dot: 'bg-success' },
  PROMOTION: { label: 'Promotion', tone: 'success', dot: 'bg-success' },
  TRANSFER: { label: 'Transfer', tone: 'primary', dot: 'bg-primary' },
  SALARY_REVISION: { label: 'Salary revision', tone: 'info', dot: 'bg-info' },
  AWARD: { label: 'Award', tone: 'warning', dot: 'bg-warning' },
  DISCIPLINARY: { label: 'Disciplinary', tone: 'danger', dot: 'bg-danger' },
  PERFORMANCE_REVIEW: { label: 'Performance review', tone: 'info', dot: 'bg-info' },
  TRAINING: { label: 'Training', tone: 'default', dot: 'bg-text-muted' },
  EXIT: { label: 'Exit', tone: 'danger', dot: 'bg-danger' },
  OTHER: { label: 'Other', tone: 'default', dot: 'bg-text-muted' },
};

const EVENT_TYPES = Object.keys(EVENT_META) as TimelineEventType[];

interface FormState {
  eventType: TimelineEventType;
  eventDate: string;
  title: string;
  details: string;
  fromValue: string;
  toValue: string;
  amount: string;
  rating: string;
}

const emptyForm = (): FormState => ({
  eventType: 'PROMOTION',
  eventDate: new Date().toISOString().slice(0, 10),
  title: '',
  details: '',
  fromValue: '',
  toValue: '',
  amount: '',
  rating: '',
});

export function TimelineSection({ employeeId }: { employeeId: number }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TimelineEventType | 'ALL'>('ALL');
  const [editing, setEditing] = useState<TimelineEvent | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    profileApi
      .timeline(employeeId)
      .then((rows) => {
        setEvents(rows ?? []);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(load, [load]);

  const presentTypes = useMemo(() => {
    const set = new Set(events.map((e) => e.eventType));
    return EVENT_TYPES.filter((t) => set.has(t));
  }, [events]);

  const visible = useMemo(() => {
    const rows = filter === 'ALL' ? events : events.filter((e) => e.eventType === filter);
    return [...rows].sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));
  }, [events, filter]);

  const remove = (event: TimelineEvent) => {
    if (!window.confirm(`Delete "${event.title}"?`)) return;
    profileApi
      .deleteTimeline(event.id)
      .then(load)
      .catch((err: unknown) => window.alert(errorMessage(err)));
  };

  if (loading && events.length === 0) return <LoadingBlock label="Loading career timeline…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {(['ALL', ...presentTypes] as (TimelineEventType | 'ALL')[]).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                filter === t
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {t === 'ALL' ? 'All' : EVENT_META[t].label}
              <span className="ml-1.5 text-text-muted">
                ({t === 'ALL' ? events.length : events.filter((e) => e.eventType === t).length})
              </span>
            </button>
          ))}
        </div>
        <button onClick={() => setAdding(true)} className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`}>
          <Plus size={14} /> Add event
        </button>
      </div>

      {error && <ErrorBlock message={error} />}

      {visible.length === 0 ? (
        <EmptyBlock message="No timeline events" hint="Promotions, transfers, awards and reviews appear here." />
      ) : (
        <div className="bg-bg-card border border-border-default rounded-md p-5">
          <ol className="border-l border-border-default ml-1 space-y-5">
            {visible.map((event) => {
              const meta = EVENT_META[event.eventType] ?? EVENT_META.OTHER;
              return (
                <li key={event.id} className="relative pl-5">
                  <span className={`absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full ${meta.dot}`} />
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-text-primary text-sm font-medium">{event.title}</span>
                        <Chip label={meta.label} tone={meta.tone} />
                      </div>
                      <p className="text-text-muted text-[10px] mt-0.5">
                        {formatDate(event.eventDate)}
                        {event.recordedBy && ` · recorded by ${event.recordedBy}`}
                      </p>
                      {(event.fromValue || event.toValue) && (
                        <p className="text-text-secondary text-xs mt-1">
                          <span className="text-text-muted">{event.fromValue ?? '—'}</span>
                          {' → '}
                          <span className="text-text-primary font-medium">{event.toValue ?? '—'}</span>
                        </p>
                      )}
                      {event.amount != null && (
                        <p className="text-text-secondary text-xs mt-1 font-mono">{inr(event.amount)}</p>
                      )}
                      {event.rating != null && (
                        <p className="text-text-secondary text-xs mt-1">Rating: {event.rating}</p>
                      )}
                      {event.details && <p className="text-text-secondary text-xs mt-1">{event.details}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setEditing(event)}
                        className="text-text-muted hover:text-text-primary transition-colors"
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => remove(event)}
                        className="text-text-muted hover:text-danger transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <AnimatePresence>
        {(adding || editing) && (
          <TimelineModal
            employeeId={employeeId}
            event={editing}
            onClose={() => {
              setAdding(false);
              setEditing(null);
            }}
            onSaved={() => {
              setAdding(false);
              setEditing(null);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TimelineModal({
  employeeId,
  event,
  onClose,
  onSaved,
}: {
  employeeId: number;
  event: TimelineEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    event
      ? {
          eventType: event.eventType,
          eventDate: toDateInput(event.eventDate),
          title: event.title ?? '',
          details: event.details ?? '',
          fromValue: event.fromValue ?? '',
          toValue: event.toValue ?? '',
          amount: event.amount == null ? '' : String(event.amount),
          rating: event.rating == null ? '' : String(event.rating),
        }
      : emptyForm(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = () => {
    const found: Record<string, string> = {};
    if (!form.title.trim()) found.title = 'A title is required';
    if (!form.eventDate) found.eventDate = 'A date is required';
    // The server rejects future events, so stop it here with a clearer message.
    else if (form.eventDate > new Date().toISOString().slice(0, 10)) {
      found.eventDate = 'Timeline events cannot be dated in the future';
    }
    if (form.amount && Number.isNaN(Number(form.amount))) found.amount = 'Enter a valid amount';
    if (form.rating && (Number.isNaN(Number(form.rating)) || Number(form.rating) < 0 || Number(form.rating) > 10)) {
      found.rating = 'Rating must be between 0 and 10';
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    const body = {
      eventType: form.eventType,
      eventDate: form.eventDate,
      title: form.title.trim(),
      details: form.details.trim() || null,
      fromValue: form.fromValue.trim() || null,
      toValue: form.toValue.trim() || null,
      amount: form.amount ? Number(form.amount) : null,
      rating: form.rating ? Number(form.rating) : null,
    };

    setSaving(true);
    const request = event
      ? profileApi.updateTimeline(event.id, body)
      : profileApi.addTimeline(employeeId, body);
    request
      .then(onSaved)
      .catch((err: unknown) => window.alert(errorMessage(err)))
      .finally(() => setSaving(false));
  };

  return (
    <ModalShell
      title={event ? 'Edit timeline event' : 'Add timeline event'}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY} disabled={saving}>
            Cancel
          </button>
          <button onClick={submit} className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`} disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />} Save
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL_CLS}>Event type</label>
          <select
            value={form.eventType}
            onChange={(e) => set('eventType', e.target.value as TimelineEventType)}
            className={INPUT_CLS}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_META[t].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Date</label>
          <input
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={form.eventDate}
            onChange={(e) => set('eventDate', e.target.value)}
            className={`${INPUT_CLS} ${errors.eventDate ? 'border-danger' : ''}`}
          />
          {errors.eventDate && <p className="text-danger text-[9px] mt-0.5">{errors.eventDate}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL_CLS}>Title</label>
          <input
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            className={`${INPUT_CLS} ${errors.title ? 'border-danger' : ''}`}
          />
          {errors.title && <p className="text-danger text-[9px] mt-0.5">{errors.title}</p>}
        </div>
        <div>
          <label className={LABEL_CLS}>From</label>
          <input value={form.fromValue} onChange={(e) => set('fromValue', e.target.value)} className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>To</label>
          <input value={form.toValue} onChange={(e) => set('toValue', e.target.value)} className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Amount</label>
          <input
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
            className={`${INPUT_CLS} ${errors.amount ? 'border-danger' : ''}`}
          />
          {errors.amount && <p className="text-danger text-[9px] mt-0.5">{errors.amount}</p>}
        </div>
        <div>
          <label className={LABEL_CLS}>Rating</label>
          <input
            value={form.rating}
            onChange={(e) => set('rating', e.target.value)}
            placeholder="0 – 10"
            className={`${INPUT_CLS} ${errors.rating ? 'border-danger' : ''}`}
          />
          {errors.rating && <p className="text-danger text-[9px] mt-0.5">{errors.rating}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL_CLS}>Details</label>
          <textarea
            rows={3}
            value={form.details}
            onChange={(e) => set('details', e.target.value)}
            className={`${INPUT_CLS} resize-y`}
          />
        </div>
      </div>
    </ModalShell>
  );
}
