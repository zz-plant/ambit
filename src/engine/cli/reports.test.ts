/**
 * `ambit status` as a person reads it.
 *
 * The report is data and `--json` prints it as data. What a terminal shows is
 * a rendering of that data, and these hold the rendering: the head says the two
 * numbers that matter and what is wrong, the evidence counts sit in one aligned
 * column with a marker on the one that wants a person, and the last line is the
 * one thing to type next. Colour is added on top and never changes a line.
 */
import { describe, expect, it } from 'vitest';
import { makeGraph, type CapabilityFixture } from '../testing/graph.ts';
import { C, PLAIN } from './output.ts';
import { renderStatus, statusReport, worries } from './reports.ts';

/** The escape character, spelled out so no control character sits in the source. */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const plain = (s: string) => s.replace(ANSI, '');

/** A status report over a graph holding exactly these nodes. */
function reportOf(capabilities: CapabilityFixture[]) {
  const db = makeGraph({ capabilities });
  try {
    return statusReport(db);
  } finally {
    db.close();
  }
}

/** One capability in each lifecycle the evidence counts, plus one action and one unreached. */
const MIXED: CapabilityFixture[] = [
  { id: 'combo:a', name: 'Alpha', lifecycle: 'verified' },
  { id: 'combo:b', name: 'Beta', lifecycle: 'configured' },
  { id: 'combo:c', name: 'Gamma', lifecycle: 'broken' },
  { id: 'combo:d', name: 'Delta', state: 'locked', lifecycle: 'unknown' },
  { id: 'act:a/x', name: 'x', kind: 'action', lifecycle: 'configured' },
];

const ALL_PROVEN: CapabilityFixture[] = [
  { id: 'combo:a', name: 'Alpha', lifecycle: 'verified' },
  { id: 'combo:b', name: 'Beta', lifecycle: 'reliable' },
];

/** The four evidence rows of a rendering, wherever they sit. */
const evidenceRows = (lines: string[]) =>
  lines.filter(l => /^( {4}| {2}› )(proven|unproven|failing|last check) /.test(l));

describe('the head of the report', () => {
  it('leads with the two numbers that matter, then what is wrong', () => {
    const lines = renderStatus(reportOf(MIXED), PLAIN);
    expect(lines[0]).toBe('');
    expect(lines[1]).toBe('    3 of 4 reached · 1 proven · 1 failing · 1 degraded');
  });

  it('says so when nothing is wrong', () => {
    const lines = renderStatus(reportOf(ALL_PROVEN), PLAIN);
    expect(lines[1]).toBe('    2 of 2 reached · 2 proven · nothing failing');
  });

  it('takes its worries from the same place as the summary the data carries', () => {
    const report = reportOf(MIXED);
    const tail = worries(report).join(' · ');
    expect(tail).not.toBe('');
    expect(report.summary.endsWith(` · ${tail}`)).toBe(true);
    expect(renderStatus(report, PLAIN)[1].endsWith(` · ${tail}`)).toBe(true);
  });

  it('draws a rule as wide as the line it sits under', () => {
    const [, summary, rule] = renderStatus(reportOf(MIXED), PLAIN);
    expect(rule.trim()).toMatch(/^─+$/);
    expect(rule.trim().length).toBe(summary.trim().length);
  });
});

describe('the command it ends on', () => {
  const NASTY = 'skill:pdf-tools$(touch PWNED)';
  const lastLine = (lines: string[]) => plain(lines.filter(Boolean).at(-1) ?? '');

  it('quotes an id a shell would read as more than one word', () => {
    // The id of a registered skill is whatever its agent typed, and the line
    // is one a person is meant to paste.
    const last = lastLine(
      renderStatus(reportOf([{ id: NASTY, name: 'PDF tools', lifecycle: 'broken' }]), PLAIN)
    );
    expect(last).toContain(`ambit verify '${NASTY}'`);
    expect(last).not.toContain(`ambit verify ${NASTY}`);
  });

  it('leaves an ordinary id as it was', () => {
    const last = lastLine(renderStatus(reportOf(MIXED), PLAIN));
    expect(last).toContain('ambit verify c ');
  });
});

describe('the evidence counts', () => {
  it('read down one column, labels on the left and values on the right', () => {
    const rows = evidenceRows(renderStatus(reportOf(MIXED), PLAIN));
    expect(rows).toEqual([
      '    proven          1',
      '    unproven        1',
      '  › failing         1',
      '    last check  never',
    ]);
    // Aligned means every row ends in the same column, whatever it says.
    expect(new Set(rows.map(r => r.length)).size).toBe(1);
  });

  it('mark a failing check before an unproven one, since a repair comes first', () => {
    const marked = evidenceRows(renderStatus(reportOf(MIXED), PLAIN)).filter(r => r.includes('›'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('failing');
  });

  it('mark the unproven count when nothing fails', () => {
    const lines = renderStatus(
      reportOf([
        { id: 'combo:a', name: 'Alpha', lifecycle: 'verified' },
        { id: 'combo:b', name: 'Beta', lifecycle: 'configured' },
      ]),
      PLAIN
    );
    const marked = evidenceRows(lines).filter(r => r.includes('›'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('unproven');
  });

  it('mark nothing when there is nothing to act on', () => {
    expect(evidenceRows(renderStatus(reportOf(ALL_PROVEN), PLAIN)).join('\n')).not.toContain('›');
  });
});

describe('what the head does not say', () => {
  it('follows beneath it as it always has been drawn', () => {
    const text = renderStatus(reportOf(MIXED), PLAIN).join('\n');
    expect(text).toContain('actions: 1/1 reached');
    expect(text).toContain('domains:');
    expect(text).toContain('degraded:');
    expect(text).toContain('combo:c');
    // The scalars the head replaced are not printed twice.
    expect(text).not.toMatch(/^ {4}(reached|total|verified|failing|summary):/m);
  });
});

describe('the last line', () => {
  it('is the one thing to type next, straight from the report', () => {
    const report = reportOf(MIXED);
    expect(report.next).toEqual({
      command: 'ambit verify c',
      why: 'Gamma is configured and failing its check',
    });
    const lines = renderStatus(report, PLAIN);
    expect(lines.at(-1)).toBe('');
    expect(lines.at(-2)).toBe(
      '    Next  ambit verify c · Gamma is configured and failing its check'
    );
    // Set apart from the details above it.
    expect(lines.at(-3)).toBe('');
  });

  it('names how many are failing, and the first to look at', () => {
    const report = reportOf([
      { id: 'combo:a', name: 'Alpha', lifecycle: 'broken' },
      { id: 'combo:b', name: 'Beta', lifecycle: 'degraded' },
    ]);
    expect(report.next?.command).toBe('ambit verify a');
    expect(report.next?.why).toBe(
      '2 capabilities are configured and failing their check, starting with Alpha'
    );
  });

  it('is absent, and so is its line, when the report has nothing to suggest', () => {
    const report = reportOf(ALL_PROVEN);
    expect(report.next).toBeUndefined();
    const text = renderStatus(report, PLAIN).join('\n');
    expect(text).not.toContain('Next');
    expect(text).not.toContain('undefined');
  });
});

describe('colour', () => {
  it('adds to the lines and never changes them', () => {
    const report = reportOf(MIXED);
    const painted = renderStatus(report, C);
    expect(painted.some(l => l.includes(ESC))).toBe(true);
    expect(painted.map(plain)).toEqual(renderStatus(report, PLAIN));
  });

  it('is nowhere in the plain rendering', () => {
    expect(renderStatus(reportOf(MIXED), PLAIN).join('\n')).not.toContain(ESC);
  });

  it('puts the accent on the one row that wants a person and on Next, and nowhere else', () => {
    const accented = renderStatus(reportOf(MIXED), C)
      .filter(l => l.includes(C.accent))
      .map(plain);
    expect(accented).toEqual([
      '  › failing         1',
      '    Next  ambit verify c · Gamma is configured and failing its check',
    ]);
  });

  it('puts the accent on nothing when there is nothing to act on', () => {
    const painted = renderStatus(reportOf(ALL_PROVEN), C);
    expect(painted.some(l => l.includes(C.accent))).toBe(false);
  });
});
