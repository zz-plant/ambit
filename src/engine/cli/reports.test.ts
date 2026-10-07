/**
 * `ambit status` as a person reads it.
 *
 * The report is data and `--json` prints it as data. What a terminal shows is
 * a rendering of that data, and these hold the rendering: the head says the two
 * numbers that matter and what is wrong, the evidence counts sit in one aligned
 * column with a marker on the one that wants a person, and the last line is the
 * one thing to type next. Colour is added on top and never changes a line.
 */
import { describe, expect, it, vi } from 'vitest';
import { learn, makeGraph, type CapabilityFixture } from '../testing/graph.ts';
import { asProcess } from '../testing/terminal.ts';
import { C, PLAIN } from './output.ts';
import {
  briefReport,
  explain,
  renderBrief,
  renderImpact,
  renderStatus,
  statusReport,
  worries,
} from './reports.ts';
import { analyzeImpact } from '../inference.ts';

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

/** The five evidence rows of a rendering, wherever they sit. */
const evidenceRows = (lines: string[]) =>
  lines.filter(l => /^( {4}| {2}› )(proven|unproven|failing|entries|last check) /.test(l));

/** A row up to the end of its value, leaving out what is said beside it. */
const cellsOf = (row: string) => row.match(/^( {4}| {2}› )\S+(?: \S+)? +\S+/)?.[0] ?? row;

/** A graph holding these nodes, with a declared check on each of `checked`. */
function graphWithChecks(capabilities: CapabilityFixture[], checked: string[]) {
  const db = makeGraph({ capabilities });
  const declare = db.prepare('INSERT INTO declared_checks (capability_id, command) VALUES (?, ?)');
  for (const id of checked) declare.run(id, 'true');
  return db;
}

describe('the head of the report', () => {
  it('leads with the two numbers that matter, then what is wrong', () => {
    const lines = renderStatus(reportOf(MIXED), PLAIN);
    expect(lines[0]).toBe('');
    expect(lines[1]).toBe('    3 of 4 reached · 1 proven · 1 failing');
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
      '    unproven        1  1 with no check',
      '  › failing         1',
      '    entries         0',
      '    last check  never',
    ]);
    // Aligned means every value ends in the same column, whatever is said beside it.
    expect(new Set(rows.map(r => cellsOf(r).length)).size).toBe(1);
  });

  // The head counted the config's own entries with the capabilities they
  // provide, and the rows under it counted only what carries a check, so the
  // README's example read "39 of 70 reached" over rows that summed to 15.
  it('add up to the reached figure in the head', () => {
    const db = makeGraph({
      capabilities: [
        { id: 'combo:a', name: 'Alpha', lifecycle: 'verified' },
        { id: 'combo:b', name: 'Beta', lifecycle: 'configured' },
        { id: 'combo:c', name: 'Gamma', lifecycle: 'broken' },
        { id: 'combo:d', name: 'Delta', lifecycle: 'degraded' },
        { id: 'combo:e', name: 'Epsilon', state: 'locked', lifecycle: 'unknown' },
        { id: 'mcp:git', name: 'git', kind: 'provider', category: 'mcp', lifecycle: 'unknown' },
        { id: 'provider:ollama', name: 'Ollama', kind: 'resource', lifecycle: 'unknown' },
        { id: 'runtime:opencode', name: 'OpenCode', kind: 'runtime', lifecycle: 'unknown' },
        // Not counted in the head, so not counted under it either.
        { id: 'act:a/x', name: 'x', kind: 'action', lifecycle: 'configured' },
        { id: 'cred:gh', name: 'GitHub token', kind: 'credential', lifecycle: 'unknown' },
        { id: 'human:pat', name: 'Pat', kind: 'actor', lifecycle: 'unknown' },
      ],
    });
    try {
      const report = statusReport(db);
      const ev = report.evidence[0];
      expect(ev).toMatchObject({ proven: 1, unproven: 2, failing: 1, entries: 3 });
      expect(ev.proven + ev.unproven + ev.failing + ev.entries).toBe(report.reached);

      const lines = renderStatus(report, PLAIN);
      const reached = Number(lines[1].match(/(\d+) of \d+ reached/)?.[1]);
      const rowSum = evidenceRows(lines)
        .filter(r => !r.includes('last check'))
        .reduce((sum, r) => sum + Number(cellsOf(r).match(/(\d+)$/)?.[1]), 0);
      expect(reached).toBe(7);
      expect(rowSum).toBe(reached);
      expect(evidenceRows(lines)).toContain(
        '    entries         3  from your config; checks run on what they provide'
      );

      // The domains are counted over the same nodes, so their totals add up too.
      const domains = report.domains as { total: number }[];
      expect(domains.reduce((sum, d) => sum + d.total, 0)).toBe(report.total);
    } finally {
      db.close();
    }
  });

  it('say how the unproven split, in parts that add up to it', () => {
    const db = graphWithChecks(
      [
        { id: 'skill:a', name: 'A', kind: 'provider', lifecycle: 'configured' },
        { id: 'skill:b', name: 'B', kind: 'provider', lifecycle: 'configured' },
        { id: 'combo:c', name: 'C', lifecycle: 'configured' },
        { id: 'skill:d', name: 'D', kind: 'provider', lifecycle: 'degraded' },
      ],
      ['skill:a', 'skill:b', 'skill:d']
    );
    try {
      const report = statusReport(db);
      expect(report.evidence[0]).toMatchObject({ unproven: 4, recovering: 1, no_check: 1 });
      expect(report.evidence[0].provable_now).toEqual(['A', 'B']);
      expect(evidenceRows(renderStatus(report, PLAIN))).toContain(
        '  › unproven        4  2 provable now · 1 recovering · 1 with no check'
      );
      // The last line counts the same two.
      expect(report.next).toEqual({
        command: 'ambit verify',
        why: 'turns 2 of the unproven into evidence',
      });
    } finally {
      db.close();
    }
  });

  // The list stopped at eight names under a last line that said eleven.
  it('list eight of what verify would check, and count the rest', () => {
    const ids = Array.from({ length: 11 }, (_, i) => `skill:s${String(i).padStart(2, '0')}`);
    const db = graphWithChecks(
      ids.map(id => ({ id, name: id.slice(6), kind: 'provider', lifecycle: 'configured' })),
      ids
    );
    try {
      const report = statusReport(db);
      expect(report.evidence[0].provable_now).toHaveLength(11);
      const text = renderStatus(report, PLAIN).join('\n');
      expect(text).toContain('provable now: s00, s01, s02, s03, s04, s05, s06, s07 and 3 more');
      expect(text).toContain('turns 11 of the unproven into evidence');
    } finally {
      db.close();
    }
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

describe('one count of what is failing', () => {
  // The head counted failing nodes of every kind but actions, the evidence row
  // counted only curated capabilities, and the degraded list and the last line
  // counted actions too, so one screen said three different numbers. Then the
  // head said "1 failing · 1 degraded" of one node.
  it('counts a registered skill failing its check in the head, the row and the last line', () => {
    const report = reportOf([
      { id: 'combo:a', name: 'Alpha', lifecycle: 'verified' },
      {
        id: 'skill:pdf',
        name: 'PDF tools',
        kind: 'provider',
        category: 'skill',
        lifecycle: 'broken',
      },
    ]);
    const lines = renderStatus(report, PLAIN);
    expect(lines[1]).toBe('    2 of 2 reached · 1 proven · 1 failing');
    expect(evidenceRows(lines).filter(r => r.includes('›'))).toEqual(['  › failing         1']);
    expect(report.next?.command).toBe('ambit verify skill:pdf');
  });

  it('reports failing actions through their capability, and names the capability', () => {
    const report = reportOf([
      { id: 'combo:shell-execution', name: 'Shell Execution', lifecycle: 'broken' },
      {
        id: 'act:shell-execution/install_package',
        name: 'install_package',
        kind: 'action',
        lifecycle: 'broken',
      },
      {
        id: 'act:shell-execution/run_command',
        name: 'run_command',
        kind: 'action',
        lifecycle: 'degraded',
      },
    ]);
    const lines = renderStatus(report, PLAIN);
    expect(lines[1]).toBe('    1 of 1 reached · 0 proven · 1 failing');
    expect(report.failing).toBe(1);
    expect(report.degraded?.map((d: { id: string }) => d.id)).toEqual(['combo:shell-execution']);
    expect(evidenceRows(lines)).toContain('  › failing         1');
    expect(report.next).toEqual({
      command: 'ambit verify shell-execution',
      why: 'Shell Execution is configured and failing its check',
    });
  });
});

describe('a capability recovering from a failed check', () => {
  // The latest check decides: its last run passed, so it is not failing and
  // nothing asks for a repair. Its record is mixed, so it is not proven.
  const recovering = () => {
    const db = makeGraph({
      capabilities: [
        { id: 'combo:a', name: 'Alpha', lifecycle: 'verified' },
        { id: 'combo:b', name: 'Beta', lifecycle: 'degraded' },
      ],
    });
    for (const action of ['verified', 'failed', 'failed', 'verified', 'failed', 'verified']) {
      learn(db, 'combo:b', action, { session: 'verify' });
    }
    try {
      return statusReport(db);
    } finally {
      db.close();
    }
  };

  it('is counted with the unproven, and nothing is failing', () => {
    const report = recovering();
    const lines = renderStatus(report, PLAIN);
    expect(lines[1]).toBe('    2 of 2 reached · 1 proven · nothing failing');
    expect(report.failing).toBe(0);
    expect(report.degraded).toBeUndefined();
    expect(evidenceRows(lines).filter(r => r.includes('›'))).toEqual([
      expect.stringMatching(/^ {2}› unproven +1 {2}1 recovering$/),
    ]);
    // Nothing to repair, so the report does not end on re-running its check.
    expect(report.next?.command ?? '').not.toContain('verify');
  });

  it('is named, with how many of its last five runs passed', () => {
    const report = recovering();
    expect(report.recovering).toEqual([
      { id: 'combo:b', name: 'Beta', recent: '2 of the last 5 passed' },
    ]);
    const text = renderStatus(report, PLAIN).join('\n');
    expect(text).toContain('recovering:');
    expect(text).toContain('2 of the last 5 passed');
  });
});

describe('what the head does not say', () => {
  it('follows beneath it as it always has been drawn', () => {
    const text = renderStatus(reportOf(MIXED), PLAIN).join('\n');
    expect(text).toContain('actions: 1/1 reached');
    expect(text).toContain('domains:');
    // The list keeps its key for scripts, and is labelled for a person.
    expect(text).toContain('not working:');
    expect(text).not.toContain('degraded:');
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
      { id: 'combo:b', name: 'Beta', lifecycle: 'broken' },
    ]);
    expect(report.next?.command).toBe('ambit verify --failing');
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

/**
 * `ambit help <term>`, the glossary this module also holds. It prints for
 * itself instead of returning lines, so it is read off the console.
 */
describe('the glossary', () => {
  const shown = (tty: boolean, noColor?: string) => {
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      lines.push(String(line ?? ''));
    });
    try {
      asProcess(tty, noColor, () => explain('frontier'));
    } finally {
      log.mockRestore();
    }
    return lines.join('\n');
  };

  it('is painted on a terminal and plain everywhere else, in the same words', () => {
    const terminal = shown(true);
    expect(terminal).toContain(ESC);
    const bare = shown(false);
    expect(bare).not.toContain(ESC);
    expect(bare).toContain('Where you see it');
    expect(shown(true, '1')).toBe(bare);
    expect(plain(terminal)).toBe(bare);
  });
});

describe('renderImpact', () => {
  // One server, A: Solo has no other provider, Search has two others that both
  // present one key, Mirror has one other with its own, and Extras takes A
  // only as an optional input. A's own key must not appear as something lost.
  const graph = () =>
    makeGraph({
      capabilities: [
        { id: 'combo:solo', name: 'Solo' },
        { id: 'combo:search', name: 'Search' },
        { id: 'combo:mirror', name: 'Mirror' },
        { id: 'combo:extras', name: 'Extras' },
        { id: 'mcp:a', name: 'A' },
        { id: 'mcp:b', name: 'B' },
        { id: 'mcp:c', name: 'C' },
        { id: 'mcp:d', name: 'D' },
        { id: 'cred:shared', name: 'Shared key', kind: 'credential', category: 'credential' },
      ],
      dependencies: [
        { from: 'mcp:a', to: 'combo:solo', kind: 'provides', hard: true },
        { from: 'mcp:a', to: 'combo:search', kind: 'provides' },
        { from: 'mcp:b', to: 'combo:search', kind: 'provides' },
        { from: 'mcp:c', to: 'combo:search', kind: 'provides' },
        { from: 'mcp:a', to: 'combo:mirror', kind: 'provides' },
        { from: 'mcp:d', to: 'combo:mirror', kind: 'provides' },
        { from: 'mcp:a', to: 'combo:extras', kind: 'requires', hard: false },
        { from: 'mcp:a', to: 'cred:shared', kind: 'uses' },
        { from: 'mcp:b', to: 'cred:shared', kind: 'uses' },
        { from: 'mcp:c', to: 'cred:shared', kind: 'uses' },
      ],
    });

  it('leads with what stops, then what survives on one key, on others, and loses an input', () => {
    const db = graph();
    const lines = renderImpact(analyzeImpact(db, 'mcp:a') as any, PLAIN);
    db.close();
    const text = lines.join('\n');
    expect(lines[1]).toBe('    If A went away');
    expect(text).toContain('  › Stops working  Solo');
    expect(text).toContain('Survives on one key  Search · every other provider uses Shared key');
    expect(text).toContain('Survives  Mirror (1 other provider)');
    expect(text).toContain('Loses an optional input  Extras');
    expect(text).not.toContain('Shared key,');
    expect(text.indexOf('Stops working')).toBeLessThan(text.indexOf('Survives'));
  });

  it('names what stops further down, and counts the actions it takes with it', () => {
    // Deploy requires Solo, so it stops with A two hops away; Push is an
    // action Solo confers. A dependent that is not working now has nothing to
    // lose and is not listed.
    const db = makeGraph({
      capabilities: [
        { id: 'mcp:a', name: 'A' },
        { id: 'combo:solo', name: 'Solo' },
        { id: 'combo:deploy', name: 'Deploy' },
        { id: 'combo:later', name: 'Later', state: 'locked' },
        { id: 'act:solo/push', name: 'push', kind: 'action' },
      ],
      dependencies: [
        { from: 'mcp:a', to: 'combo:solo', kind: 'provides', hard: true },
        { from: 'combo:solo', to: 'combo:deploy', hard: true },
        { from: 'combo:solo', to: 'combo:later', hard: true },
        { from: 'combo:solo', to: 'act:solo/push', kind: 'provides', hard: true },
      ],
    });
    const text = renderImpact(analyzeImpact(db, 'mcp:a') as any, PLAIN).join('\n');
    db.close();
    expect(text).toContain('› Stops working  Deploy, Solo · and the 1 action they confer');
    expect(text).not.toContain('Later');
  });

  it('says plainly when nothing depends on the node', () => {
    const db = graph();
    const text = renderImpact(analyzeImpact(db, 'mcp:d') as any, PLAIN).join('\n');
    db.close();
    expect(text).toContain('Nothing stops working.');
    expect(text).toContain('Survives  Mirror (1 other provider)');
  });

  it('answers for a credential with what revoking it ends, as ambit credentials does', () => {
    const db = graph();
    const text = renderImpact(analyzeImpact(db, 'cred:shared') as any, PLAIN).join('\n');
    db.close();
    // Solo's one provider and all three of Search's present the key, so both
    // end; Mirror keeps D, which does not.
    expect(text).toContain('If Shared key went away');
    expect(text).toContain('› Stops working  Solo, Search');
    expect(text).toContain('Survives  Mirror (1 other provider)');
  });

  it('leaves an unknown id to the generic error, with what it was probably meant to be', () => {
    const db = graph();
    const answer = analyzeImpact(db, 'mcp:aa') as any;
    db.close();
    expect(answer.error).toContain('No capability "mcp:aa"');
  });
});

describe('the short screen bare ambit shows', () => {
  // It said "ambit verify runs their checks" of every unproven capability,
  // and verify runs only the checks that are declared.
  const leanLine = (db: ReturnType<typeof makeGraph>) =>
    renderBrief(briefReport(db), PLAIN).find(l => l.includes('not yet proven'));

  it('says how many of the unproven verify would check when some declare none', () => {
    const db = graphWithChecks(
      [
        { id: 'skill:a', name: 'A', kind: 'provider', lifecycle: 'configured' },
        { id: 'combo:b', name: 'B', lifecycle: 'configured' },
      ],
      ['skill:a']
    );
    try {
      expect(leanLine(db)).toBe(
        '    2 configured and not yet proven · ambit verify checks 1 of them'
      );
    } finally {
      db.close();
    }
  });

  it('keeps the short form when every one has a check', () => {
    const db = graphWithChecks(
      [{ id: 'skill:a', name: 'A', kind: 'provider', lifecycle: 'configured' }],
      ['skill:a']
    );
    try {
      expect(leanLine(db)).toBe(
        '    1 configured and not yet proven · ambit verify runs their checks'
      );
    } finally {
      db.close();
    }
  });
});
