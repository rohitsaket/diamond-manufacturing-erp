import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { profileApi } from '../../../api/profile';
import type { EmployeeSettings, ProfileVisibility } from '../../../types/profile';
import { LoadingBlock, ErrorBlock, INPUT_CLS, LABEL_CLS } from '../../../components/common/HrmsUI';
import { SectionCard, EditToggle, errorMessage } from '../ProfileField';

const VISIBILITY_OPTIONS: { value: ProfileVisibility; label: string; hint: string }[] = [
  { value: 'EVERYONE', label: 'Everyone', hint: 'Any signed-in colleague can view this profile' },
  { value: 'TEAM', label: 'Team only', hint: 'Visible to the reporting team and HR' },
  { value: 'HR_ONLY', label: 'HR only', hint: 'Only HR and administrators can view it' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'gu', label: 'ગુજરાતી (Gujarati)' },
];

const DATE_FORMATS = ['DD-MM-YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MMM DD, YYYY'];

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match system' },
];

export function SettingsSection({ employeeId }: { employeeId: number }) {
  const [settings, setSettings] = useState<EmployeeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    profileApi
      .settings(employeeId)
      .then((s) => {
        setSettings(s);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(load, [load]);

  /**
   * Preferences save immediately on change — there is no draft state to lose,
   * and the optimistic update is rolled back if the server rejects it.
   */
  const patch = (body: Partial<EmployeeSettings>) => {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, ...body });
    setSaving(true);
    profileApi
      .updateSettings(employeeId, body)
      .then((updated) => setSettings(updated))
      .catch((err: unknown) => {
        setSettings(previous);
        window.alert(errorMessage(err));
      })
      .finally(() => setSaving(false));
  };

  if (loading && !settings) return <LoadingBlock label="Loading preferences…" />;
  if (error && !settings) return <ErrorBlock message={error} />;
  if (!settings) return null;

  return (
    <div className="space-y-4">
      {saving && <p className="text-text-muted text-[11px]">Saving…</p>}

      <SectionCard title="Privacy" subtitle="Who can see this profile">
        <div className="space-y-4">
          <div>
            <label className={LABEL_CLS}>Profile visibility</label>
            <select
              value={settings.profileVisibility}
              onChange={(e) => patch({ profileVisibility: e.target.value as ProfileVisibility })}
              className={INPUT_CLS}
            >
              {VISIBILITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-text-muted text-[9px] mt-0.5">
              {VISIBILITY_OPTIONS.find((o) => o.value === settings.profileVisibility)?.hint}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <EditToggle
              label="Show contact details to peers"
              checked={settings.showContactToPeers}
              onChange={(v) => patch({ showContactToPeers: v })}
            />
            <EditToggle
              label="Show birthday"
              checked={settings.showBirthday}
              onChange={(v) => patch({ showBirthday: v })}
              hint="Appears in the company birthday widgets"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Notifications" subtitle="What this employee is told about">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <EditToggle label="Leave" checked={settings.notifyLeave} onChange={(v) => patch({ notifyLeave: v })} />
          <EditToggle label="Payroll" checked={settings.notifyPayroll} onChange={(v) => patch({ notifyPayroll: v })} />
          <EditToggle
            label="Attendance"
            checked={settings.notifyAttendance}
            onChange={(v) => patch({ notifyAttendance: v })}
          />
          <EditToggle
            label="Announcements"
            checked={settings.notifyAnnouncements}
            onChange={(v) => patch({ notifyAnnouncements: v })}
          />
          <EditToggle
            label="Email copies"
            checked={settings.notifyEmail}
            onChange={(v) => patch({ notifyEmail: v })}
            hint="Only sent when SMTP is configured"
          />
        </div>
      </SectionCard>

      <SectionCard title="Language and display" subtitle="Locale preferences">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={LABEL_CLS}>Language</label>
            <select
              value={settings.language}
              onChange={(e) => patch({ language: e.target.value })}
              className={INPUT_CLS}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Date format</label>
            <select
              value={settings.dateFormat}
              onChange={(e) => patch({ dateFormat: e.target.value })}
              className={INPUT_CLS}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Theme</label>
            <select
              value={settings.theme}
              onChange={(e) => patch({ theme: e.target.value as EmployeeSettings['theme'] })}
              className={INPUT_CLS}
            >
              {THEMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-text-muted text-[11px] mt-3">
          Language is stored as a preference. The interface is currently English only, so it takes effect once
          translations are added.
        </p>
      </SectionCard>

      <SectionCard title="Security">
        <div className="flex items-start gap-3 px-3 py-3 rounded-md bg-bg-secondary border border-border-default">
          <ShieldAlert size={16} className="text-text-muted mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-text-primary text-sm font-medium">Two-factor authentication</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border border-border-default text-text-muted">
                Off
              </span>
            </div>
            <p className="text-text-secondary text-xs mt-1">
              Not available yet — no verification method is configured. The switch stays disabled rather than
              storing a setting that would not actually protect the account.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
