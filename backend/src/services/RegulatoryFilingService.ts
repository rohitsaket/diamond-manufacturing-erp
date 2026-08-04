import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import { ContributionRepository, SalaryLineDetailRow } from '../repositories/ContributionRepository';
import { FilingRepository, FilingInsert } from '../repositories/FilingRepository';
import { StatutoryRepository } from '../repositories/StatutoryRepository';
import {
  ContributionRecord,
  FilingFilters,
  FilingGenerationResult,
  FilingItem,
  FilingItemInput,
  RegisterResult,
  RegulatoryFiling,
} from '../types/compliance';
import { generateCsv } from '../utils/csv';
import { round2, toDateString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';
import {
  dueDateForMonth,
  financialYearOf,
  isValidPan,
  isValidUan,
  quarterMonths,
  resolveConfig,
  resolveStateRule,
} from '../utils/statutoryRules';

/**
 * The one sentence every generated return carries.
 *
 * There is no e-filing integration in this system. Nothing here authenticates
 * to EPFO, ESIC, a state commercial-tax portal or TRACES, and no response from
 * any of them is ever parsed. The file is produced for a human to upload.
 */
const MANUAL_NOTE =
  'This file was generated for manual upload. There is no automated e-filing integration: '
  + 'a person must sign in to the government portal and upload it, then record the acknowledgement here.';

const ECR_DELIMITER = '#~#';

/** The register flavours `generateStatutoryRegister` knows how to produce. */
const REGISTER_TYPES = new Set([
  'WAGE_REGISTER', 'MUSTER_ROLL', 'PF_REGISTER', 'ESI_REGISTER', 'PT_REGISTER',
]);

export interface RegisterParams {
  periodId?: number;
  monthKey?: string;
  financialYear?: string;
}

export interface MarkFiledInput {
  filedOn: string;
  acknowledgementNo?: string | null;
}

/** Per-employee bundle assembled from the ledger for one month. */
interface EmployeeBundle {
  employeeId: number;
  empCode: string;
  fullName: string;
  uan: string | null;
  esiIpNumber: string | null;
  ncpDays: number;
  paidDays: number;
  rows: Map<string, ContributionRecord>;
}

/**
 * Government return file generation.
 *
 * Every method here produces the CONTENT of a statutory return — an EPFO ECR
 * text file, an ESIC contribution CSV, a state PT/LWF register, the Form 24Q
 * figures — writes it to the upload directory so it can be downloaded again
 * exactly as submitted, and records one `regulatory_filing_items` row per
 * employee including the ones that failed validation.
 *
 * Rows that cannot legally go into a return (no UAN, no IP number, no PAN, zero
 * wage) are EXCLUDED from the file but still stored, so the gap between headcount
 * and filed count is always explainable.
 */
export class RegulatoryFilingService {
  private repo = new FilingRepository();
  private contributions = new ContributionRepository();
  private master = new StatutoryRepository();

  // =========================================================================
  // PF — EPFO Electronic Challan cum Return
  // =========================================================================

  /**
   * EPFO ECR: one `#~#` delimited line per member.
   *
   * Field order, which the portal validates positionally:
   *   UAN, member name, gross wages, EPF wages, EPS wages, EDLI wages,
   *   EPF contribution due, EPS contribution due, EPF-EPS difference due,
   *   NCP days, refund of advances.
   *
   * Amounts are whole rupees: the ECR upload rejects decimals.
   */
  async generatePfEcr(monthKey: string, userId: number): Promise<FilingGenerationResult> {
    this.assertMonthKey(monthKey);
    const bundles = await this.loadBundles(monthKey, ['PF', 'EPS', 'EDLI', 'VPF']);
    if (bundles.length === 0) throw new Error(`No PF contributions were found for ${monthKey}`);

    const grossByEmployee = await this.grossByEmployee(monthKey);

    const items: FilingItemInput[] = [];
    const lines: string[] = [];
    let totalAmount = 0;
    let included = 0;

    for (const bundle of bundles) {
      const pf = bundle.rows.get('PF');
      const eps = bundle.rows.get('EPS');
      const edli = bundle.rows.get('EDLI');
      const vpf = bundle.rows.get('VPF');

      const epfWages = pf ? pf.wageBase : 0;
      const epsWages = eps ? eps.wageBase : 0;
      const edliWages = edli ? edli.wageBase : 0;
      const grossWages = grossByEmployee.get(bundle.employeeId) ?? (pf ? pf.uncappedWage : 0);
      // VPF rides along with the employee's own EPF remittance on the ECR.
      const epfDue = round2((pf ? pf.employeeAmount : 0) + (vpf ? vpf.employeeAmount : 0));
      const epsDue = eps ? eps.employerAmount : 0;
      const diffDue = pf ? pf.employerAmount : 0;
      const total = round2(epfDue + epsDue + diffDue + (edli ? edli.employerAmount : 0));

      // The ECR is filed in whole rupees and the portal checks that the pension
      // share plus the difference equals the employer share. Rounding the two
      // parts independently can leave them a rupee apart, so the difference is
      // derived from the rounded employer TOTAL instead of rounded separately.
      const epsRounded = Math.round(epsDue);
      const diffRounded = Math.round(epsDue + diffDue) - epsRounded;

      let validationStatus: FilingItemInput['validationStatus'] = 'VALID';
      let validationMessage: string | null = null;
      if (!bundle.uan) {
        validationStatus = 'MISSING_IDENTIFIER';
        validationMessage = 'No UAN on record; the member cannot be filed in the ECR';
      } else if (!isValidUan(bundle.uan)) {
        validationStatus = 'INVALID_IDENTIFIER';
        validationMessage = `UAN "${bundle.uan}" is not twelve digits`;
      } else if (epfWages <= 0) {
        validationStatus = 'ZERO_WAGE';
        validationMessage = 'EPF wage base is zero';
      }

      items.push({
        employeeId: bundle.employeeId,
        identifier: bundle.uan,
        wageBase: epfWages,
        employeeAmount: epfDue,
        employerAmount: round2(epsDue + diffDue),
        totalAmount: total,
        ncpDays: bundle.ncpDays,
        extra: {
          grossWages,
          epsWages,
          edliWages,
          edliDue: edli ? edli.employerAmount : 0,
          adminCharges: pf ? pf.adminCharges : 0,
          vpf: vpf ? vpf.employeeAmount : 0,
        },
        validationStatus,
        validationMessage,
      });

      if (validationStatus !== 'VALID') continue;

      lines.push([
        String(bundle.uan),
        this.sanitiseName(bundle.fullName),
        Math.round(grossWages),
        Math.round(epfWages),
        Math.round(epsWages),
        Math.round(edliWages),
        Math.round(epfDue),
        epsRounded,
        diffRounded,
        Math.round(bundle.ncpDays),
        0,
      ].join(ECR_DELIMITER));
      totalAmount = round2(totalAmount + total);
      included += 1;
    }

    const fileContent = `${lines.join('\n')}\n`;
    const fileName = `ECR_${monthKey}.txt`;
    const dueDate = await this.configDueDate('PF', monthKey);

    return this.persist({
      filingType: 'PF_ECR',
      scheme: 'PF',
      frequency: 'MONTHLY',
      monthKey,
      quarter: null,
      stateCode: null,
      registrationType: 'PF',
      dueDate,
      employeeCount: included,
      totalAmount,
      fileName,
      fileContent,
      fileFormat: 'TXT',
      items,
      userId,
      remarks: `EPFO ECR for ${monthKey}. ${included} of ${items.length} members included.`,
    });
  }

  // =========================================================================
  // ESI
  // =========================================================================

  /** ESIC monthly contribution CSV: IP number, name, days, wages, contribution. */
  async generateEsiReturn(monthKey: string, userId: number): Promise<FilingGenerationResult> {
    this.assertMonthKey(monthKey);
    const bundles = await this.loadBundles(monthKey, ['ESI']);
    if (bundles.length === 0) throw new Error(`No ESI contributions were found for ${monthKey}`);

    const items: FilingItemInput[] = [];
    const csvRows: unknown[][] = [];
    let totalAmount = 0;
    let included = 0;

    for (const bundle of bundles) {
      const esi = bundle.rows.get('ESI');
      if (!esi) continue;

      let validationStatus: FilingItemInput['validationStatus'] = 'VALID';
      let validationMessage: string | null = null;
      if (!bundle.esiIpNumber) {
        validationStatus = 'MISSING_IDENTIFIER';
        validationMessage = 'No ESI insured person number on record';
      } else if (esi.wageBase <= 0) {
        validationStatus = 'ZERO_WAGE';
        validationMessage = 'ESI wage base is zero';
      }

      items.push({
        employeeId: bundle.employeeId,
        identifier: bundle.esiIpNumber,
        wageBase: esi.wageBase,
        employeeAmount: esi.employeeAmount,
        employerAmount: esi.employerAmount,
        totalAmount: esi.totalAmount,
        ncpDays: bundle.ncpDays,
        extra: { paidDays: bundle.paidDays },
        validationStatus,
        validationMessage,
      });

      if (validationStatus !== 'VALID') continue;

      csvRows.push([
        bundle.esiIpNumber,
        bundle.fullName,
        bundle.paidDays.toFixed(2),
        esi.wageBase.toFixed(2),
        esi.employeeAmount.toFixed(2),
        esi.employerAmount.toFixed(2),
        esi.totalAmount.toFixed(2),
      ]);
      totalAmount = round2(totalAmount + esi.totalAmount);
      included += 1;
    }

    const fileContent = generateCsv(
      ['IP Number', 'IP Name', 'No of Days Paid', 'Total Monthly Wages', 'Employee Contribution', 'Employer Contribution', 'Total Contribution'],
      csvRows,
    );

    return this.persist({
      filingType: 'ESI_RETURN',
      scheme: 'ESI',
      frequency: 'MONTHLY',
      monthKey,
      quarter: null,
      stateCode: null,
      registrationType: 'ESI',
      dueDate: await this.configDueDate('ESI', monthKey),
      employeeCount: included,
      totalAmount,
      fileName: `ESI_${monthKey}.csv`,
      fileContent,
      fileFormat: 'CSV',
      items,
      userId,
      remarks: `ESIC contribution statement for ${monthKey}. ${included} of ${items.length} insured persons included.`,
    });
  }

  // =========================================================================
  // Professional tax and labour welfare fund
  // =========================================================================

  async generatePtReturn(monthKey: string, stateCode: string, userId: number): Promise<FilingGenerationResult> {
    this.assertMonthKey(monthKey);
    const state = String(stateCode ?? '').toUpperCase();
    if (!state) throw new Error('stateCode is required for a professional tax return');

    const rows = await this.contributions.findContributionsForMonth(monthKey, ['PT'], state);
    if (rows.length === 0) throw new Error(`No professional tax contributions were found for ${state} ${monthKey}`);

    const items: FilingItemInput[] = [];
    const csvRows: unknown[][] = [];
    let totalAmount = 0;

    for (const row of rows) {
      const zero = row.employeeAmount <= 0;
      items.push({
        employeeId: row.employeeId,
        identifier: row.employeeCode ?? null,
        wageBase: row.wageBase,
        employeeAmount: row.employeeAmount,
        employerAmount: 0,
        totalAmount: row.employeeAmount,
        ncpDays: row.ncpDays,
        extra: { stateCode: row.stateCode },
        validationStatus: zero ? 'ZERO_WAGE' : 'VALID',
        validationMessage: zero ? 'No professional tax was deducted' : null,
      });
      if (zero) continue;
      csvRows.push([
        row.employeeCode ?? '',
        row.employeeName ?? '',
        row.stateCode ?? state,
        row.wageBase.toFixed(2),
        row.employeeAmount.toFixed(2),
      ]);
      totalAmount = round2(totalAmount + row.employeeAmount);
    }

    const ruleDueDate = await this.stateDueDate('PT', state, monthKey);
    return this.persist({
      filingType: 'PT_RETURN',
      scheme: 'PT',
      frequency: 'MONTHLY',
      monthKey,
      quarter: null,
      stateCode: state,
      registrationType: 'PT',
      dueDate: ruleDueDate,
      employeeCount: csvRows.length,
      totalAmount,
      fileName: `PT_${state}_${monthKey}.csv`,
      fileContent: generateCsv(
        ['Employee Code', 'Employee Name', 'State', 'Monthly Gross', 'Professional Tax'],
        csvRows,
      ),
      fileFormat: 'CSV',
      items,
      userId,
      remarks: `Professional tax register for ${state} ${monthKey}.`,
    });
  }

  /** `period` is the `YYYY-MM` the fund is collected in (often June or December). */
  async generateLwfReturn(period: string, stateCode: string, userId: number): Promise<FilingGenerationResult> {
    this.assertMonthKey(period);
    const state = String(stateCode ?? '').toUpperCase();
    if (!state) throw new Error('stateCode is required for a labour welfare fund return');

    const rows = await this.contributions.findContributionsForMonth(period, ['LWF'], state);
    if (rows.length === 0) throw new Error(`No labour welfare fund contributions were found for ${state} ${period}`);

    const items: FilingItemInput[] = [];
    const csvRows: unknown[][] = [];
    let totalAmount = 0;

    for (const row of rows) {
      items.push({
        employeeId: row.employeeId,
        identifier: row.employeeCode ?? null,
        wageBase: row.wageBase,
        employeeAmount: row.employeeAmount,
        employerAmount: row.employerAmount,
        totalAmount: row.totalAmount,
        ncpDays: row.ncpDays,
        extra: { stateCode: row.stateCode },
        validationStatus: 'VALID',
        validationMessage: null,
      });
      csvRows.push([
        row.employeeCode ?? '',
        row.employeeName ?? '',
        row.stateCode ?? state,
        row.wageBase.toFixed(2),
        row.employeeAmount.toFixed(2),
        row.employerAmount.toFixed(2),
        row.totalAmount.toFixed(2),
      ]);
      totalAmount = round2(totalAmount + row.totalAmount);
    }

    return this.persist({
      filingType: 'LWF_RETURN',
      scheme: 'LWF',
      frequency: 'HALF_YEARLY',
      monthKey: period,
      quarter: null,
      stateCode: state,
      registrationType: 'LWF',
      dueDate: await this.stateDueDate('LWF', state, period),
      employeeCount: csvRows.length,
      totalAmount,
      fileName: `LWF_${state}_${period}.csv`,
      fileContent: generateCsv(
        ['Employee Code', 'Employee Name', 'State', 'Monthly Gross', 'Employee Contribution', 'Employer Contribution', 'Total'],
        csvRows,
      ),
      fileFormat: 'CSV',
      items,
      userId,
      remarks: `Labour welfare fund register for ${state} ${period}.`,
    });
  }

  // =========================================================================
  // TDS — Form 24Q
  // =========================================================================

  /**
   * Form 24Q Annexure I figures for a quarter: one row per employee per month.
   *
   * What this produces is the DATA, not a filed return. A 24Q is submitted as an
   * `.fvu` file produced by the Income Tax Department's own Return Preparation
   * Utility and validated by the File Validation Utility; those are versioned
   * binaries with a checksum scheme that cannot be reproduced faithfully here.
   * Writing something with a `.fvu` extension would be a forgery that the portal
   * would reject anyway, so the CSV below is meant to be keyed or imported into
   * the RPU.
   */
  async generate24Q(financialYear: string, quarter: number, userId: number): Promise<FilingGenerationResult> {
    if (!/^\d{4}-\d{4}$/.test(String(financialYear))) throw new Error('financialYear must look like 2026-2027');
    const q = Math.floor(num(quarter));
    if (q < 1 || q > 4) throw new Error('quarter must be 1, 2, 3 or 4');

    const months = quarterMonths(financialYear, q);
    const [details, tdsRows, tdsChallans] = await Promise.all([
      this.contributions.findSalaryLineDetails({ monthKeys: months }),
      this.contributions.findContributionsForMonth(months[0] as string, ['TDS'])
        .then(async (first) => {
          const rest = await Promise.all(months.slice(1).map((m) => this.contributions.findContributionsForMonth(m, ['TDS'])));
          return first.concat(...rest);
        }),
      this.repo.findChallans({ scheme: 'TDS', financialYear, limit: 500 }),
    ]);

    if (tdsRows.length === 0 && details.length === 0) {
      throw new Error(`No payroll data was found for ${financialYear} Q${q}`);
    }

    // A month's TDS counts as deposited only once its challan is actually paid.
    const challanByMonth = new Map<string, { paid: boolean; reference: string | null; paidOn: string | null }>();
    for (const challan of tdsChallans) {
      if (!challan.monthKey || !months.includes(challan.monthKey)) continue;
      if (challan.status === 'CANCELLED') continue;
      challanByMonth.set(challan.monthKey, {
        paid: challan.status === 'PAID' || challan.status === 'ACKNOWLEDGED',
        reference: challan.paymentReference ?? challan.challanNo,
        paidOn: challan.paidOn,
      });
    }

    const grossByKey = new Map<string, SalaryLineDetailRow>();
    for (const row of details) grossByKey.set(`${row.employeeId}:${row.monthKey}`, row);

    const items: FilingItemInput[] = [];
    const csvRows: unknown[][] = [];
    let totalAmount = 0;
    let included = 0;

    for (const row of tdsRows) {
      const detail = grossByKey.get(`${row.employeeId}:${row.monthKey}`);
      const amountPaid = detail ? detail.grossAmount : row.wageBase;
      const pan = detail?.pan ?? null;
      const challan = challanByMonth.get(row.monthKey) ?? null;
      const deposited = challan?.paid ? row.employeeAmount : 0;

      const missingPan = !isValidPan(pan);
      items.push({
        employeeId: row.employeeId,
        identifier: pan,
        wageBase: round2(amountPaid),
        employeeAmount: row.employeeAmount,
        employerAmount: 0,
        totalAmount: row.employeeAmount,
        ncpDays: 0,
        extra: {
          monthKey: row.monthKey,
          section: '192',
          tdsDeposited: deposited,
          challanReference: challan?.reference ?? null,
          depositDate: challan?.paidOn ?? null,
        },
        validationStatus: missingPan ? 'MISSING_PAN' : 'VALID',
        validationMessage: missingPan
          ? (pan ? `PAN "${pan}" is not a valid permanent account number` : 'No PAN on record; TDS must be deducted at the higher rate')
          : null,
      });

      if (missingPan) continue;

      csvRows.push([
        row.employeeCode ?? '',
        row.employeeName ?? '',
        pan ?? '',
        '192',
        row.monthKey,
        round2(amountPaid).toFixed(2),
        row.employeeAmount.toFixed(2),
        deposited.toFixed(2),
        challan?.reference ?? '',
        challan?.paidOn ?? '',
        this.monthEndDate(row.monthKey),
      ]);
      totalAmount = round2(totalAmount + row.employeeAmount);
      included += 1;
    }

    const fileContent = generateCsv(
      [
        'Employee Code', 'Employee Name', 'PAN', 'Section', 'Month', 'Amount Paid or Credited',
        'TDS Deducted', 'TDS Deposited', 'Challan Reference', 'Deposit Date', 'Date of Deduction',
      ],
      csvRows,
    );

    return this.persist({
      filingType: 'TDS_24Q',
      scheme: 'TDS',
      frequency: 'QUARTERLY',
      monthKey: null,
      quarter: q,
      stateCode: null,
      registrationType: 'TAN',
      dueDate: null,
      employeeCount: included,
      totalAmount,
      fileName: `24Q_${financialYear}_Q${q}.csv`,
      fileContent,
      fileFormat: 'CSV',
      items,
      userId,
      financialYear,
      remarks:
        `Form 24Q Annexure I figures for ${financialYear} Q${q}. These are the FIGURES only: the .fvu return must be `
        + 'prepared in the Income Tax Department RPU and validated with the FVU before submission.',
    });
  }

  // =========================================================================
  // Statutory registers
  // =========================================================================

  /**
   * Wage register, muster roll and the PF/ESI/PT registers, as CSV.
   *
   * Registers are records kept for inspection rather than returns submitted to
   * an authority, so no `regulatory_filings` row is created for them (the
   * table's unique key is one row per type/period and would collide across the
   * five register flavours). The file is still written to the upload directory.
   */
  async generateStatutoryRegister(type: string, params: RegisterParams): Promise<RegisterResult> {
    const registerType = String(type ?? '').toUpperCase();
    if (!REGISTER_TYPES.has(registerType)) {
      throw new Error(`Unknown register type "${type}"; expected one of ${Array.from(REGISTER_TYPES).join(', ')}`);
    }
    if (!params.periodId && !params.monthKey && !params.financialYear) {
      throw new Error('One of periodId, monthKey or financialYear is required');
    }

    const details = await this.contributions.findSalaryLineDetails({
      periodId: params.periodId,
      monthKeys: params.monthKey ? [params.monthKey] : undefined,
      financialYear: params.financialYear,
    });
    if (details.length === 0) throw new Error('No payroll data was found for the requested register');

    let headers: string[];
    let rows: unknown[][];

    switch (registerType) {
      case 'MUSTER_ROLL':
        headers = ['Employee Code', 'Employee Name', 'Department', 'Month', 'Period Days', 'Present Days', 'Paid Days', 'Absent Days', 'Leave Days', 'LOP Days', 'OT Hours'];
        rows = details.map((d) => [
          d.empCode, d.fullName, d.department ?? '', d.monthKey,
          d.periodDays, d.presentDays.toFixed(2), d.paidDays.toFixed(2),
          d.absentDays.toFixed(2), d.leaveDays.toFixed(2), d.lopDays.toFixed(2), d.otHours.toFixed(2),
        ]);
        break;

      case 'PF_REGISTER': {
        const contributions = await this.ledgerByEmployeeMonth(details, ['PF', 'EPS', 'EDLI', 'VPF']);
        headers = ['Employee Code', 'Employee Name', 'UAN', 'Month', 'EPF Wages', 'Employee Share', 'Employer PF', 'Pension (EPS)', 'EDLI', 'Admin Charges', 'VPF'];
        rows = details.map((d) => {
          const key = `${d.employeeId}:${d.monthKey}`;
          const pf = contributions.get(`${key}:PF`);
          const eps = contributions.get(`${key}:EPS`);
          const edli = contributions.get(`${key}:EDLI`);
          const vpf = contributions.get(`${key}:VPF`);
          return [
            d.empCode, d.fullName, d.uan ?? '', d.monthKey,
            (pf?.wageBase ?? 0).toFixed(2),
            (pf?.employeeAmount ?? 0).toFixed(2),
            (pf?.employerAmount ?? 0).toFixed(2),
            (eps?.employerAmount ?? 0).toFixed(2),
            (edli?.employerAmount ?? 0).toFixed(2),
            (pf?.adminCharges ?? 0).toFixed(2),
            (vpf?.employeeAmount ?? 0).toFixed(2),
          ];
        });
        break;
      }

      case 'ESI_REGISTER': {
        const contributions = await this.ledgerByEmployeeMonth(details, ['ESI']);
        headers = ['Employee Code', 'Employee Name', 'IP Number', 'Month', 'Paid Days', 'ESI Wages', 'Employee Share', 'Employer Share', 'Total'];
        rows = details.map((d) => {
          const esi = contributions.get(`${d.employeeId}:${d.monthKey}:ESI`);
          return [
            d.empCode, d.fullName, d.esiIpNumber ?? '', d.monthKey, d.paidDays.toFixed(2),
            (esi?.wageBase ?? 0).toFixed(2),
            (esi?.employeeAmount ?? 0).toFixed(2),
            (esi?.employerAmount ?? 0).toFixed(2),
            (esi?.totalAmount ?? 0).toFixed(2),
          ];
        });
        break;
      }

      case 'PT_REGISTER': {
        const contributions = await this.ledgerByEmployeeMonth(details, ['PT']);
        headers = ['Employee Code', 'Employee Name', 'Month', 'State', 'Monthly Gross', 'Professional Tax'];
        rows = details.map((d) => {
          const pt = contributions.get(`${d.employeeId}:${d.monthKey}:PT`);
          return [
            d.empCode, d.fullName, d.monthKey, pt?.stateCode ?? '',
            d.grossAmount.toFixed(2), (pt?.employeeAmount ?? 0).toFixed(2),
          ];
        });
        break;
      }

      case 'WAGE_REGISTER':
      default:
        headers = [
          'Employee Code', 'Employee Name', 'Department', 'Designation', 'Month', 'Period Days',
          'Paid Days', 'LOP Days', 'Piece Earnings', 'Fixed Earnings', 'Overtime', 'Bonus',
          'Gross Wages', 'PF', 'ESI', 'PT', 'LWF', 'Income Tax', 'Advance', 'Other Deductions',
          'Total Deductions', 'Net Payable', 'Bank', 'Account',
        ];
        rows = details.map((d) => [
          d.empCode, d.fullName, d.department ?? '', d.designation ?? '', d.monthKey,
          d.periodDays, d.paidDays.toFixed(2), d.lopDays.toFixed(2),
          d.earnPiece.toFixed(2), d.earnFixed.toFixed(2), d.earnOt.toFixed(2), d.earnBonus.toFixed(2),
          d.grossAmount.toFixed(2), d.dedPf.toFixed(2), d.dedEsi.toFixed(2), d.dedPt.toFixed(2),
          d.dedLwf.toFixed(2), d.dedIncomeTax.toFixed(2), d.dedAdvance.toFixed(2), d.dedOther.toFixed(2),
          d.totalDeductions.toFixed(2), d.netAmount.toFixed(2), d.bankName ?? '', d.bankAccount ?? '',
        ]);
        break;
    }

    const scope = params.periodId ? `period${params.periodId}` : (params.monthKey ?? params.financialYear ?? 'all');
    const fileName = `${registerType}_${scope}.csv`;
    const fileContent = generateCsv(headers, rows);
    const filePath = this.writeFile(fileName, fileContent);

    return {
      registerType,
      fileName,
      filePath,
      fileContent,
      rowCount: rows.length,
      note: 'Statutory registers are kept for inspection. They are not submitted to any authority, so no filing record is raised.',
    };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async markFiled(filingId: number, input: MarkFiledInput, userId: number): Promise<RegulatoryFiling> {
    const filing = await this.requireFiling(filingId);
    if (!input.filedOn) throw new Error('filedOn is required');

    await this.repo.updateFiling(
      filingId,
      {
        status: input.acknowledgementNo ? 'ACKNOWLEDGED' : 'FILED',
        filedOn: toDateString(input.filedOn),
        filedBy: userId,
        acknowledgementNo: input.acknowledgementNo ?? null,
        acknowledgedOn: input.acknowledgementNo ? toDateString(input.filedOn) : null,
      },
      userId,
    );
    await this.master.logAudit({
      entityType: 'REGULATORY_FILING',
      entityId: filingId,
      action: 'MARK_FILED',
      summary: `Recorded ${filing.filingType} ${filing.filingCode} as filed on the portal`,
      previousValue: filing.status,
      newValue: input.acknowledgementNo ? 'ACKNOWLEDGED' : 'FILED',
      actorUserId: userId,
    });
    return this.requireFiling(filingId);
  }

  async list(filters: FilingFilters): Promise<RegulatoryFiling[]> {
    return this.repo.findFilings(filters);
  }

  async get(filingId: number): Promise<{ filing: RegulatoryFiling; items: FilingItem[]; submissionMode: string; note: string }> {
    const filing = await this.requireFiling(filingId);
    const items = await this.repo.findFilingItems(filingId);
    return { filing, items, submissionMode: filing.submissionMode, note: MANUAL_NOTE };
  }

  async getOverdue(): Promise<RegulatoryFiling[]> {
    return this.repo.findOverdueFilings();
  }

  /** The stored file exactly as it was generated, for re-download. */
  async getFile(filingId: number): Promise<{ fileName: string; content: string; format: string }> {
    const filing = await this.requireFiling(filingId);
    if (!filing.filePath || !filing.fileName) throw new Error(`Filing ${filingId} has no generated file`);
    const resolved = this.resolveStoredPath(filing.filePath);
    if (!resolved) throw new Error(`The stored file for filing ${filingId} is no longer on disk`);
    return {
      fileName: filing.fileName,
      content: fs.readFileSync(resolved, 'utf8'),
      format: filing.fileFormat ?? 'TXT',
    };
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private assertMonthKey(monthKey: string): void {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey))) throw new Error('monthKey must look like 2026-07');
  }

  private monthEndDate(monthKey: string): string {
    const year = Number(monthKey.slice(0, 4));
    const month = Number(monthKey.slice(5, 7));
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${monthKey}-${String(last).padStart(2, '0')}`;
  }

  /** ECR names must not contain the delimiter or a line break. */
  private sanitiseName(name: string): string {
    return String(name).replace(/[#~\r\n]/g, ' ').trim().slice(0, 85);
  }

  private async requireFiling(filingId: number): Promise<RegulatoryFiling> {
    const filing = await this.repo.findFilingById(filingId);
    if (!filing) throw new Error(`Filing ${filingId} was not found`);
    return filing;
  }

  /** Group a month's contribution rows into one bundle per employee. */
  private async loadBundles(monthKey: string, schemes: any[]): Promise<EmployeeBundle[]> {
    const rows = await this.contributions.findContributionsForMonth(monthKey, schemes);
    const bundles = new Map<number, EmployeeBundle>();
    for (const row of rows) {
      const bundle = bundles.get(row.employeeId) ?? {
        employeeId: row.employeeId,
        empCode: row.employeeCode ?? String(row.employeeId),
        fullName: row.employeeName ?? '',
        uan: row.uan ?? null,
        esiIpNumber: row.esiIpNumber ?? null,
        ncpDays: row.ncpDays,
        paidDays: row.paidDays,
        rows: new Map<string, ContributionRecord>(),
      };
      bundle.rows.set(row.scheme, row);
      bundles.set(row.employeeId, bundle);
    }
    return Array.from(bundles.values()).sort((a, b) => a.empCode.localeCompare(b.empCode));
  }

  /** Gross pay per employee for a month, for the ECR's gross-wages column. */
  private async grossByEmployee(monthKey: string): Promise<Map<number, number>> {
    const details = await this.contributions.findSalaryLineDetails({ monthKeys: [monthKey] });
    const map = new Map<number, number>();
    for (const detail of details) {
      map.set(detail.employeeId, round2((map.get(detail.employeeId) ?? 0) + detail.grossAmount));
    }
    return map;
  }

  /** Ledger rows keyed `employeeId:monthKey:scheme`, for the registers. */
  private async ledgerByEmployeeMonth(
    details: SalaryLineDetailRow[],
    schemes: any[],
  ): Promise<Map<string, ContributionRecord>> {
    const months = Array.from(new Set(details.map((d) => d.monthKey)));
    const map = new Map<string, ContributionRecord>();
    for (const month of months) {
      const rows = await this.contributions.findContributionsForMonth(month, schemes);
      for (const row of rows) map.set(`${row.employeeId}:${row.monthKey}:${row.scheme}`, row);
    }
    return map;
  }

  private async configDueDate(scheme: 'PF' | 'ESI', monthKey: string): Promise<string | null> {
    const configs = await this.master.findConfigs(scheme);
    const cfg = resolveConfig(configs, scheme, `${monthKey}-28`);
    return cfg ? dueDateForMonth(monthKey, cfg.filing_due_day) : null;
  }

  private async stateDueDate(scheme: 'PT' | 'LWF', stateCode: string, monthKey: string): Promise<string | null> {
    const onDate = `${monthKey}-28`;
    if (scheme === 'PT') {
      const rules = await this.master.findPtRules(stateCode);
      const rule = resolveStateRule(rules, stateCode, onDate);
      return rule ? dueDateForMonth(monthKey, rule.filing_due_day) : null;
    }
    const rules = await this.master.findLwfRules(stateCode);
    const rule = resolveStateRule(rules, stateCode, onDate);
    return rule ? dueDateForMonth(monthKey, rule.filing_due_day) : null;
  }

  /**
   * Write the generated file into the upload directory.
   *
   * Mirrors `middleware/upload.ts`: the directory is created on demand and the
   * name is stripped of anything that could escape it.
   */
  private writeFile(fileName: string, content: string): string {
    if (!fs.existsSync(env.uploadDir)) fs.mkdirSync(env.uploadDir, { recursive: true });
    const safe = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const full = path.join(path.resolve(env.uploadDir), safe);
    fs.writeFileSync(full, content, 'utf8');
    return full;
  }

  /** Guard a stored path against reading anything outside the upload directory. */
  private resolveStoredPath(filePath: string): string | null {
    const base = path.resolve(env.uploadDir);
    const full = path.resolve(base, path.basename(filePath));
    if (!full.startsWith(base)) return null;
    return fs.existsSync(full) ? full : null;
  }

  /**
   * Create or refresh the filing row, replace its items and return the result.
   *
   * Regenerating is allowed until the return has been filed: after that the
   * stored file is what was submitted and must not be rewritten underneath the
   * acknowledgement.
   */
  private async persist(input: {
    filingType: string;
    scheme: string;
    frequency: string;
    monthKey: string | null;
    quarter: number | null;
    stateCode: string | null;
    registrationType: string;
    dueDate: string | null;
    employeeCount: number;
    totalAmount: number;
    fileName: string;
    fileContent: string;
    fileFormat: string;
    items: FilingItemInput[];
    userId: number;
    remarks: string;
    financialYear?: string;
  }): Promise<FilingGenerationResult> {
    const financialYear = input.financialYear
      ?? financialYearOf(input.monthKey ? `${input.monthKey}-28` : toDateString(new Date()));

    const existing = await this.repo.findFilingByKey(
      input.filingType,
      financialYear,
      input.monthKey,
      input.quarter,
      input.stateCode,
    );
    if (existing && (existing.status === 'FILED' || existing.status === 'ACKNOWLEDGED')) {
      throw new Error(
        `${input.filingType} for ${input.monthKey ?? `${financialYear} Q${input.quarter}`} has already been filed `
        + `(${existing.acknowledgementNo ?? existing.filedOn}); it cannot be regenerated`,
      );
    }

    const filePath = this.writeFile(input.fileName, input.fileContent);
    const period = input.monthKey ? await this.contributions.findPeriodByMonth(input.monthKey) : null;
    const registration = await this.master.findActiveRegistration(input.registrationType, input.stateCode);

    const suffix = input.monthKey ?? `Q${input.quarter}`;
    const record: FilingInsert = {
      filingCode: [input.filingType, financialYear, suffix, input.stateCode].filter(Boolean).join('-'),
      filingType: input.filingType,
      scheme: input.scheme,
      registrationId: registration ? registration.id : null,
      frequency: input.frequency,
      financialYear,
      monthKey: input.monthKey,
      quarter: input.quarter,
      periodId: period ? period.id : null,
      stateCode: input.stateCode,
      dueDate: input.dueDate,
      employeeCount: input.employeeCount,
      totalAmount: input.totalAmount,
      status: 'GENERATED',
      fileName: input.fileName,
      filePath,
      fileFormat: input.fileFormat,
      remarks: input.remarks.slice(0, 500),
    };

    const filingId = await this.repo.withTransaction(async (conn) => {
      let id: number;
      if (existing) {
        id = existing.id;
        await this.repo.refreshFiling(conn, id, record, input.userId);
        await this.repo.deleteFilingItems(conn, id);
      } else {
        id = await this.repo.insertFiling(conn, record, input.userId);
      }
      await this.repo.insertFilingItems(conn, id, input.items);
      return id;
    });

    const filing = await this.requireFiling(filingId);
    const invalidItems = await this.repo.findInvalidFilingItems(filingId);

    await this.master.logAudit({
      entityType: 'REGULATORY_FILING',
      entityId: filingId,
      periodId: period ? period.id : null,
      action: 'GENERATE',
      summary: `Generated ${input.filingType} ${filing.filingCode} for manual portal upload`,
      newValue: { employeeCount: input.employeeCount, totalAmount: input.totalAmount, excluded: invalidItems.length },
      actorUserId: input.userId,
    });

    return {
      filing,
      fileContent: input.fileContent,
      fileName: input.fileName,
      submissionMode: 'PORTAL_MANUAL',
      note: MANUAL_NOTE,
      includedCount: input.employeeCount,
      excludedCount: invalidItems.length,
      invalidItems,
    };
  }
}
