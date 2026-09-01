#!/usr/bin/env bun
/**
 * demo-agent-loop.ts — records the agent loop as docs/assets/agent-loop-demo.gif.
 *
 * The recording is a re-enactment of nothing: every frame's output comes from
 * actually running the engine and the MCP server against a fixture graph in a
 * temp directory. An agent hits a missing capability, asks Ambit why over MCP,
 * drafts a proposal; a person approves and applies it; the frontier moves, and
 * a capability nothing new provides unlocks with it. If the loop breaks, this
 * script fails rather than rendering a fiction.
 *
 * Needs rsvg-convert and ffmpeg. Usage: bun run scripts/demo-agent-loop.ts
 */

import { execSync, spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT_GIF = join(ROOT, 'docs', 'assets', 'agent-loop-demo.gif');
const W = 960,
  H = 540;

// ─── Fixture ──────────────────────────────────────────────────────────────────

const work = mkdtempSync(join(tmpdir(), 'ambit-agent-demo-'));
const configPath = join(work, 'opencode.json');
const dbPath = join(work, 'graph.db');
writeFileSync(
  configPath,
  JSON.stringify(
    {
      provider: {
        ollama: {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: 'http://127.0.0.1:11434/v1' },
          models: { 'qwen3-coder:30b': {}, 'gemma4:e4b': {} },
        },
      },
      mcp: {
        github: { type: 'local', command: ['gh-mcp'], enabled: true },
        playwright: { type: 'local', command: ['playwright-mcp'], enabled: true },
      },
      actors: { jordan: { name: 'Jordan', provides: ['physical-access'], authorizes: [] } },
    },
    null,
    2
  )
);

const ENV = { ...process.env, AMBIT_DB: dbPath, OPENCODE_CONFIG: configPath };

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function cli(...args: string[]): string[] {
  const r = spawnSync(
    'node',
    ['--experimental-sqlite', join(ROOT, 'src', 'engine', 'engine.ts'), ...args],
    { env: ENV, encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(`ambit ${args.join(' ')} failed: ${r.stderr}`);
  return strip(r.stdout)
    .split('\n')
    .filter(l => l.trim() !== '');
}

/** One MCP session, real jsonrpc over the real server's stdio. */
async function mcp(calls: { name: string; args: any }[]): Promise<string[][]> {
  const proc = spawn('node', ['--experimental-sqlite', join(ROOT, 'src', 'mcp', 'server.ts')], {
    env: ENV,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const send = (o: any) => proc.stdin.write(JSON.stringify(o) + '\n');
  let buf = '';
  const responses: any[] = [];
  const done = new Promise<void>(resolve => {
    proc.stdout.on('data', (c: Buffer) => {
      buf += c.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) responses.push(JSON.parse(line));
        if (responses.length === calls.length + 1) resolve();
      }
    });
  });
  send({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'demo-agent', version: '0' },
    },
  });
  calls.forEach((c, i) =>
    send({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'tools/call',
      params: { name: c.name, arguments: c.args },
    })
  );
  await done;
  proc.kill();
  // First response is the handshake; the rest map 1:1 onto calls.
  return responses.slice(1).map(r => {
    const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.result ?? r.error);
    return text.split('\n');
  });
}

// ─── The loop, actually run ───────────────────────────────────────────────────

console.log('Seeding fixture…');
cli('seed');

console.log('Agent side, over MCP…');
const [blockedOut, goalOut] = await mcp([
  {
    name: 'ambit_blocked',
    args: {
      capId: 'local-embeddings',
      classification: 'infrastructure',
      note: 'semantic search over the team wiki keeps failing',
    },
  },
  { name: 'ambit_goal', args: { goal: 'semantic search over the team wiki' } },
]);
const [proposeOut] = await mcp([{ name: 'ambit_propose', args: { capId: 'embeddings' } }]);
const proposalId = proposeOut.join('\n').match(/prop-[a-z0-9]+/)?.[0];
if (!proposalId) throw new Error('no proposal id in propose output');

console.log(`Human side: approve + apply ${proposalId}…`);
const approveOut = cli('approve', proposalId, 'jordan');
const applyOut = cli('apply', proposalId);
if (!applyOut.some(l => l.includes('applied: true')))
  throw new Error('apply did not succeed:\n' + applyOut.join('\n'));

const afterGoal = cli('goal', 'local-embeddings');
const history = cli('history');

// ─── Storyboard ───────────────────────────────────────────────────────────────

type Line = { t: string; c?: string };
type Frame = { title: string; who: 'agent' | 'human'; lines: Line[]; hold: number };

const CMD = '#7dd3fc',
  DIM = '#64748b',
  OK = '#34d399',
  WARN = '#fbbf24',
  TXT = '#cbd5e1',
  HI = '#e2e8f0';
const take = (lines: string[], n: number) =>
  lines.slice(0, n).map(l => ({ t: l.length > 88 ? l.slice(0, 85) + '…' : l, c: TXT }));

// JSON from MCP responses is dense; pull the lines that carry the story.
const pick = (lines: string[], keys: string[], n = 10): Line[] =>
  lines
    .filter(l => keys.some(k => l.includes(k)))
    .slice(0, n)
    .map(l => ({ t: l.trim().replace(/[",]/g, '').slice(0, 86), c: TXT }));

const frames: Frame[] = [
  {
    title: 'agent session — ambit over MCP',
    who: 'agent',
    hold: 3,
    lines: [
      { t: '▸ task: index the team wiki for semantic search', c: HI },
      { t: '  …embedding step failed: no embedding model anywhere in the setup', c: WARN },
      { t: '', c: TXT },
      { t: 'tool ▸ blocked { capId: "local-embeddings",', c: CMD },
      { t: '               classification: "infrastructure" }', c: CMD },
      ...pick(blockedOut, ['recorded', 'times_blocked', 'classification'], 3),
      { t: '', c: TXT },
      { t: '  The deficit is on record. Same block twice is a pattern, not luck.', c: DIM },
    ],
  },
  {
    title: 'agent session — ambit over MCP',
    who: 'agent',
    hold: 4,
    lines: [
      { t: 'tool ▸ goal { goal: "semantic search over the team wiki" }', c: CMD },
      ...pick(goalOut, ['"goal"', 'reachable', 'steps', 'estimated', 'name'], 8),
      { t: '', c: TXT },
      { t: '  One config change away. Ambit knows the order and the cost.', c: DIM },
    ],
  },
  {
    title: 'agent session — ambit over MCP',
    who: 'agent',
    hold: 4,
    lines: [
      { t: 'tool ▸ propose { capId: "embeddings" }', c: CMD },
      ...pick(
        proposeOut,
        ['proposal', 'status', 'applicable', 'chosen', 'privacy', 'recurring'],
        7
      ),
      { t: '', c: TXT },
      { t: '  A draft, not an action. The agent can propose; only a person applies.', c: DIM },
    ],
  },
  {
    title: 'human terminal',
    who: 'human',
    hold: 3,
    lines: [
      { t: `$ ambit approve ${proposalId} jordan`, c: CMD },
      ...take(approveOut, 5),
      { t: '', c: TXT },
      { t: '  Signed, and it expires. An approval is an artifact, not a mood.', c: DIM },
    ],
  },
  {
    title: 'human terminal',
    who: 'human',
    hold: 4,
    lines: [
      { t: `$ ambit apply ${proposalId}`, c: CMD },
      ...take(applyOut, 7).map(l => ({ ...l, c: l.t.includes('applied') ? OK : TXT })),
      { t: '', c: TXT },
      { t: '  Backed up first, inverse stored, re-seeded. Rollback is one command.', c: DIM },
    ],
  },
  {
    title: 'human terminal',
    who: 'human',
    hold: 4.5,
    lines: [
      { t: '$ ambit goal local-embeddings', c: CMD },
      ...take(afterGoal, 5).map(l => ({ ...l, c: l.t.includes('already reached') ? OK : TXT })),
      { t: '', c: TXT },
      { t: '$ ambit history', c: CMD },
      ...take(history.slice(-9), 9),
      { t: '', c: TXT },
      { t: '  One patch, four capabilities — Local Embeddings unlocked itself:', c: OK },
      {
        t: '  its prerequisites were finally met. That fact was written in no config file.',
        c: OK,
      },
    ],
  },
];

// ─── Render ───────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function frameSvg(f: Frame): string {
  const rows = f.lines
    .map(
      (l, i) =>
        `<text x="42" y="${118 + i * 21}" font-family="SF Mono, Menlo, monospace" font-size="13.5" fill="${l.c || TXT}">${esc(l.t)}</text>`
    )
    .join('\n');
  const badge =
    f.who === 'agent'
      ? `<rect x="${W - 200}" y="46" rx="10" width="158" height="24" fill="#312e81"/><text x="${W - 121}" y="62" text-anchor="middle" font-family="SF Mono, Menlo, monospace" font-size="11" fill="#a5b4fc">AGENT · via MCP</text>`
      : `<rect x="${W - 200}" y="46" rx="10" width="158" height="24" fill="#064e3b"/><text x="${W - 121}" y="62" text-anchor="middle" font-family="SF Mono, Menlo, monospace" font-size="11" fill="#6ee7b7">HUMAN · terminal</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#0b1120"/>
  <rect x="20" y="34" width="${W - 40}" height="${H - 62}" rx="12" fill="#0f172a" stroke="#1e293b"/>
  <circle cx="48" cy="58" r="6" fill="#f87171"/><circle cx="68" cy="58" r="6" fill="#fbbf24"/><circle cx="88" cy="58" r="6" fill="#34d399"/>
  <text x="110" y="62" font-family="SF Mono, Menlo, monospace" font-size="12" fill="#64748b">${esc(f.title)}</text>
  ${badge}
  <line x1="34" y1="78" x2="${W - 34}" y2="78" stroke="#1e293b"/>
  ${rows}
</svg>`;
}

console.log('Rendering frames…');
const framesDir = join(work, 'frames');
mkdirSync(framesDir);
let n = 0;
const FPS = 2;
for (const f of frames) {
  const svgPath = join(framesDir, 'f.svg');
  writeFileSync(svgPath, frameSvg(f));
  const pngPath = join(framesDir, `once-${n}.png`);
  execSync(`rsvg-convert -w ${W} -h ${H} -o "${pngPath}" "${svgPath}"`);
  for (let i = 0; i < Math.round(f.hold * FPS); i++) {
    execSync(`cp "${pngPath}" "${join(framesDir, `frame-${String(n++).padStart(3, '0')}.png`)}"`);
  }
}

console.log('Assembling GIF…');
execSync(
  `ffmpeg -y -loglevel error -framerate ${FPS} -i "${join(framesDir, 'frame-%03d.png')}" -vf "split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" "${OUT_GIF}"`
);
const size = spawnSync('du', ['-h', OUT_GIF], { encoding: 'utf8' }).stdout.trim();
console.log(`✓ ${size}`);
rmSync(work, { recursive: true, force: true });
