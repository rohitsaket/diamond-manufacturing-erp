import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../../api/client';
import { useApp } from '../../contexts/AppContext';
import { LOT_SLA_DAYS, YIELD_TARGET_PCT, LEAKAGE_FLAG_THRESHOLD_PCT, LotStatus, ShapeCategory, Lot } from '../../data/mockData';
import {
  DashboardData, GlobalFilters, KpiCardData, ProdPoint, PipelineStage, DepartmentStat,
  ShiftStat, ShiftKey, MachineStat, WorkforceRow, QualityStat, InventoryStat,
  OrderStatusItem, AlertItem, ActivityItem, RangeKey, SparkPoint,
} from './dashboard.types';

const SLA = LOT_SLA_DAYS;
const YIELD_TARGET = YIELD_TARGET_PCT;
const LEAKAGE = LEAKAGE_FLAG_THRESHOLD_PCT;

const todayLocal = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

function toDay(d: string | Date | null | undefined): string {
  if (!d) return '';
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return String(d).slice(0, 10);
}

function daysAgo(n: number): string {
  const d = todayLocal();
  d.setDate(d.getDate() - n);
  return toDay(d);
}

function diffDays(from: string, to: string): number {
  return Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000);
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

const GRADE_SKILL: Record<string, number> = {
  'A*': 96, 'A+++': 92, 'A++': 88, 'A+': 84, 'A': 78, 'B': 70,
};

const STATUS_ORDER: LotStatus[] = ['ISSUED', 'IN_PROGRESS', 'RECEIVED', 'VERIFIED', 'REWORK', 'LOST'];

// --- Pipeline stage model -----------------------------------------------------
const STAGE_POS: { id: string; name: string; pos: number }[] = [
  { id: 'planning', name: 'Planning', pos: 0 },
  { id: 'material', name: 'Material Issue', pos: 1 },
  { id: 'cutting', name: 'Cutting', pos: 2 },
  { id: 'blocking', name: 'Blocking', pos: 3 },
  { id: 'bruting', name: 'Bruting', pos: 4 },
  { id: 'polishing', name: 'Polishing', pos: 5 },
  { id: 'qc', name: 'QC', pos: 6 },
  { id: 'certification', name: 'Certification', pos: 7 },
  { id: 'packing', name: 'Packing', pos: 8 },
  { id: 'dispatch', name: 'Dispatch', pos: 9 },
];

const LOT_POS: Record<LotStatus, number> = {
  ISSUED: 1,
  IN_PROGRESS: 4,
  RECEIVED: 5,
  VERIFIED: 9,
  REWORK: 6,
  LOST: 9,
};

function buildSeries(lots: { receivedDate?: string; polishedWt?: number }[], days: number, labelFmt: (i: number, start: Date) => string): ProdPoint[] {
  const today = todayLocal();
  const buckets: ProdPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(today);
    start.setDate(start.getDate() - i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    buckets.push({ label: labelFmt(i, start), actual: 0, target: 0 });
    const a = start.getTime();
    const b = end.getTime();
    for (const lot of lots) {
      const rd = lot.receivedDate ? new Date(lot.receivedDate + 'T00:00:00').getTime() : NaN;
      if (!Number.isNaN(rd) && rd >= a && rd < b) buckets[buckets.length - 1].actual += lot.polishedWt ?? 0;
    }
  }
  const avg = buckets.reduce((s, p) => s + p.actual, 0) / days;
  const target = Math.max(Math.round(avg * 1.2), 1);
  buckets.forEach((p) => { p.target = target; });
  return buckets;
}

const RANGE_CFG: Record<RangeKey, { days: number; fmt: (i: number, start: Date) => string }> = {
  today: {
    days: 7,
    fmt: (_i, s) => s.toLocaleDateString('en-IN', { weekday: 'short' }),
  },
  week: {
    days: 28,
    fmt: (_i, s) => `${s.getMonth() + 1}/${s.getDate()}`,
  },
  month: {
    days: 90,
    fmt: (_i, s) => `${s.getDate()}/${s.getMonth() + 1}`,
  },
  quarter: {
    days: 180,
    fmt: (i, s) => (i % 7 === 0 ? `W${s.getMonth() * 4 + Math.ceil(s.getDate() / 7)}` : ''),
  },
  year: {
    days: 365,
    fmt: (_i, s) => s.toLocaleDateString('en-IN', { month: 'short' }),
  },
};

function weeklySpark(lots: any[], getDate: (l: any) => string | undefined, pick: (l: any) => number, weeks = 8): SparkPoint[] {
  const today = todayLocal();
  const out: SparkPoint[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = new Date(today);
    start.setDate(start.getDate() - w * 7 - 6);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    let sum = 0;
    for (const lot of lots) {
      const d = getDate(lot);
      if (!d) continue;
      const t = new Date(d + 'T00:00:00').getTime();
      if (t >= start.getTime() && t < end.getTime()) sum += pick(lot) ?? 0;
    }
    out.push({ label: `${w}w`, value: Math.round(sum * 10) / 10 });
  }
  return out;
}

const SHIFT_KEYS: ShiftKey[] = ['Morning', 'Evening', 'Night'];

export function useDashboardData(filters: GlobalFilters): DashboardData & { ready: boolean; searchResults: Lot[] } {
  const { lots, employees, salaryLines, salaryPeriods, labourHeads } = useApp();

  const [yieldTrend, setYieldTrend] = useState<{ month: string; yield: number; target: number }[]>([]);
  const [caratFlow, setCaratFlow] = useState<{ name: string; value: number; fill: string }[]>([]);
  const [chartsLoading, setChartsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<{ month: string; yield: number; target: number }[]>('/dashboard/yield-trend'),
      api.get<{ name: string; value: number; fill: string }[]>('/dashboard/carat-flow'),
    ])
      .then(([yt, cf]) => {
        if (active) { setYieldTrend(yt); setCaratFlow(cf); }
      })
      .catch(() => { /* charts stay empty on failure */ })
      .finally(() => { if (active) setChartsLoading(false); });
    return () => { active = false; };
  }, []);

  // Global search matches (for the header dropdown)
  const searchResults = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return [];
    return lots
      .filter((l) =>
        l.lotName.toLowerCase().includes(q) ||
        l.lotId.toLowerCase().includes(q) ||
        l.employeeName.toLowerCase().includes(q) ||
        l.shape.toLowerCase().includes(q))
      .slice(0, 8);
  }, [lots, filters.search]);

  const filteredLots = useMemo(() => {
    let out = lots;
    if (filters.department && filters.department !== 'ALL') {
      out = out.filter((l) => l.labourHead === filters.department);
    }
    if (filters.dateFrom && filters.dateTo) {
      out = out.filter((l) => l.issueDate >= filters.dateFrom! && l.issueDate <= filters.dateTo!);
    }
    return out;
  }, [lots, filters.department, filters.dateFrom, filters.dateTo]);

  const shiftOfEmployee = useCallback((id: number): ShiftKey => {
    return SHIFT_KEYS[id % SHIFT_KEYS.length];
  }, []);

  const filteredEmployees = useMemo(() => {
    if (!filters.shift || filters.shift === 'ALL') return employees;
    return employees.filter((e) => shiftOfEmployee(e.id) === filters.shift);
  }, [employees, filters.shift, shiftOfEmployee]);

  const data = useMemo<DashboardData>(() => {
    const totalLots = filteredLots.length;
    const statusCount = (s: LotStatus) => filteredLots.filter((l) => l.status === s).length;
    const activeStatuses: LotStatus[] = ['ISSUED', 'IN_PROGRESS'];
    const activeLots = filteredLots.filter((l) => activeStatuses.includes(l.status)).length;
    const completedLots = filteredLots.filter((l) => l.status === 'VERIFIED').length;
    const runningLots = statusCount('IN_PROGRESS');
    const pendingLots = statusCount('ISSUED') + statusCount('REWORK');
    const rejectedLots = statusCount('REWORK') + statusCount('LOST');

    const verifiedOrReceived = filteredLots.filter((l) => l.status === 'VERIFIED' || l.status === 'RECEIVED');
    const totalPolished = verifiedOrReceived.reduce((s, l) => s + (l.polishedWt ?? 0), 0);
    const totalIssued = verifiedOrReceived.reduce((s, l) => s + l.issueWeight, 0);
    const yieldPct = pct(totalPolished, totalIssued);

    const today = toDay(new Date());
    const todayProduction = filteredLots
      .filter((l) => l.receivedDate === today)
      .reduce((s, l) => s + (l.polishedWt ?? 0), 0);
    const todayReceived = filteredLots.filter((l) => l.receivedDate === today).length;
    const todayIssued = filteredLots.filter((l) => l.issueDate === today).length;

    const wip = filteredLots.filter((l) => activeStatuses.includes(l.status));
    const wipCarats = wip.reduce((s, l) => s + l.issueWeight, 0);

    const withDays = verifiedOrReceived.filter((l) => l.daysConsumed !== undefined);
    const avgDays = withDays.length > 0
      ? Math.round((withDays.reduce((s, l) => s + (l.daysConsumed ?? 0), 0) / withDays.length) * 10) / 10
      : 0;

    const totalLabour = salaryLines.reduce((s, l) => s + l.totalAmount, 0);
    const totalCts = salaryLines.reduce((s, l) => s + l.totalCts, 0);
    const labourPerCt = totalCts > 0 ? Math.round(totalLabour / totalCts) : 0;

    const received = filteredLots.filter((l) => l.daysConsumed !== undefined);
    const onTime = received.filter((l) => (l.daysConsumed ?? 0) <= SLA);
    const onTimePct = pct(onTime.length, received.length);

    const reworkPct = pct(rejectedLots, received.length + rejectedLots);
    const leakageExceptions = verifiedOrReceived.filter((l) => {
      if (!l.weightDiff || !l.issueWeight) return false;
      return (l.weightDiff / l.issueWeight) * 100 > LEAKAGE;
    }).length;

    const dailyProduction = buildSeries(verifiedOrReceived, 14, (_i, s) => `${s.getDate()}/${s.getMonth() + 1}`);
    const dailyIssued = buildSeries(
      filteredLots.map((l) => ({ receivedDate: l.issueDate, polishedWt: l.issueWeight })), 14,
      (_i, s) => `${s.getDate()}/${s.getMonth() + 1}`,
    );

    const series = {} as Record<RangeKey, ProdPoint[]>;
    (Object.keys(RANGE_CFG) as RangeKey[]).forEach((rk) => {
      series[rk] = buildSeries(verifiedOrReceived, RANGE_CFG[rk].days, RANGE_CFG[rk].fmt);
    });

    const kpis: KpiCardData[] = [
      {
        id: 'today-production', title: "Today's Production", value: todayProduction,
        suffix: ' ct', decimals: 1, target: Math.max(Math.round((dailyProduction.reduce((s, p) => s + p.actual, 0) / 14) * 1.2), 1),
        iconColor: 'text-primary', iconTint: 'bg-primary-light',
        badge: todayProduction >= 0 ? 'neutral' : 'neutral', statusLabel: todayProduction > 0 ? 'Producing' : 'No output',
        trend: 0, spark: dailyProduction.map((p) => ({ label: p.label, value: p.actual })),
        sub: `${todayReceived} lot${todayReceived === 1 ? '' : 's'} received`, navigate: 'floor',
        tooltip: 'Polished carats received today',
      },
      {
        id: 'completed', title: 'Completed Orders', value: completedLots, decimals: 0,
        target: Math.max(totalLots, 1),
        iconColor: 'text-success', iconTint: 'bg-success-light',
        badge: totalLots > 0 ? 'good' : 'neutral', statusLabel: `${pct(completedLots, totalLots)}% of total`,
        trend: 0, spark: weeklySpark(filteredLots, (l) => l.receivedDate, (_l) => 1),
        sub: 'lots fully verified', navigate: 'floor',
        tooltip: 'Lots that passed QC and are verified',
      },
      {
        id: 'running', title: 'Running Orders', value: runningLots, decimals: 0,
        target: Math.max(activeLots, 1),
        iconColor: 'text-warning', iconTint: 'bg-warning-light',
        badge: runningLots > 0 ? 'warn' : 'neutral', statusLabel: `${pct(runningLots, activeLots)}% of active`,
        trend: 0, spark: weeklySpark(filteredLots, (l) => l.issueDate, (l) => (l.status === 'IN_PROGRESS' ? 1 : 0)),
        sub: 'in progress on floor', navigate: 'floor',
        tooltip: 'Lots currently being worked',
      },
      {
        id: 'pending', title: 'Pending Orders', value: pendingLots, decimals: 0,
        target: Math.max(totalLots, 1),
        iconColor: 'text-text-secondary', iconTint: 'bg-bg-hover',
        badge: pendingLots > 0 ? 'warn' : 'neutral', statusLabel: `${pct(pendingLots, totalLots)}% of total`,
        trend: 0, spark: weeklySpark(filteredLots, (l) => l.issueDate, (l) => (l.status === 'ISSUED' || l.status === 'REWORK' ? 1 : 0)),
        sub: 'issued or rework queue', navigate: 'floor',
        tooltip: 'Lots not yet started plus rework queue',
      },
      {
        id: 'rejected', title: 'Rejected Orders', value: rejectedLots, decimals: 0,
        target: Math.max(totalLots, 1),
        iconColor: 'text-danger', iconTint: 'bg-danger-light',
        badge: rejectedLots > 0 ? 'bad' : 'neutral', statusLabel: `${pct(rejectedLots, totalLots)}% of total`,
        trend: 0, spark: weeklySpark(filteredLots, (l) => l.receivedDate, (l) => (l.status === 'REWORK' || l.status === 'LOST' ? 1 : 0)),
        sub: 'rework or lost lots', navigate: 'floor',
        tooltip: 'Lots flagged for rework or lost',
      },
      {
        id: 'efficiency', title: 'Overall Efficiency', value: yieldPct, suffix: '%', decimals: 1,
        target: YIELD_TARGET,
        iconColor: 'text-success', iconTint: 'bg-success-light',
        badge: yieldPct >= YIELD_TARGET ? 'good' : yieldPct >= YIELD_TARGET - 3 ? 'warn' : 'bad',
        statusLabel: `target ${YIELD_TARGET}%`,
        trend: yieldTrend.length >= 2 ? Math.round((yieldTrend[yieldTrend.length - 1].yield - yieldTrend[yieldTrend.length - 2].yield) * 10) / 10 : 0,
        spark: yieldTrend.map((y) => ({ label: y.month.slice(0, 3), value: y.yield })),
        sub: 'polished ÷ issued', navigate: 'floor',
        tooltip: 'Yield % = polished carats ÷ issued carats',
      },
      {
        id: 'wip', title: 'WIP Carats', value: wipCarats, suffix: ' ct', decimals: 1,
        target: Math.max(Math.round(wipCarats * 1.1), 1),
        iconColor: 'text-text-secondary', iconTint: 'bg-bg-hover',
        badge: 'neutral', statusLabel: `${activeLots} active lots`,
        trend: 0, spark: dailyIssued.map((p) => ({ label: p.label, value: p.actual })),
        sub: 'on floor right now', navigate: 'floor',
        tooltip: 'Work-in-process carats (issued + in progress)',
      },
      {
        id: 'avg-days', title: 'Avg Days', value: avgDays, suffix: 'd', decimals: 1,
        target: SLA,
        iconColor: 'text-info', iconTint: 'bg-info-light',
        badge: avgDays <= SLA ? 'good' : 'warn', statusLabel: `SLA ${SLA}d`,
        trend: 0, spark: weeklySpark(withDays, (l) => l.receivedDate, (l) => l.daysConsumed ?? 0),
        sub: 'average lot turnaround', navigate: 'floor',
        tooltip: `Average days consumed per completed lot (SLA ${SLA}d)`,
      },
      {
        id: 'labour', title: 'Labour / ct', value: labourPerCt, prefix: '₹', decimals: 0,
        target: Math.max(Math.round(labourPerCt * 1.05), 1),
        iconColor: 'text-purple-600', iconTint: 'bg-purple-50',
        badge: 'neutral', statusLabel: 'blended this period',
        trend: 0,
        spark: salaryPeriods.map((p) => {
          const ls = salaryLines.filter((l) => l.periodId === p.id);
          const cts = ls.reduce((s, l) => s + l.totalCts, 0);
          const amt = ls.reduce((s, l) => s + l.totalAmount, 0);
          return { label: p.label.slice(0, 3), value: cts > 0 ? Math.round(amt / cts) : 0 };
        }),
        sub: 'piece-rate cost per carat', navigate: 'payroll',
        tooltip: 'Blended labour cost per carat from salary lines',
      },
      {
        id: 'on-time', title: 'On-time', value: onTimePct, suffix: '%', decimals: 1,
        target: 85,
        iconColor: 'text-success', iconTint: 'bg-success-light',
        badge: onTimePct >= 85 ? 'good' : onTimePct >= 70 ? 'warn' : 'bad',
        statusLabel: `≤${SLA}d receive`,
        trend: 0, spark: weeklySpark(withDays, (l) => l.receivedDate, (l) => ((l.daysConsumed ?? 0) <= SLA ? 1 : 0)),
        sub: 'lots completed within SLA', navigate: 'floor',
        tooltip: `Share of lots received within ${SLA} days`,
      },
      {
        id: 'rework', title: 'Rework', value: reworkPct, suffix: '%', decimals: 1,
        target: 5,
        iconColor: 'text-danger', iconTint: 'bg-danger-light',
        badge: reworkPct <= 5 ? 'good' : reworkPct <= 10 ? 'warn' : 'bad',
        statusLabel: 'target ≤5%',
        trend: 0, spark: weeklySpark(filteredLots, (l) => l.receivedDate, (l) => (l.status === 'REWORK' ? 1 : 0)),
        sub: 'of received + rework', navigate: 'floor',
        tooltip: 'Rework share of all received lots',
      },
      {
        id: 'leakage', title: 'Leakage Exceptions', value: leakageExceptions, decimals: 0,
        target: 0,
        iconColor: 'text-danger', iconTint: 'bg-danger-light',
        badge: leakageExceptions === 0 ? 'good' : 'bad',
        statusLabel: leakageExceptions === 0 ? 'No flags' : 'Action needed',
        trend: 0, spark: weeklySpark(verifiedOrReceived, (l) => l.receivedDate, (l) => ((l.weightDiff ?? 0) > 0 && (l.weightDiff ?? 0) / l.issueWeight * 100 > LEAKAGE ? 1 : 0)),
        sub: `loss > ${LEAKAGE}% of issue`, navigate: 'floor',
        tooltip: `Lots with weight loss exceeding ${LEAKAGE}% of issue weight`,
      },
    ];

    // --- Pipeline -----------------------------------------------------------
    const pipeline: PipelineStage[] = STAGE_POS.map((stage) => {
      const inStage = filteredLots.filter((l) => LOT_POS[l.status] === stage.pos);
      const completed = filteredLots.filter((l) => LOT_POS[l.status] >= stage.pos);
      const pending = filteredLots.filter((l) => LOT_POS[l.status] < stage.pos);
      const delayed = inStage.filter((l) => diffDays(l.issueDate, today) > SLA);
      const rejected = filteredLots.filter((l) => (l.status === 'REWORK' || l.status === 'LOST') && LOT_POS[l.status] >= stage.pos);
      const withDays = completed.filter((l) => l.daysConsumed !== undefined);
      const avgTime = withDays.length
        ? Math.round((withDays.reduce((s, l) => s + (l.daysConsumed ?? 0), 0) / withDays.length) * 10) / 10
        : 0;
      return {
        id: stage.id,
        name: stage.name,
        completed: completed.length,
        running: inStage.length,
        pending: pending.length,
        delayed: delayed.length,
        rejected: rejected.length,
        avgTime,
        completionPct: pct(completed.length, totalLots),
      };
    });

    // --- Departments (labour heads) ----------------------------------------
    const departments: DepartmentStat[] = labourHeads.map((lh) => {
      const dlots = filteredLots.filter((l) => l.labourHead === lh.name);
      const done = dlots.filter((l) => l.status === 'VERIFIED' || l.status === 'RECEIVED');
      const pend = dlots.filter((l) => activeStatuses.includes(l.status) || l.status === 'REWORK');
      const dPolished = done.reduce((s, l) => s + (l.polishedWt ?? 0), 0);
      const dIssued = done.reduce((s, l) => s + l.issueWeight, 0);
      const dDays = done.filter((l) => l.daysConsumed !== undefined);
      const dAvg = dDays.length ? Math.round((dDays.reduce((s, l) => s + (l.daysConsumed ?? 0), 0) / dDays.length) * 10) / 10 : 0;
      const dDelay = dlots.filter((l) => activeStatuses.includes(l.status) && diffDays(l.issueDate, today) > SLA).length;
      return {
        id: lh.id,
        name: lh.name,
        orders: dlots.length,
        completed: done.length,
        pending: pend.length,
        efficiency: pct(dPolished, dIssued),
        avgTime: dAvg,
        delay: dDelay,
        status: dlots.length === 0 ? 'idle' : dDelay > 0 ? 'at-risk' : 'on-track',
      };
    });

    // --- Shifts (workers grouped round-robin) -------------------------------
    const working = employees.filter((e) => e.workStatus === 'WORKING');
    const shiftBuckets = SHIFT_KEYS.map((sk) => working.filter((e) => shiftOfEmployee(e.id) === sk));
    const shifts: ShiftStat[] = SHIFT_KEYS.map((sk, idx) => {
      const workers = shiftBuckets[idx];
      const wLots = filteredLots.filter((l) => workers.some((w) => w.id === l.employeeId));
      const wDone = wLots.filter((l) => l.status === 'VERIFIED' || l.status === 'RECEIVED');
      const wPolished = wDone.reduce((s, l) => s + (l.polishedWt ?? 0), 0);
      const wIssued = wDone.reduce((s, l) => s + l.issueWeight, 0);
      const wReject = wLots.filter((l) => l.status === 'REWORK' || l.status === 'LOST').length;
      const wActive = wLots.filter((l) => activeStatuses.includes(l.status)).length;
      const efficiency = pct(wPolished, wIssued);
      return {
        key: sk,
        production: Math.round(wPolished * 10) / 10,
        workers: workers.length,
        efficiency,
        downtime: wLots.length ? Math.round((wReject / wLots.length) * 100) : 0,
        rejections: wReject,
        machineUsage: wLots.length ? pct(wActive, wLots.length) : 0,
        attendance: 100,
      };
    });

    // --- Machines / lines (derived from shape categories) -------------------
    const categories: ShapeCategory[] = ['ROUND', 'FANCY', 'BLOCKING'];
    const machines: MachineStat[] = categories.map((cat, idx) => {
      const mlots = filteredLots.filter((l) => l.shapeCategory === cat);
      const active = mlots.filter((l) => activeStatuses.includes(l.status));
      const done = mlots.filter((l) => l.status === 'VERIFIED' || l.status === 'RECEIVED');
      const rejected = mlots.filter((l) => l.status === 'REWORK' || l.status === 'LOST');
      const polished = done.reduce((s, l) => s + (l.polishedWt ?? 0), 0);
      const issued = done.reduce((s, l) => s + l.issueWeight, 0);
      const efficiency = pct(polished, issued);
      const dDays = done.filter((l) => l.daysConsumed !== undefined);
      const avgTime = dDays.length ? Math.round((dDays.reduce((s, l) => s + (l.daysConsumed ?? 0), 0) / dDays.length) * 10) / 10 : 0;
      const downtime = mlots.length ? Math.round((rejected.length / mlots.length) * 100) : 0;
      const quality = mlots.length ? pct(done.length - rejected.length, done.length) : 100;
      const availability = Math.max(0, 100 - downtime);
      const performance = issued > 0 ? Math.min(100, Math.round((polished / issued) / 0.68 * 100)) : 0;
      const oee = Math.round(availability * 0.01 * performance * 0.01 * quality * 0.01 * 100);
      const operator = mlots.length
        ? employees.find((e) => e.id === mlots.reduce((a, b) => (b.issueWeight > a.issueWeight ? b : a)).employeeId)?.fullName?.split(' ')[0] ?? '—'
        : '—';
      const latest = [...mlots].sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
      let status: MachineStat['status'] = 'idle';
      if (mlots.length === 0) status = 'maintenance';
      else if (rejected.length >= mlots.length * 0.5) status = 'breakdown';
      else if (active.length > 0) status = 'running';
      const lastActivity = done.length ? [...done].sort((a, b) => (b.receivedDate ?? '').localeCompare(a.receivedDate ?? ''))[0]?.receivedDate : null;
      const idleDays = lastActivity ? Math.max(0, diffDays(lastActivity, today)) : 0;
      return {
        id: `LINE-0${idx + 1}`,
        name: `${cat} Line`,
        operator,
        currentJob: latest ? `${latest.lotName} · ${latest.qty} pcs` : '—',
        status,
        runningTime: status === 'running' ? Math.max(0, diffDays(latest?.issueDate ?? today, today)) : avgTime,
        idleTime: status === 'idle' ? idleDays : 0,
        downtime,
        efficiency,
        temperature: Math.round(34 + ((mlots.length + idx * 3) % 9)),
        maintenanceDue: status === 'maintenance' ? 0 : status === 'idle' ? idleDays : 0,
        oee,
      };
    });

    // --- Workforce ----------------------------------------------------------
    const workforce: WorkforceRow[] = filteredEmployees
      .filter((e) => e.workStatus === 'WORKING')
      .map((e) => {
        const elots = filteredLots.filter((l) => l.employeeId === e.id);
        const done = elots.filter((l) => l.status === 'VERIFIED' || l.status === 'RECEIVED').length;
        const pend = elots.filter((l) => activeStatuses.includes(l.status) || l.status === 'REWORK').length;
        const active = elots.filter((l) => activeStatuses.includes(l.status));
        const latestActive = [...active].sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
        const skill = GRADE_SKILL[e.grade] ?? 75;
        const score = Math.min(100, Math.round(e.yieldPct * 0.7 + 100 * 0.2 + skill * 0.1));
        return {
          id: e.id,
          name: e.fullName,
          shortName: e.shortName,
          department: e.workerType === 'PIECE_RATE' ? 'Piece Rate' : e.workerType === 'DHAR' ? 'Dhar' : 'Maxi Unit',
          operation: latestActive ? latestActive.shape : done > 0 ? 'Idle' : 'No lots',
          completed: done,
          pending: pend,
          efficiency: e.yieldPct,
          attendance: 100,
          score,
          skill,
          grade: e.grade,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    // --- Quality ------------------------------------------------------------
    const qLots = filteredLots.filter((l) => ['VERIFIED', 'REWORK', 'LOST'].includes(l.status));
    const passCount = statusCount('VERIFIED');
    const rejectCount = statusCount('LOST');
    const reworkCount = statusCount('REWORK');
    const qTotal = Math.max(qLots.length, 1);
    const defectSrc = filteredLots.filter((l) => l.status === 'REWORK' || l.status === 'LOST');
    const defectDist = categories.map((cat) => ({
      name: cat,
      value: defectSrc.filter((l) => l.shapeCategory === cat).length,
      color: cat === 'ROUND' ? '#2563EB' : cat === 'FANCY' ? '#16A34A' : '#CA8A04',
    })).filter((d) => d.value > 0);
    const labs = ['IGI', 'GIA', 'US'];
    const rootCause = labs.map((lb) => ({
      name: lb,
      value: defectSrc.filter((l) => l.lab === lb).length,
      color: lb === 'IGI' ? '#2563EB' : lb === 'GIA' ? '#16A34A' : '#CA8A04',
    })).filter((d) => d.value > 0);
    const deptDefects = labourHeads
      .map((lh) => ({ name: lh.name, value: defectSrc.filter((l) => l.labourHead === lh.name).length }))
      .filter((d) => d.value > 0);
    const inspectionTrend = weeklySpark(filteredLots, (l) => l.receivedDate, (_l) => 1, 12);
    const quality: QualityStat = {
      passPct: pct(passCount, qTotal),
      rejectPct: pct(rejectCount, qTotal),
      reworkPct: pct(reworkCount, qTotal),
      openNcr: reworkCount,
      inspectionPending: statusCount('RECEIVED'),
      todaysQc: filteredLots.filter((l) => l.status === 'VERIFIED' && l.receivedDate === today).length,
      defectDist,
      rootCause,
      deptDefects,
      inspectionTrend,
    };

    // --- Inventory ----------------------------------------------------------
    const raw = filteredLots.filter((l) => l.status === 'ISSUED').reduce((s, l) => s + l.issueWeight, 0);
    const invWip = filteredLots.filter((l) => l.status === 'IN_PROGRESS').reduce((s, l) => s + l.issueWeight, 0);
    const finished = verifiedOrReceived.reduce((s, l) => s + (l.polishedWt ?? 0), 0);
    const rejectedInv = filteredLots.filter((l) => l.status === 'REWORK' || l.status === 'LOST').reduce((s, l) => s + (l.polishedWt ?? l.issueWeight), 0);
    const totalEst = filteredLots.reduce((s, l) => s + l.estimateWt, 0);
    const totalIss = filteredLots.reduce((s, l) => s + l.issueWeight, 0);
    const available = Math.max(0, Math.round((totalEst - totalIss) * 10) / 10);
    const buckets = [0, 7, 14, 21];
    const aging = buckets.map((b, i) => {
      const from = b;
      const to = i < buckets.length - 1 ? buckets[i + 1] - 1 : Infinity;
      const value = filteredLots.filter((l) => {
        const d = diffDays(l.issueDate, today);
        return activeStatuses.includes(l.status) && d >= from && d <= to;
      }).length;
      return { name: to === Infinity ? `${from}d+` : `${from}-${to}d`, value, color: ['#16A34A', '#CA8A04', '#EA580C', '#DC2626'][i] };
    });
    const inventory: InventoryStat = {
      raw: Math.round(raw * 10) / 10,
      wip: Math.round(invWip * 10) / 10,
      finished: Math.round(finished * 10) / 10,
      rejected: Math.round(rejectedInv * 10) / 10,
      reserved: Math.round((raw + invWip) * 10) / 10,
      available,
      flow: caratFlow,
      consumption: dailyIssued.map((p) => ({ name: p.label, value: Math.round(p.actual * 10) / 10 })),
      aging,
      turnover: Math.round((finished / Math.max(totalIss, 1)) * 1000) / 10,
    };

    // --- Order status -------------------------------------------------------
    const delayedCount = filteredLots.filter((l) => activeStatuses.includes(l.status) && diffDays(l.issueDate, today) > SLA).length;
    const orders: OrderStatusItem[] = [
      { key: 'new', label: 'New', value: filteredLots.filter((l) => l.issueDate >= daysAgo(7)).length, color: '#6B7280', tint: 'bg-bg-hover' },
      { key: 'released', label: 'Released', value: statusCount('ISSUED'), color: '#2563EB', tint: 'bg-primary-light' },
      { key: 'running', label: 'Running', value: runningLots, color: '#CA8A04', tint: 'bg-warning-light' },
      { key: 'delayed', label: 'Delayed', value: delayedCount, color: '#EA580C', tint: 'bg-orange-50' },
      { key: 'completed', label: 'Completed', value: completedLots, color: '#16A34A', tint: 'bg-success-light' },
      { key: 'cancelled', label: 'Cancelled', value: 0, color: '#9CA3AF', tint: 'bg-bg-hover' },
      { key: 'urgent', label: 'Urgent', value: 0, color: '#DC2626', tint: 'bg-danger-light' },
      { key: 'blocked', label: 'Blocked', value: reworkCount, color: '#7C3AED', tint: 'bg-purple-50' },
    ];

    // --- Alerts -------------------------------------------------------------
    const alerts: AlertItem[] = [];
    let n = 0;
    for (const lot of verifiedOrReceived) {
      const wd = lot.weightDiff ?? 0;
      if (wd > 0 && wd / lot.issueWeight * 100 > LEAKAGE) {
        if (n++ >= 3) break;
        alerts.push({
          id: `leak-${lot.id}`, priority: 'critical', category: 'Quality',
          title: `Material leakage — ${((wd / lot.issueWeight) * 100).toFixed(1)}%`,
          detail: `${lot.lotName} · ${lot.employeeName.split(' ')[0]}`,
        });
      }
    }
    n = 0;
    for (const lot of filteredLots) {
      if (activeStatuses.includes(lot.status) && diffDays(lot.issueDate, today) > SLA) {
        if (n++ >= 3) break;
        alerts.push({
          id: `delay-${lot.id}`, priority: 'high', category: 'Production',
          title: `Delayed job — ${diffDays(lot.issueDate, today)}d`,
          detail: `${lot.lotName} · ${lot.employeeName.split(' ')[0]}`,
        });
      }
    }
    n = 0;
    for (const lot of filteredLots) {
      if (lot.status === 'REWORK') {
        if (n++ >= 3) break;
        alerts.push({
          id: `rework-${lot.id}`, priority: 'medium', category: 'Quality',
          title: 'QC rework pending',
          detail: `${lot.lotName} · ${lot.employeeName.split(' ')[0]}`,
        });
      }
    }
    for (const m of machines) {
      if (m.status === 'idle' && m.idleTime > 0) {
        alerts.push({
          id: `maint-${m.id}`, priority: 'low', category: 'Maintenance',
          title: `${m.name} idle ${m.idleTime}d`,
          detail: 'Line idle — maintenance recommended',
        });
      }
    }
    if (todayIssued > 0) {
      alerts.push({ id: 'sys-today', priority: 'low', category: 'System', title: `${todayIssued} lot${todayIssued === 1 ? '' : 's'} issued today`, detail: 'Production started' });
    }

    // --- Recent activity ----------------------------------------------------
    const acts: ActivityItem[] = [];
    for (const lot of filteredLots) {
      if (lot.status === 'ISSUED' || lot.status === 'IN_PROGRESS') {
        acts.push({
          id: `i-${lot.id}`, type: 'issue', title: 'Production started',
          detail: `Lot ${lot.lotName} issued to ${lot.employeeName.split(' ')[0]}`,
          date: lot.issueDate,
        });
      }
      if (lot.receivedDate) {
        if (lot.status === 'REWORK') {
          acts.push({
            id: `rw-${lot.id}`, type: 'rework', title: 'QC failed — rework',
            detail: `Lot ${lot.lotName} (${lot.employeeName.split(' ')[0]}) returned for rework`,
            date: lot.receivedDate,
          });
        } else if (lot.status === 'VERIFIED') {
          acts.push({
            id: `v-${lot.id}`, type: 'verify', title: 'QC verified',
            detail: `Lot ${lot.lotName} passed QC · ${lot.polishedWt?.toFixed(2)} ct polished`,
            date: lot.receivedDate,
          });
        } else {
          acts.push({
            id: `r-${lot.id}`, type: 'receive', title: 'Lot received',
            detail: `Lot ${lot.lotName} received · ${lot.polishedWt?.toFixed(2)} ct`,
            date: lot.receivedDate,
          });
        }
      }
    }
    const activities = acts
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);

    return {
      kpis,
      series,
      yieldTrend,
      caratFlow,
      pipeline,
      departments,
      shifts,
      machines,
      workforce,
      quality,
      inventory,
      orders,
      alerts,
      activities,
      totals: {
        totalLots,
        activeLots,
        todayProduction,
        todayReceived,
        todayIssued,
      },
    };
  }, [
    filteredLots, employees, filteredEmployees, salaryLines, salaryPeriods, labourHeads,
    yieldTrend, caratFlow, shiftOfEmployee,
  ]);

  return { ...data, ready: !chartsLoading, searchResults };
}

export { STATUS_ORDER, SHIFT_KEYS };
