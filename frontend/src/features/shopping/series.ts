import type { Listing } from '@/api/shopping';

/**
 * Categorical merchant slots, validated with the dataviz palette checks on the chart surface
 * (#0b1120, dark): lightness band, chroma, CVD ΔE ≥ 9.5, normal-vision ΔE ≥ 19.7, contrast ≥ 3:1.
 * Assigned in fixed order by merchant (the entity), never by price rank; a 6th+ merchant stays in
 * the comparison table instead of getting an invented hue.
 */
export const SERIES_COLORS = ['#4f7dff', '#d95926', '#1aa3bf', '#d55181', '#9085e9'] as const;

export interface Series {
  listingId: string;
  merchant: string;
  color: string;
}

/** Stable entity → color mapping: merchants sorted by name, first five charted. */
export function seriesFor(listings: Listing[]): Series[] {
  return [...listings]
    .sort((a, b) => a.merchant.name.localeCompare(b.merchant.name) || a.id.localeCompare(b.id))
    .slice(0, SERIES_COLORS.length)
    .map((l, i) => ({
      listingId: l.id,
      merchant: l.merchant.name,
      color: SERIES_COLORS[i] ?? '#9aa5c7',
    }));
}
