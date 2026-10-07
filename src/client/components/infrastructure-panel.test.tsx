/**
 * The infrastructure table: a live reading, and what an agent may do on each
 * machine in it.
 *
 * The tab listed devices with a status and no answer to the question a person
 * has about a machine, which is what an agent is allowed to do there. That
 * answer is the gate's with the machine as the target, so it differs between
 * machines only where a grant is scoped to one. And the times on it are two,
 * kept apart: Probed is how old the reading in front of you is, computed now,
 * and Last seen is the last answer a typed `ambit incidents` got, read from the
 * graph and shown as its age, so a machine that has gone quiet reads as old
 * and never as probed just now.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import type { InfrastructureScanResponse, MachineModes } from '../../shared/api';
import { InfrastructurePanel } from './EnvironmentPanels';

afterEach(() => {
  vi.useRealTimers();
});

const SCANNED = Date.parse('2026-09-29T10:00:00.000Z');
const clockAt = (offsetMs: number) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SCANNED + offsetMs);
};

const machine = (
  id: string,
  said: {
    read?: 'ALLOW' | 'CONFIRM' | 'DENY';
    run: 'ALLOW' | 'CONFIRM' | 'DENY';
    install: 'ALLOW' | 'CONFIRM' | 'DENY';
  }
): MachineModes => ({
  id,
  target: `device:${id}`,
  actions: [
    {
      id: 'act:shell-execution/install_package',
      name: 'install_package',
      decision: said.install,
      reason: `install on ${id}`,
    },
    {
      id: 'act:shell-execution/read_output',
      name: 'read_output',
      decision: said.read ?? 'ALLOW',
      reason: 'reads are free',
    },
    {
      id: 'act:shell-execution/run_command',
      name: 'run_command',
      decision: said.run,
      reason: `run on ${id}`,
    },
  ],
});

const scan = (over: Partial<InfrastructureScanResponse> = {}): InfrastructureScanResponse => ({
  generatedAt: new Date(SCANNED).toISOString(),
  source: 'infrastructure.json',
  nodes: [
    { id: 'nuc', name: 'NUC', kind: 'device', status: 'online', description: 'Host NUC' },
    {
      id: 'gpu-box',
      name: 'GPU box',
      kind: 'device',
      status: 'offline',
      description: 'Host GPU box',
    },
    {
      id: 'svc:ollama',
      name: 'Ollama',
      kind: 'service',
      status: 'online',
      description: 'Service ollama',
    },
  ],
  links: [],
  findings: [],
  summary: { online: 2, degraded: 0, offline: 1, unknown: 0 },
  machines: [
    machine('nuc', { run: 'CONFIRM', install: 'CONFIRM' }),
    machine('gpu-box', { run: 'ALLOW', install: 'DENY' }),
  ],
  ...over,
});

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const rows = (html: string) => html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
const rowOf = (html: string, name: string) =>
  text(rows(html).find(r => r.includes(`>${name}<`)) ?? '');

test('a manifest with two machines shows each with its modes', () => {
  clockAt(1000);
  const html = renderToStaticMarkup(<InfrastructurePanel scan={scan()} />);

  expect(rowOf(html, 'NUC')).toContain('read output without asking');
  expect(rowOf(html, 'NUC')).toContain('run command asks first');
  expect(rowOf(html, 'NUC')).toContain('install package asks first');
  // The other machine differs where a grant is scoped to it.
  expect(rowOf(html, 'GPU box')).toContain('run command without asking');
  expect(rowOf(html, 'GPU box')).toContain('install package refused');
});

test('each mode carries the gate’s reason, so a refusal says which kind', () => {
  clockAt(1000);
  const html = renderToStaticMarkup(<InfrastructurePanel scan={scan()} />);
  expect(html).toContain('title="install on gpu-box"');
  expect(html).toContain('infra-mode infra-mode--deny');
});

test('a service is not a machine, and is not asked', () => {
  clockAt(1000);
  const html = renderToStaticMarkup(<InfrastructurePanel scan={scan()} />);
  const service = rowOf(html, 'Ollama');
  expect(service).toContain('online');
  expect(service).not.toContain('without asking');
  expect(service).toMatch(/—\s*$/);
});

test('a reading taken just now says so', () => {
  clockAt(2000);
  const said = text(renderToStaticMarkup(<InfrastructurePanel scan={scan()} />));
  expect(said).toContain('Probed just now.');
  expect(rowOf(renderToStaticMarkup(<InfrastructurePanel scan={scan()} />), 'NUC')).toContain(
    'just now'
  );
});

test('an older reading never says just now: it says how old it is', () => {
  clockAt(12 * 60_000);
  const html = renderToStaticMarkup(<InfrastructurePanel scan={scan()} />);
  expect(text(html)).toContain('Probed 12 minutes ago.');
  expect(rowOf(html, 'NUC')).toContain('12 minutes ago');
  expect(html).not.toContain('just now');
});

test('a row the scan had nothing to probe says so, and is never probed just now', () => {
  clockAt(1000);
  const html = renderToStaticMarkup(
    <InfrastructurePanel
      scan={scan({
        nodes: [
          { id: 'nuc', name: 'NUC', kind: 'device', status: 'unknown', description: 'Host NUC' },
        ],
        summary: { online: 0, degraded: 0, offline: 0, unknown: 1 },
      })}
    />
  );
  expect(rowOf(html, 'NUC')).toContain('not probed');
  expect(rowOf(html, 'NUC')).not.toContain('just now');
});

test('a server that predates the modes still draws the table, with none to state', () => {
  clockAt(1000);
  const html = renderToStaticMarkup(<InfrastructurePanel scan={scan({ machines: undefined })} />);
  expect(html).toContain('infra-table');
  expect(html).not.toContain('infra-mode');
  expect(rowOf(html, 'NUC')).toMatch(/—\s*$/);
});

test('a time that will not read is left out, never printed', () => {
  const html = renderToStaticMarkup(
    <InfrastructurePanel scan={scan({ generatedAt: 'not a time' })} />
  );
  for (const marker of ['undefined', 'NaN', 'Invalid Date', 'null']) {
    expect(html.includes(marker), `rendered "${marker}"`).toBe(false);
  }
  // The column is still there; the sentence about when is not.
  expect(text(html)).not.toMatch(/unknown\.\s*Probed/);
  expect(rowOf(html, 'NUC')).toMatch(/online\s+NUC\s+device · Host NUC\s+—\s/);
});

test('last seen is the age of the last answer a probe recorded, and a dash where none did', () => {
  clockAt(1000);
  const html = renderToStaticMarkup(
    <InfrastructurePanel
      scan={scan({
        recorded: [
          // SQLite's own form: UTC with no zone, an hour before the scan.
          { id: 'nuc', lastSeenAt: '2026-09-29 09:00:00' },
          { id: 'gpu-box', lastSeenAt: '2026-09-26 10:00:00' },
        ],
      })}
    />
  );
  expect(rowOf(html, 'NUC')).toContain('just now 1 hour ago');
  expect(html).toContain('<time dateTime="2026-09-29T09:00:00.000Z">1 hour ago</time>');
  // Probed just now and quiet for three days: the two never read as one.
  expect(rowOf(html, 'GPU box')).toContain('just now 3 days ago');
  // Nothing recorded for the service: the slot is kept, and holds a dash.
  expect(rowOf(html, 'Ollama')).toMatch(/just now\s+—\s+—\s*$/);
  expect(text(html)).toContain('Last seen is the last answer ambit incidents got.');
});

test('the manifest’s tags sit under the name, and a row with none has no list', () => {
  clockAt(1000);
  const html = renderToStaticMarkup(
    <InfrastructurePanel scan={scan({ recorded: [{ id: 'nuc', tags: ['gpu', 'always-on'] }] })} />
  );
  expect(rowOf(html, 'NUC')).toContain('device · Host NUC gpu always-on');
  expect(html).toContain('aria-label="Tags on NUC"');
  expect(html.match(/infra-tags/g)).toHaveLength(1);
  // Tags without a time: the time is still a dash, never "never".
  expect(rowOf(html, 'NUC')).toMatch(/just now\s+—/);
  expect(html).not.toContain('never');
});

test('a last seen that will not read is a dash, never printed', () => {
  clockAt(1000);
  const html = renderToStaticMarkup(
    <InfrastructurePanel scan={scan({ recorded: [{ id: 'nuc', lastSeenAt: 'not a time' }] })} />
  );
  for (const marker of ['undefined', 'NaN', 'Invalid Date', 'not a time']) {
    expect(html.includes(marker), `rendered "${marker}"`).toBe(false);
  }
  expect(rowOf(html, 'NUC')).toMatch(/just now\s+—/);
});

test('the reading can be taken again, and the button is there only where something can answer it', () => {
  clockAt(1000);
  expect(renderToStaticMarkup(<InfrastructurePanel scan={scan()} onProbe={() => {}} />)).toContain(
    'Probe again'
  );
  expect(renderToStaticMarkup(<InfrastructurePanel scan={scan()} />)).not.toContain('Probe again');
});

test('no manifest and no engine is a note, and a scan in flight says so', () => {
  const empty = renderToStaticMarkup(
    <InfrastructurePanel
      scan={scan({
        nodes: [],
        machines: [],
        summary: { online: 0, degraded: 0, offline: 0, unknown: 0 },
      })}
    />
  );
  expect(text(empty)).toContain('No manifest at');
  expect(text(renderToStaticMarkup(<InfrastructurePanel scan={null} />))).toContain(
    'Probing the hosts'
  );
});
