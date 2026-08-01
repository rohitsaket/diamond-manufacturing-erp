import { BaseRepository } from './BaseRepository';
import { LabourHeadRow } from '../types';

export class LabourHeadRepository extends BaseRepository {
  async findAll(): Promise<{ id: number; code: string; name: string }[]> {
    const rows = await this.query<LabourHeadRow[]>(
      'SELECT id, code, name FROM labour_heads WHERE is_active = true ORDER BY id',
    );
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name }));
  }
}
