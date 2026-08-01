import { SalaryPeriodRepository } from '../repositories/SalaryPeriodRepository';
import { SalaryLineRepository } from '../repositories/SalaryLineRepository';
import { generateCsv } from '../utils/csv';

export class PayrollService {
  private periodRepo = new SalaryPeriodRepository();
  private lineRepo = new SalaryLineRepository();

  async getPeriods() {
    return this.periodRepo.findAll();
  }

  async getOpenPeriod() {
    return this.periodRepo.findOpenPeriod();
  }

  async getPeriodLines(periodId: number) {
    return this.lineRepo.findByPeriod(periodId);
  }

  async lockPeriod(periodId: number, userId: number) {
    await this.periodRepo.lock(periodId, userId);
    return this.periodRepo.findById(periodId);
  }

  async markPaid(periodId: number, userId: number) {
    await this.periodRepo.markPaid(periodId, userId);
    return this.periodRepo.findById(periodId);
  }

  async managerVerify(lineId: number, userId: number) {
    await this.lineRepo.managerVerify(lineId, userId);
  }

  async managerUnverify(lineId: number) {
    await this.lineRepo.managerUnverify(lineId);
  }

  async accountVerify(lineId: number, userId: number) {
    const line = await this.lineRepo.findById(lineId);
    if (!line) throw new Error('Salary line not found');
    if (!line.manager_verified) throw new Error('Manager must verify first');
    await this.lineRepo.accountVerify(lineId, userId);
  }

  async accountUnverify(lineId: number) {
    await this.lineRepo.accountUnverify(lineId);
  }

  async createPeriod(data: { label: string; fromDate: string; toDate: string; createdBy: number }) {
    return this.periodRepo.create(data);
  }

  async exportCsv(periodId: number): Promise<string> {
    const lines = await this.lineRepo.findByPeriod(periodId);

    const headers = ['Worker', 'Code', 'Total Carats', 'Lots', 'Labour Amount (₹)', 'Mgr Verified', 'Acct Verified', 'Paid At'];
    const data = lines.map((l) => [
      l.employeeName,
      l.empCode,
      l.totalCts,
      l.lotsCount,
      l.totalAmount,
      l.managerVerified ? 'Yes' : 'No',
      l.accountVerified ? 'Yes' : 'No',
      l.paidAt ?? '',
    ]);

    // Total row
    const totalCts = lines.reduce((s, l) => s + l.totalCts, 0);
    const totalAmt = lines.reduce((s, l) => s + l.totalAmount, 0);
    const totalLots = lines.reduce((s, l) => s + l.lotsCount, 0);
    data.push(['TOTAL', '', totalCts, totalLots, totalAmt, '', '', '']);

    return generateCsv(headers, data);
  }
}
