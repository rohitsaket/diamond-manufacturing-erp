import { memo } from 'react';
import { ClipboardList } from 'lucide-react';
import { OrderStatusItem } from '../dashboard.types';
import { SectionCard } from './SectionCard';

function OrderStatusBase({ orders, totalLots }: { orders: OrderStatusItem[]; totalLots: number }) {
  const maxVal = Math.max(...orders.map((o) => o.value), 1);
  return (
    <SectionCard
      title="Order Status"
      subtitle={`${totalLots} total orders in scope`}
      icon={<ClipboardList size={15} />}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {orders.map((o) => (
          <div key={o.key} className={`border border-border-default rounded-lg p-3 ${o.value > 0 ? o.tint : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-text-muted text-[11px] font-semibold uppercase tracking-wider">{o.label}</span>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: o.color }} />
            </div>
            <p className="text-2xl font-semibold text-text-primary tabular-nums">{o.value}</p>
            <div className="mt-2 h-1 rounded-full bg-bg-hover overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(o.value / maxVal) * 100}%`, background: o.color }} />
            </div>
            <p className="text-[10px] text-text-muted mt-1.5 tabular-nums">{o.value > 0 ? `${Math.round((o.value / maxVal) * 100)}% of max` : 'No orders'}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export const OrderStatus = memo(OrderStatusBase);
