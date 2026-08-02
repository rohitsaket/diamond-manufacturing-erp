export interface TabItem {
  id: string;
  label: string;
  count?: number | null;
}

interface TabBarProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}

/** Pill tab row, matching the filter pills used across the existing pages. */
export function TabBar({ tabs, active, onChange }: TabBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
              isActive
                ? 'bg-primary-light border-primary/30 text-primary'
                : 'border-border-default text-text-muted hover:border-text-muted'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count !== null && (
              <span className={`ml-1.5 ${isActive ? 'text-primary' : 'text-text-muted'}`}>({tab.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
