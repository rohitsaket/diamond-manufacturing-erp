import { useEffect, useState } from 'react';
import { Gem, Tag, FlaskConical, Settings2 } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../contexts/AppContext';
import {
  ShapeCategory,
  YIELD_TARGET_PCT,
  LOT_SLA_DAYS,
  LEAKAGE_FLAG_THRESHOLD_PCT,
} from '../../data/mockData';

interface Shape {
  id: number;
  name: string;
  shapeCategory: ShapeCategory;
}

const CATEGORY_STYLE: Record<ShapeCategory, string> = {
  ROUND: 'bg-primary-light text-primary',
  FANCY: 'bg-warning-light text-warning',
  BLOCKING: 'bg-bg-hover text-text-secondary',
};

function Card({ icon, title, count, children }: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-bg-card border border-border-default rounded-md">
      <div className="px-4 py-3 border-b border-border-default flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{icon}</span>
          <h3 className="text-text-primary font-semibold text-sm">{title}</h3>
        </div>
        {count !== undefined && (
          <span className="text-text-muted text-[10px] font-mono bg-bg-hover px-1.5 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function MasterData() {
  const { labourHeads } = useApp();
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [shapesError, setShapesError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Shape[]>('/floor/shapes')
      .then(setShapes)
      .catch((err) => setShapesError(err instanceof Error ? err.message : 'Failed to load shapes'));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-text-primary">Master Data</h2>
        <p className="text-text-secondary text-sm mt-1">Reference data used across the ERP · shapes · labour heads · labs · system constants</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card icon={<Gem size={15} />} title="Shapes" count={shapes.length}>
          {shapesError ? (
            <p className="text-danger text-xs">{shapesError}</p>
          ) : shapes.length === 0 ? (
            <p className="text-text-muted text-xs">Loading shapes…</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left">
                  <th className="text-text-muted text-[10px] uppercase tracking-wider font-medium pb-2">Name</th>
                  <th className="text-text-muted text-[10px] uppercase tracking-wider font-medium pb-2">Category</th>
                </tr>
              </thead>
              <tbody>
                {shapes.map((s) => (
                  <tr key={s.id} className="border-t border-border-light">
                    <td className="py-2 text-text-primary text-xs font-medium">{s.name}</td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${CATEGORY_STYLE[s.shapeCategory]}`}>
                        {s.shapeCategory}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="space-y-4">
          <Card icon={<Tag size={15} />} title="Labour Heads" count={labourHeads.length}>
            {labourHeads.length === 0 ? (
              <p className="text-text-muted text-xs">No labour heads loaded</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left">
                    <th className="text-text-muted text-[10px] uppercase tracking-wider font-medium pb-2">Code</th>
                    <th className="text-text-muted text-[10px] uppercase tracking-wider font-medium pb-2">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {labourHeads.map((h) => (
                    <tr key={h.id} className="border-t border-border-light">
                      <td className="py-2 text-text-secondary text-xs font-mono">{h.code}</td>
                      <td className="py-2 text-text-primary text-xs font-medium">{h.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card icon={<FlaskConical size={15} />} title="Grading Labs">
            <div className="flex gap-2">
              {['IGI', 'GIA', 'US'].map((lab) => (
                <span key={lab} className="px-3 py-1.5 rounded-md border border-border-default text-text-secondary text-xs font-medium">
                  {lab}
                </span>
              ))}
            </div>
          </Card>

          <Card icon={<Settings2 size={15} />} title="System Constants">
            <div className="space-y-3">
              {([
                ['Yield Target', `${YIELD_TARGET_PCT}%`],
                ['Lot SLA', `${LOT_SLA_DAYS} days`],
                ['Leakage Flag Threshold', `${LEAKAGE_FLAG_THRESHOLD_PCT}%`],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-text-muted text-xs">{k}</span>
                  <span className="text-text-primary text-xs font-mono font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
