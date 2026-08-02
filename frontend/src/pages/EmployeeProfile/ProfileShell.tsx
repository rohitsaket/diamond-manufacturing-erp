// Header card, completeness meter and the section rail that frame every
// profile section.
import { useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Award,
  BadgeCheck,
  Banknote,
  Briefcase,
  Camera,
  ChevronDown,
  FileText,
  GraduationCap,
  HeartPulse,
  History,
  Landmark,
  Languages,
  Network,
  Package,
  Phone,
  Settings,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import { Chip, LABEL_CLS, INPUT_CLS } from '../../components/common/HrmsUI';
import { TabBar } from '../../components/common/TabBar';
import type { CompletenessRow } from '../../types/profile';
import type { Employee } from '../../data/mockData';
import { initialsOf, resolvePhotoSrc } from './ProfileField';
import type { FullProfile } from './ProfileField';

export interface SectionDef {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
}

/** Rail order is deliberate: identity first, then employment, then records. */
export const SECTIONS: SectionDef[] = [
  { id: 'personal', label: 'Personal', icon: User },
  { id: 'contact', label: 'Contact', icon: Phone },
  { id: 'family', label: 'Family', icon: Users },
  { id: 'emergency', label: 'Emergency', icon: HeartPulse },
  { id: 'education', label: 'Education', icon: GraduationCap },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'certifications', label: 'Certifications', icon: Award },
  { id: 'languages', label: 'Languages', icon: Languages },
  { id: 'experience', label: 'Experience', icon: Briefcase },
  { id: 'employment', label: 'Employment', icon: BadgeCheck },
  { id: 'organization', label: 'Organization', icon: Network },
  { id: 'photo', label: 'Photo', icon: Camera },
  { id: 'bank', label: 'Bank', icon: Landmark },
  { id: 'payroll', label: 'Payroll', icon: Banknote },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'assets', label: 'Assets', icon: Package },
  { id: 'timeline', label: 'Timeline', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

/** Weighted average of section percentages, weighted by field count. */
export function overallCompleteness(rows: CompletenessRow[]): number {
  const totalWeight = rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  if (totalWeight <= 0) return 0;
  const weighted = rows.reduce((sum, r) => sum + (Number(r.pct) || 0) * (Number(r.total) || 0), 0);
  return Math.round(weighted / totalWeight);
}

function CompletenessRing({ pct }: { pct: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const tone = clamped >= 80 ? 'text-success' : clamped >= 50 ? 'text-warning' : 'text-danger';
  return (
    <div className="relative w-16 h-16 flex-shrink-0">
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="6" className="stroke-bg-hover" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className={`${tone} transition-all duration-500`}
          stroke="currentColor"
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums ${tone}`}
      >
        {clamped}%
      </span>
    </div>
  );
}

interface ProfileShellProps {
  profile: FullProfile;
  completeness: CompletenessRow[];
  completenessError?: string | null;
  employees: Employee[];
  selectedId: number;
  onSelectEmployee: (id: number) => void;
  canSwitch: boolean;
  active: string;
  onSectionChange: (id: string) => void;
  children: ReactNode;
}

export function ProfileShell({
  profile,
  completeness,
  completenessError,
  employees,
  selectedId,
  onSelectEmployee,
  canSwitch,
  active,
  onSectionChange,
  children,
}: ProfileShellProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const photoSrc = resolvePhotoSrc(profile.photoUrl);
  const overall = overallCompleteness(completeness);
  const working = String(profile.workStatus ?? '').toUpperCase() === 'WORKING';
  const roleLine = [profile.designation, profile.department].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="bg-bg-card border border-border-default rounded-md p-4">
        <div className="flex items-start gap-4 flex-wrap">
          {photoSrc ? (
            <img
              src={photoSrc}
              alt={profile.fullName}
              className="w-16 h-16 rounded-full object-cover border border-border-default flex-shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary-light text-primary flex items-center justify-center text-xl font-semibold flex-shrink-0">
              {initialsOf(profile.fullName)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-text-primary truncate">{profile.fullName}</h2>
              {profile.preferredName && (
                <span className="text-text-muted text-sm">({profile.preferredName})</span>
              )}
              <Chip label={working ? 'Working' : 'Resigned'} tone={working ? 'success' : 'danger'} dot />
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className="text-text-muted text-sm font-mono">{profile.empCode}</span>
              {roleLine && <span className="text-text-muted text-xs">·</span>}
              {roleLine && <span className="text-text-secondary text-sm">{roleLine}</span>}
            </div>
            {canSwitch && employees.length > 0 && (
              <div className="mt-3 max-w-xs">
                <label className={LABEL_CLS} htmlFor="profile-viewing">
                  Viewing
                </label>
                <select
                  id="profile-viewing"
                  value={selectedId}
                  onChange={(e) => onSelectEmployee(Number(e.target.value))}
                  className={INPUT_CLS}
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.empCode} — {emp.fullName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-text-muted text-[10px] uppercase tracking-wider">Profile completeness</p>
                <button
                  type="button"
                  onClick={() => setShowBreakdown((v) => !v)}
                  className="text-primary text-xs inline-flex items-center gap-1 mt-0.5 hover:underline"
                >
                  {showBreakdown ? 'Hide breakdown' : 'Show breakdown'}
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${showBreakdown ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>
              <CompletenessRing pct={overall} />
            </div>
            {completenessError && <p className="text-danger text-[10px]">{completenessError}</p>}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {showBreakdown && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-4 pt-4 border-t border-border-light grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                {completeness.length === 0 && (
                  <p className="text-text-muted text-xs">No completeness data available.</p>
                )}
                {completeness.map((row) => (
                  <div key={row.section} className="flex items-center gap-2">
                    <span className="text-text-secondary text-xs w-28 flex-shrink-0 truncate capitalize">
                      {row.section.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          row.pct >= 80 ? 'bg-success' : row.pct >= 50 ? 'bg-warning' : 'bg-danger'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, row.pct))}%` }}
                      />
                    </div>
                    <span className="text-text-muted text-[10px] tabular-nums w-16 text-right">
                      {row.filled}/{row.total}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Rail + content */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:hidden">
          <TabBar
            tabs={SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
            active={active}
            onChange={onSectionChange}
          />
        </div>

        <nav className="hidden lg:flex flex-col gap-0.5 w-52 flex-shrink-0 bg-bg-card border border-border-default rounded-md p-2 h-fit sticky top-4">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = section.id === active;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onSectionChange(section.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                  isActive
                    ? 'bg-bg-selected text-primary font-medium'
                    : 'text-text-secondary hover:bg-bg-hover'
                }`}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0 space-y-4">{children}</div>
      </div>
    </div>
  );
}
