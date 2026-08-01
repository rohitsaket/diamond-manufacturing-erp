import { ShapeCategory, RateCardRow as RateCardRowType } from '../types';

export function computeLabourAmount(
  polishedWt: number | null | undefined,
  qty: number,
  shapeCategory: ShapeCategory,
  lab: string | null | undefined,
  rates: RateCardRowType[],
): number {
  if (!polishedWt || qty <= 0) return 0;

  const wtPerStone = polishedWt / qty;
  const targetLab = shapeCategory === 'BLOCKING' ? 'ANY' : (lab ?? 'IGI');

  const matchingRates = rates.filter((r) => {
    if (r.shape_category !== shapeCategory) return false;
    if (r.lab !== targetLab && r.lab !== 'ANY') return false;
    return r.cts_min <= wtPerStone && wtPerStone <= r.cts_max;
  });

  if (matchingRates.length === 0) return 0;

  matchingRates.sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime());
  const rate = matchingRates[0];

  return Math.round(polishedWt * rate.rate_per_ct);
}
