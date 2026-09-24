/**
 * The capacity this person owns that the graph cannot count yet.
 *
 * Roadmap §2 names two probes as unbuilt: the Tailscale daemon, and available
 * GPU memory. A machine reachable over the tailnet with memory to spare is
 * latent local inference, and the graph only counts the machines an
 * infrastructure manifest declares. This reads what is there and says which
 * online machines the manifest does not name.
 *
 * Read-only and local, and run only when a person types `ambit graph
 * capacity`: `tailscale status --json` asks the daemon on this machine,
 * `sysctl` and `nvidia-smi` read this machine's hardware, and nothing is sent
 * anywhere or written to the graph. A peer's hardware cannot be read from
 * here without logging in to it, so memory is reported for this machine only.
 * IPs and DNS names are left out; a name and an OS say which machine it is.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { infraManifestPath } from './paths.ts';

/** Runs a fixed command with no shell; null when it is missing or fails. */
export type Runner = (cmd: string, args: string[]) => string | null;

const run: Runner = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

/** Lowercase, and runs of anything else collapsed, so "Pi5" matches "pi5". */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

interface Peer {
  name: string;
  os: string;
  online: boolean;
}

function readTailnet(runner: Runner): { self?: Peer; peers: Peer[] } | null {
  const out = runner('tailscale', ['status', '--json']);
  if (!out) return null;
  let status: any;
  try {
    status = JSON.parse(out);
  } catch {
    return null;
  }
  if (status?.BackendState && status.BackendState !== 'Running') return null;
  const peer = (p: any): Peer => ({
    name: String(p?.HostName ?? ''),
    os: String(p?.OS ?? ''),
    online: Boolean(p?.Online),
  });
  return {
    self: status?.Self ? peer(status.Self) : undefined,
    peers: Object.values<any>(status?.Peer ?? {})
      .map(peer)
      .filter(p => p.name),
  };
}

function readThisMachine(runner: Runner, platform: string) {
  const gpus = (
    runner('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']) ?? ''
  )
    .split('\n')
    .map(line => line.split(',').map(s => s.trim()))
    .filter(([name, mib]) => name && Number(mib) > 0)
    .map(([name, mib]) => ({ name, vram_gb: Math.round(Number(mib) / 1024) }));
  if (platform === 'darwin') {
    // Apple silicon shares one pool between CPU and GPU, so the machine's
    // memory is what a local model can use, less what everything else holds.
    const chip = runner('sysctl', ['-n', 'machdep.cpu.brand_string'])?.trim();
    const bytes = Number(runner('sysctl', ['-n', 'hw.memsize'])?.trim());
    return {
      ...(chip ? { chip } : {}),
      ...(bytes > 0 ? { unified_memory_gb: Math.round(bytes / 2 ** 30) } : {}),
      ...(gpus.length ? { gpus } : {}),
    };
  }
  return gpus.length ? { gpus } : {};
}

function readManifestDevices(path: string): { id: string; name: string }[] {
  try {
    if (!existsSync(path)) return [];
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    return (manifest?.devices ?? []).map((d: any) => ({
      id: String(d?.id ?? ''),
      name: String(d?.name ?? d?.id ?? ''),
    }));
  } catch {
    return [];
  }
}

export function capacityReport(runner: Runner = run, platform: string = process.platform) {
  const manifestPath = infraManifestPath();
  const declared = readManifestDevices(manifestPath);
  const known = new Set(declared.flatMap(d => [slug(d.id), slug(d.name)]).filter(Boolean));
  const tailnet = readTailnet(runner);
  const machine = readThisMachine(runner, platform);

  const online = tailnet ? tailnet.peers.filter(p => p.online) : [];
  const undeclared = online.filter(p => !known.has(slug(p.name)));
  return {
    this_machine: {
      ...(tailnet?.self ? { name: tailnet.self.name } : {}),
      ...machine,
    },
    tailnet: tailnet
      ? {
          online: online.map(p => `${p.name} (${p.os})`),
          offline: tailnet.peers.length - online.length,
        }
      : { note: 'Tailscale is not installed here, or not running.' },
    manifest: {
      path: manifestPath,
      devices: declared.length,
      ...(declared.length ? {} : { note: 'No manifest, so the graph counts no machine.' }),
    },
    ...(undeclared.length
      ? {
          not_in_manifest: undeclared.map(p => `${p.name} (${p.os})`),
          next: `Online and on your tailnet, and named in no manifest, so no plan can count them. Add them as devices in ${manifestPath} and run ambit seed.`,
        }
      : {}),
  };
}
