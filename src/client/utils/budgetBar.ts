import type { LoopAuthority } from '../../shared/api';

type Budget = LoopAuthority['budgets'][number];

/** The marks of one budget as shares of its bar's width, from 0 to 1. */
export interface BudgetBar {
  /** How much of the ceiling's scale is spent. */
  fill: number;
  /** Where the ceiling stands. One when nothing runs past it. */
  ceiling: number;
  /** Where the period lands at the pace so far. Absent when there is no pace. */
  lands?: number;
  /** The mark is pinned to the end of the bar: the figure is further out than the bar goes. */
  clipped: boolean;
}

/** How far past the ceiling a bar runs before it stops and lets the sentence carry the number. */
const MOST_PAST_CEILING = 2;

/**
 * Where the fill, the ceiling and the forecast tick sit on one budget's bar.
 *
 * The bar runs to the ceiling. When the pace carries the period past it, or the
 * spend already is past it, the bar runs on so the distance shows, up to twice
 * the ceiling; beyond that the mark is pinned to the end. Pure, so the layout
 * is tested apart from the page that draws it.
 */
export function budgetBar(b: Budget): BudgetBar {
  const ceiling = b.ceiling_dollars;
  if (!(ceiling > 0)) return { fill: 0, ceiling: 1, clipped: false };
  const lands = b.forecast?.lands_dollars;
  const reach = Math.max(b.spent_dollars, lands ?? 0);
  const scale = Math.min(Math.max(ceiling, reach), ceiling * MOST_PAST_CEILING);
  const share = (v: number) => Math.min(Math.max(v / scale, 0), 1);
  return {
    fill: share(b.spent_dollars),
    ceiling: ceiling / scale,
    lands: lands == null ? undefined : share(lands),
    clipped: reach > scale,
  };
}
