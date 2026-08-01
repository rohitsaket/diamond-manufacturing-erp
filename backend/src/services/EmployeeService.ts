import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { LotRepository } from '../repositories/LotRepository';

export class EmployeeService {
  private empRepo = new EmployeeRepository();
  private lotRepo = new LotRepository();

  async findAll(search?: string, workStatus?: string) {
    return this.empRepo.findAll(search, workStatus);
  }

  async findById(id: number) {
    return this.empRepo.findById(id);
  }

  async getEmployeeLots(employeeId: number) {
    const { rows } = await this.lotRepo.findAll({ employeeId, limit: 100 });
    return rows;
  }
}
