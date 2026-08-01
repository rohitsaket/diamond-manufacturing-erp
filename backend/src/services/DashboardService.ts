import { LotRepository } from '../repositories/LotRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';

export class DashboardService {
  private lotRepo = new LotRepository();
  private empRepo = new EmployeeRepository();

  async getKpis() {
    return this.lotRepo.getKpiData();
  }

  async getYieldTrend() {
    const months = [
      { month: 'Aug 2025', yield: 65.2, target: 68 },
      { month: 'Sep 2025', yield: 66.8, target: 68 },
      { month: 'Oct 2025', yield: 67.1, target: 68 },
      { month: 'Nov 2025', yield: 69.4, target: 68 },
      { month: 'Dec 2025', yield: 68.2, target: 68 },
      { month: 'Jan 2026', yield: 70.1, target: 68 },
      { month: 'Feb 2026', yield: 67.8, target: 68 },
      { month: 'Mar 2026', yield: 69.6, target: 68 },
      { month: 'Apr 2026', yield: 71.2, target: 68 },
      { month: 'May 2026', yield: 68.9, target: 68 },
      { month: 'Jun 2026', yield: 70.4, target: 68 },
      { month: 'Jul 2026', yield: 68.4, target: 68 },
    ];
    return months;
  }

  async getCaratFlow() {
    return [
      { name: 'Issued', value: 345.5, fill: '#6B7280' },
      { name: 'Polished', value: 236.4, fill: '#16A34A' },
      { name: 'Leakage', value: 89.6, fill: '#DC2626' },
      { name: 'Rework', value: 12.2, fill: '#CA8A04' },
      { name: 'Lost', value: 7.3, fill: '#9CA3AF' },
    ];
  }

  async getStatusDistribution() {
    return this.lotRepo.getStatusDistribution();
  }

  async getLeaderboard() {
    const employees = await this.empRepo.findWorkingEmployees();
    const leaderboard = [];

    for (const emp of employees) {
      if (emp.emp_code === 'MAXI') continue;
      const totalCts = await this.empRepo.getTotalCts(emp.id);
      const yieldPct = await this.empRepo.getYieldPct(emp.id);
      leaderboard.push({
        id: emp.id,
        name: emp.full_name,
        shortName: emp.short_name,
        yieldPct,
        totalCts,
        grade: emp.grade,
      });
    }

    return leaderboard
      .sort((a, b) => b.yieldPct - a.yieldPct)
      .slice(0, 6);
  }
}
