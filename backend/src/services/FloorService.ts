import { LotRepository } from '../repositories/LotRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { LabourHeadRepository } from '../repositories/LabourHeadRepository';
import { ShapeRepository } from '../repositories/ShapeRepository';
import { LotFilterParams } from '../types';

export class FloorService {
  private lotRepo = new LotRepository();
  private empRepo = new EmployeeRepository();
  private labourHeadRepo = new LabourHeadRepository();
  private shapeRepo = new ShapeRepository();

  async getLots(params: LotFilterParams) {
    return this.lotRepo.findAll(params);
  }

  async getExceptions() {
    return this.lotRepo.getExceptions();
  }

  async getWorkingEmployees() {
    return this.empRepo.findWorkingEmployees();
  }

  async getLabourHeads() {
    return this.labourHeadRepo.findAll();
  }

  async getShapes() {
    return this.shapeRepo.findAll();
  }

  async issueLot(data: {
    workerId: number;
    lotId: string;
    lotName: string;
    shape: string;
    shapeCategory: 'ROUND' | 'FANCY' | 'BLOCKING';
    qty: number;
    issueWt: number;
    estimateWt: number;
    issueDate?: string;
    lab: string;
    labourHeadId: number;
    createdBy: number;
  }) {
    return this.lotRepo.create({
      lotId: data.lotId,
      lotName: data.lotName,
      employeeId: data.workerId,
      shape: data.shape,
      shapeCategory: data.shapeCategory,
      qty: data.qty,
      issueWeight: data.issueWt,
      estimateWt: data.estimateWt,
      issueDate: data.issueDate,
      labourHeadId: data.labourHeadId,
      lab: data.lab || undefined,
      createdBy: data.createdBy,
    });
  }

  async receiveLot(id: number, data: {
    polishedWt: number;
    color?: string;
    clarity?: string;
    cut?: string;
    grader?: string;
    receivedDate: string;
    updatedBy: number;
  }) {
    return this.lotRepo.receive(id, data);
  }

  async verifyLot(id: number, updatedBy: number) {
    return this.lotRepo.verify(id, updatedBy);
  }

  async getMaxLotId() {
    return this.lotRepo.getMaxLotId();
  }
}
