import { BaseRepository } from './BaseRepository';

export class ShapeRepository extends BaseRepository {
  async findAll(): Promise<{ id: number; name: string; shapeCategory: string }[]> {
    const rows = await this.query<any[]>(
      'SELECT id, name, shape_category FROM shapes ORDER BY shape_category, name',
    );
    return rows.map((r) => ({ id: r.id, name: r.name, shapeCategory: r.shape_category }));
  }
}
