import { RateCardRepository } from '../repositories/RateCardRepository';

export class RateCardService {
  private rateCardRepo = new RateCardRepository();

  async getAll(shapeCategory?: string) {
    return this.rateCardRepo.findAll(shapeCategory);
  }

  async getById(id: number) {
    return this.rateCardRepo.findById(id);
  }

  async updateRate(id: number, newRate: number, actor: string, userId: number) {
    const old = await this.rateCardRepo.findById(id);
    if (!old) throw new Error('Rate card row not found');

    const updated = await this.rateCardRepo.updateRate(id, newRate, userId);

    const changeType = newRate > old.ratePerCt ? 'increase' : 'decrease';
    const cat = old.shapeCategory === 'ROUND' ? 'Round' : old.shapeCategory === 'FANCY' ? 'Fancy' : 'Blocking';
    const lab = old.lab === 'ANY' ? 'ANY' : old.lab;
    const changeDesc = `${cat} / ${lab} / ${old.ctsMin}–${old.ctsMax} ct: ₹${old.ratePerCt} → ₹${newRate}`;

    await this.rateCardRepo.addAuditLog({
      rateCardRowId: id,
      actor,
      changeDescription: changeDesc,
      changeType,
      oldRate: old.ratePerCt,
      newRate,
    });

    return updated;
  }

  async newVersion(effectiveFrom: string, userId: number, actor: string) {
    await this.rateCardRepo.cloneVersion(effectiveFrom, userId);
    await this.rateCardRepo.addAuditLog({
      rateCardRowId: null,
      actor,
      changeDescription: `New rate card version created effective ${effectiveFrom}`,
      changeType: 'bulk',
      oldRate: null,
      newRate: null,
    });
  }

  async getLatestEffectiveDate() {
    return this.rateCardRepo.getLatestEffectiveDate();
  }

  async getAuditLogs() {
    return this.rateCardRepo.getAuditLogs();
  }

  async computeImpact(changedId: number, newRate: number) {
    return this.rateCardRepo.computeImpact(changedId, newRate);
  }
}
