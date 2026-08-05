import { AttendanceDayRepository } from '../repositories/AttendanceDayRepository';
import { AttendancePunchRepository } from '../repositories/AttendancePunchRepository';
import { AttendanceRequestRepository } from '../repositories/AttendanceRequestRepository';
import { AttendanceComplianceRepository } from '../repositories/AttendanceComplianceRepository';
import { AttendanceAnalyticsRepository } from '../repositories/AttendanceAnalyticsRepository';
import { AttendanceDeviceRepository } from '../repositories/AttendanceDeviceRepository';
import { VisitorRepository } from '../repositories/VisitorRepository';
import { AttendanceReportResult } from '../types/attendance';
import { daysBetween, isValidDateString, todayString } from '../utils/dateUtils';

export interface ReportParams {
  from?: string;
  to?: string;
  employeeId?: number;
  branchId?: number;
  departmentId?: number;
  status?: string;
  limit?: number;
}

interface ReportDefinition {
  slug: string;
  title: string;
  description: string;
  headers: { key: string; label: string; align?: 'left' | 'right' }[];
}

/** Rows a single report will return before it says it was truncated. */
const ROW_CAP = 5000;
const MAX_REPORT_DAYS = 400;

export const ATTENDANCE_REPORTS: ReportDefinition[] = [
  {
    slug: 'daily', title: 'Daily attendance',
    description: 'Every marked day in the range with times, hours and exceptions.',
    headers: [
      { key: 'date', label: 'Date' }, { key: 'empCode', label: 'Code' },
      { key: 'employeeName', label: 'Employee' }, { key: 'status', label: 'Status' },
      { key: 'shift', label: 'Shift' }, { key: 'inTime', label: 'In' }, { key: 'outTime', label: 'Out' },
      { key: 'workedHours', label: 'Worked', align: 'right' }, { key: 'otHours', label: 'OT', align: 'right' },
      { key: 'lateMinutes', label: 'Late min', align: 'right' }, { key: 'workMode', label: 'Mode' },
    ],
  },
  {
    slug: 'monthly-summary', title: 'Monthly summary',
    description: 'Per-employee totals for the range: present, absent, leave, overtime and attendance percentage.',
    headers: [
      { key: 'empCode', label: 'Code' }, { key: 'employeeName', label: 'Employee' },
      { key: 'present', label: 'Present', align: 'right' }, { key: 'halfDay', label: 'Half', align: 'right' },
      { key: 'absent', label: 'Absent', align: 'right' }, { key: 'leave', label: 'Leave', align: 'right' },
      { key: 'weekOff', label: 'Week off', align: 'right' }, { key: 'holiday', label: 'Holiday', align: 'right' },
      { key: 'otHours', label: 'OT hrs', align: 'right' }, { key: 'lateDays', label: 'Late', align: 'right' },
      { key: 'attendancePct', label: 'Attendance %', align: 'right' },
    ],
  },
  {
    slug: 'late-coming', title: 'Late coming',
    description: 'Days where arrival was past the grace window, with the minutes lost.',
    headers: [
      { key: 'date', label: 'Date' }, { key: 'empCode', label: 'Code' },
      { key: 'employeeName', label: 'Employee' }, { key: 'inTime', label: 'In' },
      { key: 'lateMinutes', label: 'Late min', align: 'right' }, { key: 'shift', label: 'Shift' },
    ],
  },
  {
    slug: 'early-exit', title: 'Early exit',
    description: 'Days where the exit punch was before the shift ended.',
    headers: [
      { key: 'date', label: 'Date' }, { key: 'empCode', label: 'Code' },
      { key: 'employeeName', label: 'Employee' }, { key: 'outTime', label: 'Out' },
      { key: 'earlyExitMinutes', label: 'Early min', align: 'right' }, { key: 'shift', label: 'Shift' },
    ],
  },
  {
    slug: 'overtime', title: 'Overtime',
    description: 'Derived and approved overtime with the multiplier applied.',
    headers: [
      { key: 'date', label: 'Date' }, { key: 'empCode', label: 'Code' },
      { key: 'employeeName', label: 'Employee' }, { key: 'otType', label: 'Type' },
      { key: 'derivedHours', label: 'Derived', align: 'right' },
      { key: 'approvedHours', label: 'Approved', align: 'right' },
      { key: 'multiplier', label: 'Rate', align: 'right' },
      { key: 'payableHours', label: 'Payable', align: 'right' }, { key: 'status', label: 'Status' },
    ],
  },
  {
    slug: 'absent', title: 'Absence',
    description: 'Every day marked absent in the range.',
    headers: [
      { key: 'date', label: 'Date' }, { key: 'empCode', label: 'Code' },
      { key: 'employeeName', label: 'Employee' }, { key: 'department', label: 'Department' },
      { key: 'remarks', label: 'Remarks' },
    ],
  },
  {
    slug: 'exceptions', title: 'Exceptions',
    description: 'Days carrying any exception flag: late, early exit, missing punch, outside fence or over the hours cap.',
    headers: [
      { key: 'date', label: 'Date' }, { key: 'empCode', label: 'Code' },
      { key: 'employeeName', label: 'Employee' }, { key: 'status', label: 'Status' },
      { key: 'flags', label: 'Flags' }, { key: 'lateMinutes', label: 'Late min', align: 'right' },
      { key: 'earlyExitMinutes', label: 'Early min', align: 'right' },
    ],
  },
  {
    slug: 'shift', title: 'Shift-wise attendance',
    description: 'Attendance grouped by shift for the range.',
    headers: [
      { key: 'shift', label: 'Shift' }, { key: 'days', label: 'Employee-days', align: 'right' },
      { key: 'present', label: 'Present', align: 'right' }, { key: 'absent', label: 'Absent', align: 'right' },
      { key: 'late', label: 'Late', align: 'right' }, { key: 'otHours', label: 'OT hrs', align: 'right' },
      { key: 'attendancePct', label: 'Attendance %', align: 'right' },
    ],
  },
  {
    slug: 'department', title: 'Department-wise attendance',
    description: 'Attendance rolled up per department.',
    headers: [
      { key: 'name', label: 'Department' }, { key: 'present', label: 'Present', align: 'right' },
      { key: 'absent', label: 'Absent', align: 'right' }, { key: 'late', label: 'Late', align: 'right' },
      { key: 'otHours', label: 'OT hrs', align: 'right' },
      { key: 'attendancePct', label: 'Attendance %', align: 'right' },
    ],
  },
  {
    slug: 'branch', title: 'Branch-wise attendance',
    description: 'Attendance rolled up per branch.',
    headers: [
      { key: 'name', label: 'Branch' }, { key: 'present', label: 'Present', align: 'right' },
      { key: 'absent', label: 'Absent', align: 'right' },
      { key: 'attendancePct', label: 'Attendance %', align: 'right' },
    ],
  },
  {
    slug: 'punches', title: 'Punch log',
    description: 'The raw punch stream with capture method, device and location outcome.',
    headers: [
      { key: 'punchAt', label: 'When' }, { key: 'empCode', label: 'Code' },
      { key: 'employeeName', label: 'Employee' }, { key: 'punchType', label: 'Type' },
      { key: 'captureMethod', label: 'Method' }, { key: 'device', label: 'Device' },
      { key: 'geoStatus', label: 'Location' }, { key: 'distanceM', label: 'Distance m', align: 'right' },
    ],
  },
  {
    slug: 'requests', title: 'Attendance requests',
    description: 'Regularizations, corrections, overtime and shift requests with their approval state.',
    headers: [
      { key: 'requestNo', label: 'Request' }, { key: 'requestType', label: 'Type' },
      { key: 'empCode', label: 'Code' }, { key: 'employeeName', label: 'Employee' },
      { key: 'attDate', label: 'For date' }, { key: 'status', label: 'Status' },
      { key: 'level', label: 'Level' }, { key: 'submittedAt', label: 'Raised' },
    ],
  },
  {
    slug: 'compliance', title: 'Compliance violations',
    description: 'Open and resolved breaches with the statute each rule cites.',
    headers: [
      { key: 'severity', label: 'Severity' }, { key: 'rule', label: 'Rule' },
      { key: 'empCode', label: 'Code' }, { key: 'employeeName', label: 'Employee' },
      { key: 'period', label: 'Period' }, { key: 'observed', label: 'Observed', align: 'right' },
      { key: 'threshold', label: 'Limit', align: 'right' }, { key: 'status', label: 'Status' },
      { key: 'reference', label: 'Reference' },
    ],
  },
  {
    slug: 'devices', title: 'Device health',
    description: 'Every capture device with its last heartbeat, sync and punch volume.',
    headers: [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Device' },
      { key: 'type', label: 'Type' }, { key: 'branch', label: 'Branch' },
      { key: 'health', label: 'Health' }, { key: 'lastHeartbeat', label: 'Last heartbeat' },
      { key: 'lastSync', label: 'Last sync' }, { key: 'punches', label: 'Punches', align: 'right' },
    ],
  },
  {
    slug: 'visitors', title: 'Visitor and contractor log',
    description: 'Every visit in the range with hours on site.',
    headers: [
      { key: 'visitDate', label: 'Date' }, { key: 'visitorCode', label: 'Code' },
      { key: 'visitorName', label: 'Visitor' }, { key: 'visitorType', label: 'Type' },
      { key: 'companyName', label: 'Company' }, { key: 'host', label: 'Host' },
      { key: 'checkedIn', label: 'In' }, { key: 'checkedOut', label: 'Out' },
      { key: 'hours', label: 'Hours', align: 'right' }, { key: 'status', label: 'Status' },
    ],
  },
];

export class AttendanceReportService {
  private dayRepo = new AttendanceDayRepository();
  private punchRepo = new AttendancePunchRepository();
  private requestRepo = new AttendanceRequestRepository();
  private complianceRepo = new AttendanceComplianceRepository();
  private analyticsRepo = new AttendanceAnalyticsRepository();
  private deviceRepo = new AttendanceDeviceRepository();
  private visitorRepo = new VisitorRepository();

  catalogue(): ReportDefinition[] {
    return ATTENDANCE_REPORTS;
  }

  async run(slug: string, params: ReportParams): Promise<AttendanceReportResult> {
    const definition = ATTENDANCE_REPORTS.find((r) => r.slug === slug);
    if (!definition) {
      throw new Error(`Unknown report "${slug}". Available: ${ATTENDANCE_REPORTS.map((r) => r.slug).join(', ')}`);
    }

    const to = params.to && isValidDateString(params.to) ? params.to : todayString();
    const from = params.from && isValidDateString(params.from) ? params.from : to;
    if (to < from) throw new Error('Invalid date range: to must not be before from');
    const span = daysBetween(from, to);
    if (span > MAX_REPORT_DAYS) throw new Error(`A report can cover at most ${MAX_REPORT_DAYS} days. This range covers ${span}.`);

    const scope = { from, to, branchId: params.branchId, departmentId: params.departmentId, employeeId: params.employeeId };
    let rows: Record<string, string | number | null>[] = [];
    let note: string | null = null;

    switch (slug) {
      case 'daily': {
        const page = await this.dayRepo.list({ ...scope, pageSize: 1000, page: 1 });
        rows = page.rows.map((r) => ({
          date: r.date, empCode: r.empCode, employeeName: r.employeeName, status: r.status,
          shift: r.shiftName, inTime: r.inTime, outTime: r.outTime,
          workedHours: r.workedHours, otHours: r.otHours, lateMinutes: r.lateMinutes, workMode: r.workMode,
        }));
        if (page.total > page.rows.length) {
          note = `Showing the first ${page.rows.length} of ${page.total} rows. Narrow the range or filter by department to see the rest.`;
        }
        break;
      }

      case 'monthly-summary': {
        const days = await this.dayRepo.findRange(from, to, params.employeeId);
        const byEmployee = new Map<number, any>();
        for (const d of days) {
          if (params.branchId && d.branchId !== params.branchId) continue;
          if (params.departmentId && d.departmentId !== params.departmentId) continue;
          let row = byEmployee.get(d.employeeId);
          if (!row) {
            row = {
              empCode: d.empCode, employeeName: d.employeeName,
              present: 0, halfDay: 0, absent: 0, leave: 0, weekOff: 0, holiday: 0,
              otHours: 0, lateDays: 0, attendancePct: 0,
            };
            byEmployee.set(d.employeeId, row);
          }
          switch (d.status) {
            case 'PRESENT': row.present += 1; break;
            case 'HALF_DAY': row.halfDay += 1; break;
            case 'ABSENT': row.absent += 1; break;
            case 'LEAVE': row.leave += 1; break;
            case 'WEEK_OFF': row.weekOff += 1; break;
            case 'HOLIDAY': row.holiday += 1; break;
          }
          row.otHours += d.otHours;
          if (d.isLate) row.lateDays += 1;
        }
        rows = Array.from(byEmployee.values()).map((r) => {
          const expected = r.present + r.halfDay + r.absent + r.leave;
          return {
            ...r,
            otHours: Math.round(r.otHours * 100) / 100,
            attendancePct: expected === 0 ? 0 : Math.round(((r.present + r.halfDay * 0.5) / expected) * 1000) / 10,
          };
        }).sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)));
        break;
      }

      case 'late-coming': {
        const page = await this.dayRepo.list({ ...scope, exception: 'LATE', pageSize: 1000 });
        rows = page.rows.map((r) => ({
          date: r.date, empCode: r.empCode, employeeName: r.employeeName,
          inTime: r.inTime, lateMinutes: r.lateMinutes, shift: r.shiftName,
        }));
        break;
      }

      case 'early-exit': {
        const page = await this.dayRepo.list({ ...scope, exception: 'EARLY_EXIT', pageSize: 1000 });
        rows = page.rows.map((r) => ({
          date: r.date, empCode: r.empCode, employeeName: r.employeeName,
          outTime: r.outTime, earlyExitMinutes: r.earlyExitMinutes, shift: r.shiftName,
        }));
        break;
      }

      case 'overtime': {
        const page = await this.requestRepo.listOvertime({
          from, to, employeeId: params.employeeId, status: params.status, pageSize: 1000,
        });
        rows = page.rows.map((r) => ({
          date: r.attDate, empCode: r.empCode, employeeName: r.employeeName, otType: r.otType,
          derivedHours: r.derivedHours, approvedHours: r.approvedHours,
          multiplier: r.multiplier, payableHours: r.payableHours, status: r.status,
        }));
        break;
      }

      case 'absent': {
        const page = await this.dayRepo.list({ ...scope, status: 'ABSENT', pageSize: 1000 });
        rows = page.rows.map((r) => ({
          date: r.date, empCode: r.empCode, employeeName: r.employeeName,
          department: r.departmentId, remarks: r.remarks,
        }));
        break;
      }

      case 'exceptions': {
        const page = await this.dayRepo.list({ ...scope, exception: 'ANY', pageSize: 1000 });
        rows = page.rows.map((r) => ({
          date: r.date, empCode: r.empCode, employeeName: r.employeeName, status: r.status,
          flags: r.exceptionFlags.join(', '), lateMinutes: r.lateMinutes, earlyExitMinutes: r.earlyExitMinutes,
        }));
        break;
      }

      case 'shift': {
        const days = await this.dayRepo.findRange(from, to, params.employeeId);
        const byShift = new Map<string, any>();
        for (const d of days) {
          const key = d.shiftName ?? 'Unassigned';
          let row = byShift.get(key);
          if (!row) { row = { shift: key, days: 0, present: 0, absent: 0, late: 0, otHours: 0, expected: 0 }; byShift.set(key, row); }
          row.days += 1;
          if (d.status === 'PRESENT') row.present += 1;
          if (d.status === 'ABSENT') row.absent += 1;
          if (d.isLate) row.late += 1;
          row.otHours += d.otHours;
          if (['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE'].includes(d.status ?? '')) row.expected += 1;
        }
        rows = Array.from(byShift.values()).map((r) => ({
          shift: r.shift, days: r.days, present: r.present, absent: r.absent, late: r.late,
          otHours: Math.round(r.otHours * 100) / 100,
          attendancePct: r.expected === 0 ? 0 : Math.round((r.present / r.expected) * 1000) / 10,
        }));
        break;
      }

      case 'department':
        rows = (await this.analyticsRepo.byDimension(scope, 'department')) as any;
        break;

      case 'branch':
        rows = (await this.analyticsRepo.byDimension(scope, 'branch'))
          .map((r) => ({ name: r.name, present: r.present, absent: r.absent, attendancePct: r.attendancePct }));
        break;

      case 'punches': {
        const page = await this.punchRepo.list({
          from, to, employeeId: params.employeeId, branchId: params.branchId,
          departmentId: params.departmentId, pageSize: 500,
        });
        rows = page.rows.map((r) => ({
          punchAt: `${r.punchDate} ${r.punchTime}`, empCode: r.empCode ?? null, employeeName: r.employeeName ?? null,
          punchType: r.punchType, captureMethod: r.captureMethod, device: r.deviceName ?? null,
          geoStatus: r.geoStatus, distanceM: r.distanceM,
        }));
        if (page.total > page.rows.length) {
          note = `Showing the most recent ${page.rows.length} of ${page.total} punches.`;
        }
        break;
      }

      case 'requests': {
        const page = await this.requestRepo.list({
          from, to, employeeId: params.employeeId, status: params.status as any, pageSize: 1000,
        });
        rows = page.rows.map((r) => ({
          requestNo: r.requestNo, requestType: r.requestType, empCode: r.empCode,
          employeeName: r.employeeName, attDate: r.attDate, status: r.status,
          level: `${r.currentLevel}/${r.totalLevels}`,
          submittedAt: r.submittedAt ? r.submittedAt.slice(0, 16).replace('T', ' ') : null,
        }));
        break;
      }

      case 'compliance': {
        const page = await this.complianceRepo.listViolations({
          from, to, employeeId: params.employeeId, status: params.status as any, pageSize: 1000,
        });
        rows = page.rows.map((r) => ({
          severity: r.severity, rule: r.ruleName, empCode: r.empCode, employeeName: r.employeeName,
          period: r.periodStart === r.periodEnd ? r.periodStart : `${r.periodStart} to ${r.periodEnd}`,
          observed: r.observedValue, threshold: r.thresholdValue, status: r.status,
          reference: r.legalReference,
        }));
        break;
      }

      case 'devices': {
        const devices = await this.deviceRepo.findAll({});
        rows = devices.map((d) => ({
          code: d.code, name: d.name, type: d.deviceType, branch: d.branchName ?? null,
          health: d.healthStatus,
          lastHeartbeat: d.lastHeartbeatAt ? d.lastHeartbeatAt.slice(0, 16).replace('T', ' ') : null,
          lastSync: d.lastSyncAt ? d.lastSyncAt.slice(0, 16).replace('T', ' ') : null,
          punches: d.totalPunches,
        }));
        note = 'Device health is a snapshot at the time this report ran.';
        break;
      }

      case 'visitors': {
        const page = await this.visitorRepo.listVisits({ from, to, branchId: params.branchId, pageSize: 1000 });
        rows = page.rows.map((r) => ({
          visitDate: r.visitDate, visitorCode: r.visitorCode, visitorName: r.visitorName,
          visitorType: r.visitorType, companyName: r.companyName, host: r.hostName,
          checkedIn: r.checkedInAt ? r.checkedInAt.slice(11, 16) : null,
          checkedOut: r.checkedOutAt ? r.checkedOutAt.slice(11, 16) : null,
          hours: r.hours, status: r.status,
        }));
        break;
      }

      default:
        throw new Error(`Report "${slug}" has no implementation`);
    }

    let truncatedAt: number | null = null;
    if (rows.length > ROW_CAP) {
      truncatedAt = ROW_CAP;
      rows = rows.slice(0, ROW_CAP);
      note = `${note ? `${note} ` : ''}Output was capped at ${ROW_CAP} rows.`;
    }

    return {
      report: slug,
      title: definition.title,
      generatedAt: new Date().toISOString(),
      from,
      to,
      headers: definition.headers,
      rows,
      total: rows.length,
      truncatedAt,
      note,
    };
  }

  /** RFC 4180 CSV: quotes doubled, fields with separators quoted. */
  toCsv(result: AttendanceReportResult): string {
    const escape = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const s = String(value);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    lines.push(result.headers.map((h) => escape(h.label)).join(','));
    for (const row of result.rows) {
      lines.push(result.headers.map((h) => escape(row[h.key])).join(','));
    }
    return lines.join('\r\n');
  }
}
