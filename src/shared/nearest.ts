/**
 * The few names a mistyped one was probably meant to be.
 *
 * It suggests and never decides. An agent that is shown three candidates
 * spends one call choosing; an id guessed on its behalf can be the wrong
 * capability under a different grant, which is the worse mistake to make
 * quietly. Callers put the list in front of whoever asked and stop there.
 */

/** Lower case with everything but letters and digits removed, so `cap_id`, `capId` and `Cap-ID` are one word. */
export function squash(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Edit distance between two words, or `limit + 1` when it exceeds `limit`.
 *
 * A swap of two neighbouring letters counts as one edit, not two, because it is
 * the commonest way to mistype a word: `plna` for `plan` is one slip, and a
 * measure that scored it as two would refuse the suggestion a person would
 * make at a glance. Words here are tool and capability names, a few dozen
 * characters at most, so the whole table is filled and only the length gap is
 * short-circuited.
 */
export function editDistance(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const table: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    table[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        table[i][j] = j;
        continue;
      }
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, table[i - 2][j - 2] + 1);
      }
      table[i][j] = value;
    }
  }
  return Math.min(table[a.length][b.length], limit + 1);
}

/**
 * The options closest to `word`, best first.
 *
 * A word that contains, or is contained by, an option ranks ahead of one that
 * is merely a few edits away, because "shell" for `shell-execution` is a
 * narrower guess than "shel-exection" is. Comparison ignores case and
 * punctuation. Nothing comes back for a word that is far from everything: an
 * empty answer is the honest one when no option resembles the word.
 */
export function nearest(word: string, options: readonly string[], max = 3): string[] {
  const want = squash(word);
  if (!want) return [];
  const scored: { option: string; score: number }[] = [];
  for (const option of options) {
    const have = squash(option);
    if (!have) continue;
    let score: number;
    if (have === want) score = 0;
    // Three characters is the least that says anything: every word contains "a".
    else if (
      Math.min(have.length, want.length) >= 3 &&
      (have.includes(want) || want.includes(have))
    ) {
      score = 1 + Math.abs(have.length - want.length) / Math.max(have.length, want.length);
    } else {
      const limit = Math.min(3, Math.max(1, Math.floor(Math.max(have.length, want.length) / 4)));
      const distance = editDistance(want, have, limit);
      if (distance > limit) continue;
      score = 3 + distance;
    }
    scored.push({ option, score });
  }
  scored.sort(
    (x, y) =>
      x.score - y.score || x.option.length - y.option.length || x.option.localeCompare(y.option)
  );
  return scored.slice(0, max).map(s => s.option);
}
