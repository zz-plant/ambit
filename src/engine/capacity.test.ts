/**
 * `ambit graph capacity`: what is on the tailnet and in this machine, and
 * which online machines no manifest names. Driven through a fake runner, so
 * nothing here executes tailscale, sysctl or nvidia-smi.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { capacityReport, type Runner } from './capacity.ts';

const STATUS = JSON.stringify({
  BackendState: 'Running',
  Self: { HostName: 'studio', OS: 'macOS', Online: true, TailscaleIPs: ['100.64.0.1'] },
  Peer: {
    a: { HostName: 'Pi5', OS: 'linux', Online: true, TailscaleIPs: ['100.64.0.2'] },
    b: { HostName: 'gpu-box', OS: 'linux', Online: true, DNSName: 'gpu-box.tail.ts.net.' },
    c: { HostName: 'old-laptop', OS: 'windows', Online: false },
  },
});

const fake =
  (answers: Record<string, string | null>): Runner =>
  (cmd, args) =>
    answers[`${cmd} ${args.join(' ')}`] ?? null;

let dir: string | null = null;
afterEach(() => {
  delete process.env.INFRA_MANIFEST;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function manifest(devices: { id: string; name: string }[]) {
  dir = mkdtempSync(join(tmpdir(), 'ambit-capacity-'));
  const path = join(dir, 'infrastructure.json');
  writeFileSync(path, JSON.stringify({ devices }));
  process.env.INFRA_MANIFEST = path;
}

test('an online machine no manifest names is capacity the graph cannot count', () => {
  manifest([{ id: 'pi5', name: 'Raspberry Pi' }]);
  const report: any = capacityReport(
    fake({
      'tailscale status --json': STATUS,
      'sysctl -n machdep.cpu.brand_string': 'Apple M3 Max\n',
      'sysctl -n hw.memsize': String(64 * 2 ** 30),
    }),
    'darwin'
  );
  expect(report.this_machine).toEqual({
    name: 'studio',
    chip: 'Apple M3 Max',
    unified_memory_gb: 64,
  });
  expect(report.tailnet.online).toEqual(['Pi5 (linux)', 'gpu-box (linux)']);
  expect(report.tailnet.offline).toBe(1);
  // Pi5 matches the manifest's id; gpu-box is named nowhere.
  expect(report.not_in_manifest).toEqual(['gpu-box (linux)']);
  // Which machine, not where it is: no address leaves the report.
  expect(JSON.stringify(report)).not.toMatch(/100\.64|ts\.net/);
});

test('with no tailscale and no manifest, each absence is said', () => {
  manifest([]);
  const report: any = capacityReport(
    fake({
      'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits':
        'NVIDIA RTX 4090, 24564\n',
    }),
    'linux'
  );
  expect(report.tailnet.note).toContain('not installed here, or not running');
  expect(report.manifest.note).toContain('counts no machine');
  expect(report.this_machine.gpus).toEqual([{ name: 'NVIDIA RTX 4090', vram_gb: 24 }]);
  expect(report.not_in_manifest).toBeUndefined();
});

test('a stopped tailscale daemon is not a tailnet with nobody on it', () => {
  const report: any = capacityReport(
    fake({ 'tailscale status --json': JSON.stringify({ BackendState: 'Stopped', Peer: {} }) }),
    'linux'
  );
  expect(report.tailnet.note).toBeDefined();
  expect(report.tailnet.online).toBeUndefined();
});
