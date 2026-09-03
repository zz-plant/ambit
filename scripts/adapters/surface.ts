#!/usr/bin/env bun
/**
 * Consumes a machine-readable capability surface — the export a runtime owns.
 *
 * §8's durable direction. The Hermes and Claude Code adapters read private
 * config files because no runtime publishes what it can do; that works and is
 * not the right contract. The right contract is an export the runtime owns,
 * in the shape `tt surface` emits. When a runtime publishes one, this consumes
 * it directly instead of parsing files — and because the shape is Ambit's own,
 * an Ambit graph can round-trip through it, which is how the contract gets
 * exercised before anyone else adopts it.
 *
 *   SURFACE=/path/to/surface.json node --experimental-strip-types scripts/adapters/surface.ts --seed
 *
 * The surface is vocabulary, not state: ids, kinds, edges, authority. State
 * (reached/locked) is not in it, because a runtime's export should describe
 * what it *can* be, not what this machine happens to have reached.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultMapping } from '../../src/engine/seed/writers.ts';

const path = process.env.SURFACE || process.argv[process.argv.indexOf('--path') + 1];
if (!path) {
  console.error('No surface. Set SURFACE=/path/to/surface.json (or pass --path).');
  process.exit(1);
}

let surface: any;
try {
  surface = JSON.parse(readFileSync(path, 'utf8'));
} catch (e: any) {
  console.error(`Cannot read surface at ${path}: ${e.message}`);
  process.exit(1);
}

if (!surface.schema_version || !Array.isArray(surface.capabilities)) {
  console.error(`${path} is not a capability surface. Run ambit surface to see the shape.`);
  process.exit(1);
}

// Translate the surface back into the config fragment the engine seeds from.
// A capability of provider kind becomes a config entry under the section its
// kind maps to; authority grants become the authority block; the runtime id
// attributes everything.
// No `agent` key: nothing in a surface produces one, so declaring it only
// meant the mapping below claimed to map something that was always empty.
const fragment: any = { mcp: {}, provider: {} };
const authority: any = {};

for (const cap of surface.capabilities) {
  const name = cap.id.includes(':') ? cap.id.slice(cap.id.indexOf(':') + 1) : cap.id;
  switch (cap.kind) {
    case 'provider':
      // An MCP server is the default thing a config file contains; a surface
      // provider without more information is treated as one.
      if (!fragment.mcp[name]) fragment.mcp[name] = { type: 'local', enabled: true };
      break;
    case 'resource':
      if (cap.domain === 'ai-ml' && !fragment.provider[name])
        fragment.provider[name] = { models: {} };
      break;
    case 'actor':
    case 'runtime':
    case 'capability':
    case 'action':
      // Curated model nodes and people are not "configured" — they are the
      // model itself, so the surface's statement about them is authority.
      break;
  }
}

for (const grant of surface.authority || []) {
  authority[grant.capability] = authority[grant.capability] || {};
  authority[grant.capability][grant.action] = grant.scope
    ? { mode: grant.mode, scope: grant.scope }
    : grant.mode;
}

const config = { mcp: fragment.mcp, provider: fragment.provider, authority };
const runtime = surface.runtime || 'surface';
const mapping = defaultMapping({ only: ['mcp', 'provider'], skillDirs: [] });

// Written only on the path that seeds. Printing the fragment used to leave a
// config file in TMPDIR that nothing would ever read or clean up.
if (!process.argv.includes('--seed')) {
  console.log(JSON.stringify(fragment, null, 2));
  process.exit(0);
}

const configPath = join(process.env.TMPDIR || '/tmp', `ambit-surface-${process.pid}.json`);
writeFileSync(configPath, JSON.stringify(config));

const engine = new URL('../../src/engine/engine.ts', import.meta.url).pathname;
const result = spawnSync('node', ['--experimental-sqlite', engine, 'seed'], {
  env: {
    ...process.env,
    OPENCODE_CONFIG: configPath,
    CONFIG_MAPPING: JSON.stringify(mapping),
    AMBIT_RUNTIME: runtime,
  },
  stdio: 'inherit',
});
console.log(
  `\nSurface "${runtime}" contributed ${Object.keys(fragment.mcp).length} providers · ${Object.keys(authority).length} authority grants`
);
process.exit(result.status || 0);
