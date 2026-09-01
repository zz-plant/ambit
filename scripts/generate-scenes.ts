#!/usr/bin/env bun
/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, no-empty */
/**
 * generate-scenes.ts — renders modern, high-production-value scene assets for Ambit.
 * Usage: node --experimental-strip-types scripts/generate-scenes.ts [--dry-run]
 */

import { writeFileSync, mkdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ASSETS_DIR = join(process.cwd(), 'docs', 'assets');
const PROJECT = 'ambit';

type SceneSpec = {
  width: number;
  height: number;
  minBytes: number;
  type: 'banner' | 'header' | 'square' | 'card' | 'badge' | 'favicon' | 'blur' | 'email';
};

const SCENES: Record<string, SceneSpec> = {
  badge: { width: 240, height: 96, minBytes: 2_000, type: 'badge' },
  blur: { width: 50, height: 28, minBytes: 300, type: 'blur' },
  card: { width: 400, height: 300, minBytes: 8_000, type: 'card' },
  circle: { width: 540, height: 540, minBytes: 8_000, type: 'square' },
  dark: { width: 960, height: 540, minBytes: 10_000, type: 'banner' },
  demo: { width: 720, height: 405, minBytes: 12_000, type: 'banner' },
  email: { width: 600, height: 200, minBytes: 5_000, type: 'email' },
  favicon: { width: 64, height: 64, minBytes: 600, type: 'favicon' },
  github: { width: 1280, height: 640, minBytes: 15_000, type: 'banner' },
  header: { width: 1920, height: 400, minBytes: 12_000, type: 'header' },
  mastodon: { width: 1200, height: 600, minBytes: 15_000, type: 'banner' },
  og: { width: 1200, height: 675, minBytes: 15_000, type: 'banner' },
  square: { width: 1080, height: 1080, minBytes: 15_000, type: 'square' },
  touch: { width: 360, height: 360, minBytes: 8_000, type: 'square' },
  unfurl: { width: 1200, height: 628, minBytes: 15_000, type: 'banner' },
};

function renderSvgForScene(_scene: string, spec: SceneSpec): string {
  const { width: w, height: h, type } = spec;

  // Shared gradients and filters
  const defs = `
    <defs>
      <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0b1120" />
        <stop offset="50%" stop-color="#090d16" />
        <stop offset="100%" stop-color="#040711" />
      </linearGradient>
      <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#6366f1" />
        <stop offset="50%" stop-color="#38bdf8" />
        <stop offset="100%" stop-color="#10b981" />
      </linearGradient>
      <linearGradient id="indigoGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#6366f1" />
        <stop offset="100%" stop-color="#4338ca" />
      </linearGradient>
      <linearGradient id="emeraldGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#10b981" />
        <stop offset="100%" stop-color="#047857" />
      </linearGradient>
      <linearGradient id="skyGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0ea5e9" />
        <stop offset="100%" stop-color="#0369a1" />
      </linearGradient>
      <linearGradient id="amberGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f59e0b" />
        <stop offset="100%" stop-color="#b45309" />
      </linearGradient>
      <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(30, 41, 59, 0.75)" />
        <stop offset="100%" stop-color="rgba(15, 23, 42, 0.85)" />
      </linearGradient>
      <radialGradient id="meshLight1" cx="30%" cy="20%" r="50%">
        <stop offset="0%" stop-color="rgba(99, 102, 241, 0.18)" />
        <stop offset="100%" stop-color="rgba(99, 102, 241, 0)" />
      </radialGradient>
      <radialGradient id="meshLight2" cx="80%" cy="80%" r="60%">
        <stop offset="0%" stop-color="rgba(14, 165, 233, 0.14)" />
        <stop offset="100%" stop-color="rgba(14, 165, 233, 0)" />
      </radialGradient>
    </defs>
  `;

  if (type === 'favicon') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 64 64">
      ${defs}
      <rect width="64" height="64" rx="14" fill="#090d16" />
      <rect width="64" height="64" rx="14" fill="url(#bgGrad)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />
      
      <!-- Connected Node Graph Icon -->
      <line x1="20" y1="44" x2="32" y2="22" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" />
      <line x1="44" y1="44" x2="32" y2="22" stroke="#0ea5e9" stroke-width="2.5" stroke-linecap="round" />
      <line x1="20" y1="44" x2="44" y2="44" stroke="#10b981" stroke-width="2" stroke-dasharray="3,2" stroke-linecap="round" />

      <circle cx="32" cy="22" r="7" fill="#1e293b" stroke="url(#brandGrad)" stroke-width="2.5" />
      <circle cx="32" cy="22" r="2.5" fill="#6366f1" />

      <circle cx="20" cy="44" r="5.5" fill="#1e293b" stroke="#6366f1" stroke-width="2" />
      <circle cx="20" cy="44" r="2" fill="#818cf8" />

      <circle cx="44" cy="44" r="5.5" fill="#1e293b" stroke="#10b981" stroke-width="2" />
      <circle cx="44" cy="44" r="2" fill="#34d399" />
    </svg>`;
  }

  if (type === 'blur') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 50 28">
      ${defs}
      <rect width="50" height="28" fill="#090d16" />
      <rect width="50" height="28" fill="url(#bgGrad)" />
      <circle cx="15" cy="14" r="6" fill="#6366f1" opacity="0.8" />
      <circle cx="35" cy="14" r="6" fill="#0ea5e9" opacity="0.8" />
    </svg>`;
  }

  if (type === 'badge') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 240 96">
      ${defs}
      <rect width="240" height="96" rx="10" fill="#090d16" />
      <rect width="240" height="96" rx="10" fill="url(#bgGrad)" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
      <rect width="240" height="96" fill="url(#meshLight1)" rx="10" />

      <circle cx="36" cy="48" r="16" fill="#1e293b" stroke="url(#brandGrad)" stroke-width="2" />
      <circle cx="36" cy="48" r="6" fill="#6366f1" />

      <text x="64" y="44" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="18" font-weight="700" fill="#f8fafc">Ambit</text>
      <text x="64" y="62" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="9.5" font-weight="500" fill="#94a3b8">Capability Graph for AI</text>
    </svg>`;
  }

  if (type === 'email') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 600 200">
      ${defs}
      <rect width="600" height="200" rx="12" fill="#090d16" />
      <rect width="600" height="200" rx="12" fill="url(#bgGrad)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
      <rect width="600" height="200" fill="url(#meshLight1)" rx="12" />

      <!-- Brand block -->
      <circle cx="64" cy="100" r="26" fill="#1e293b" stroke="url(#brandGrad)" stroke-width="2.5" />
      <circle cx="64" cy="100" r="9" fill="#6366f1" />

      <text x="110" y="92" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="28" font-weight="700" fill="#f8fafc" letter-spacing="-0.5">Ambit</text>
      <text x="110" y="118" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="13" font-weight="500" fill="#94a3b8">The capability tech tree &amp; meta-MCP server for AI agents</text>

      <!-- Badge -->
      <rect x="440" y="82" width="120" height="34" rx="17" fill="rgba(99,102,241,0.15)" stroke="#6366f1" stroke-width="1.2" />
      <text x="500" y="103" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="11.5" font-weight="600" fill="#c7d2fe">Verified State ✓</text>
    </svg>`;
  }

  if (type === 'header') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1920 400">
      ${defs}
      <rect width="1920" height="400" fill="#090d16" />
      <rect width="1920" height="400" fill="url(#bgGrad)" />
      <rect width="1920" height="400" fill="url(#meshLight1)" />
      <rect width="1920" height="400" fill="url(#meshLight2)" />

      <!-- Left Hero Typography -->
      <circle cx="160" cy="190" r="44" fill="#1e293b" stroke="url(#brandGrad)" stroke-width="3.5" />
      <circle cx="160" cy="190" r="16" fill="#6366f1" />

      <text x="240" y="180" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="52" font-weight="700" fill="#f8fafc" letter-spacing="-1">Ambit</text>
      <text x="240" y="224" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="20" font-weight="500" fill="#94a3b8">Autonomous System Safety, Blast Radius Auditing &amp; Capability Tech Tree</text>

      <!-- Right DAG Architecture Diagram -->
      <g transform="translate(1150, 110)">
        <line x1="80" y1="90" x2="220" y2="40" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" />
        <line x1="80" y1="90" x2="220" y2="140" stroke="#0ea5e9" stroke-width="2.5" stroke-linecap="round" />
        <line x1="220" y1="40" x2="380" y2="40" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" />
        <line x1="220" y1="140" x2="380" y2="140" stroke="#8b5cf6" stroke-width="2" stroke-dasharray="6,4" stroke-linecap="round" />
        <line x1="380" y1="40" x2="520" y2="90" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" />
        <line x1="380" y1="140" x2="520" y2="90" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" />

        <!-- Node 1: opencode-core -->
        <circle cx="80" cy="90" r="26" fill="#1e293b" stroke="#6366f1" stroke-width="2.5" />
        <text x="80" y="95" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="12" font-weight="700" fill="#f8fafc">Core</text>

        <!-- Node 2: mcp:github -->
        <circle cx="220" cy="40" r="24" fill="#1e293b" stroke="#0ea5e9" stroke-width="2.5" />
        <text x="220" y="45" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="11" font-weight="600" fill="#f8fafc">MCP</text>

        <!-- Node 3: agent:safety -->
        <circle cx="220" cy="140" r="24" fill="#1e293b" stroke="#8b5cf6" stroke-width="2.5" />
        <text x="220" y="145" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="11" font-weight="600" fill="#f8fafc">Agent</text>

        <!-- Node 4: verified check -->
        <circle cx="380" cy="40" r="24" fill="#1e293b" stroke="#10b981" stroke-width="2.5" />
        <text x="380" y="45" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="11" font-weight="600" fill="#34d399">Check ✓</text>

        <!-- Node 5: proposal -->
        <circle cx="380" cy="140" r="24" fill="#1e293b" stroke="#f59e0b" stroke-width="2.5" />
        <text x="380" y="145" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="11" font-weight="600" fill="#fbbf24">Gov</text>

        <!-- Node 6: goal -->
        <circle cx="520" cy="90" r="28" fill="#1e293b" stroke="url(#brandGrad)" stroke-width="3" />
        <text x="520" y="95" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="12" font-weight="700" fill="#f8fafc">Deploy</text>
      </g>
    </svg>`;
  }

  if (type === 'square') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1000 1000">
      ${defs}
      <rect width="1000" height="1000" fill="#090d16" />
      <rect width="1000" height="1000" fill="url(#bgGrad)" />
      <circle cx="500" cy="420" r="350" fill="url(#meshLight1)" />
      <circle cx="500" cy="650" r="300" fill="url(#meshLight2)" />

      <!-- Center Large Graph Emblem -->
      <g transform="translate(500, 380)">
        <line x1="-180" y1="80" x2="0" y2="-120" stroke="#6366f1" stroke-width="5" stroke-linecap="round" />
        <line x1="180" y1="80" x2="0" y2="-120" stroke="#0ea5e9" stroke-width="5" stroke-linecap="round" />
        <line x1="-180" y1="80" x2="180" y2="80" stroke="#10b981" stroke-width="4" stroke-dasharray="8,6" stroke-linecap="round" />
        
        <circle cx="0" cy="-120" r="65" fill="#1e293b" stroke="url(#brandGrad)" stroke-width="7" />
        <circle cx="0" cy="-120" r="24" fill="#6366f1" />

        <circle cx="-180" cy="80" r="50" fill="#1e293b" stroke="#6366f1" stroke-width="6" />
        <circle cx="-180" cy="80" r="18" fill="#818cf8" />

        <circle cx="180" cy="80" r="50" fill="#1e293b" stroke="#10b981" stroke-width="6" />
        <circle cx="180" cy="80" r="18" fill="#34d399" />
      </g>

      <text x="500" y="680" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="76" font-weight="800" fill="#f8fafc" letter-spacing="-2">Ambit</text>
      <text x="500" y="740" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="28" font-weight="500" fill="#94a3b8">Capability Tech Tree &amp; Meta-MCP Server</text>

      <g transform="translate(350, 800)">
        <rect width="300" height="52" rx="26" fill="rgba(99,102,241,0.15)" stroke="rgba(99,102,241,0.4)" stroke-width="2" />
        <text x="150" y="33" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="20" font-weight="600" fill="#c7d2fe">Autonomous AI Control</text>
      </g>
    </svg>`;
  }

  if (type === 'card') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 400 300">
      ${defs}
      <rect width="400" height="300" rx="16" fill="#090d16" />
      <rect width="400" height="300" rx="16" fill="url(#bgGrad)" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
      <rect width="400" height="300" fill="url(#meshLight1)" rx="16" />

      <g transform="translate(200, 110)">
        <line x1="-70" y1="35" x2="0" y2="-45" stroke="#6366f1" stroke-width="3" stroke-linecap="round" />
        <line x1="70" y1="35" x2="0" y2="-45" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round" />
        <line x1="-70" y1="35" x2="70" y2="35" stroke="#10b981" stroke-width="2" stroke-dasharray="4,3" stroke-linecap="round" />

        <circle cx="0" cy="-45" r="26" fill="#1e293b" stroke="url(#brandGrad)" stroke-width="3" />
        <circle cx="0" cy="-45" r="10" fill="#6366f1" />

        <circle cx="-70" cy="35" r="20" fill="#1e293b" stroke="#6366f1" stroke-width="2.5" />
        <circle cx="70" cy="35" r="20" fill="#1e293b" stroke="#10b981" stroke-width="2.5" />
      </g>

      <text x="200" y="210" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="30" font-weight="700" fill="#f8fafc" letter-spacing="-0.5">Ambit</text>
      <text x="200" y="240" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="12.5" font-weight="500" fill="#94a3b8">Capability Tech Tree for Agents</text>
    </svg>`;
  }

  // Default: Banner family (1280x640, 1200x675, 1200x628, 1200x600, 960x540, 720x405)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1280 640">
    ${defs}
    <rect width="1280" height="640" fill="#090d16" />
    <rect width="1280" height="640" fill="url(#bgGrad)" />
    <circle cx="350" cy="250" r="450" fill="url(#meshLight1)" />
    <circle cx="950" cy="400" r="400" fill="url(#meshLight2)" />

    <!-- Left Content Block -->
    <g transform="translate(100, 150)">
      <!-- Pill Badge -->
      <rect width="210" height="34" rx="17" fill="rgba(99,102,241,0.12)" stroke="rgba(99,102,241,0.35)" stroke-width="1.2" />
      <circle cx="18" cy="17" r="4.5" fill="#10b981" />
      <text x="32" y="21" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="12.5" font-weight="600" fill="#c7d2fe">Autonomous Safety &amp; Audit</text>

      <!-- Main Heading -->
      <text x="0" y="100" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="64" font-weight="800" fill="#f8fafc" letter-spacing="-1.5">Ambit</text>
      
      <!-- Subtitle -->
      <text x="0" y="150" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="22" font-weight="500" fill="#cbd5e1" line-height="1.4">
        The Capability Graph &amp; Meta-MCP Server
      </text>
      <text x="0" y="184" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="16.5" font-weight="400" fill="#94a3b8">
        Audit blast radius, discover emergent combos, and govern agent execution.
      </text>

      <!-- Feature Tags -->
      <g transform="translate(0, 240)">
        <rect width="130" height="32" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
        <text x="65" y="20" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="12" font-weight="500" fill="#e2e8f0">47 MCP Tools</text>

        <rect x="145" width="165" height="32" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
        <text x="227" y="20" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="12" font-weight="500" fill="#e2e8f0">Zero Dependencies</text>

        <rect x="325" width="145" height="32" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
        <text x="397" y="20" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="12" font-weight="500" fill="#e2e8f0">HMAC Receipts</text>
      </g>
    </g>

    <!-- Right Capability Constellation Diagram Card -->
    <g transform="translate(730, 110)">
      <!-- Container Backdrop Card -->
      <rect width="450" height="420" rx="20" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.1)" stroke-width="1.5" />
      
      <!-- Graph Lines -->
      <g transform="translate(30, 30)">
        <line x1="60" y1="180" x2="190" y2="80" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" />
        <line x1="60" y1="180" x2="190" y2="280" stroke="#0ea5e9" stroke-width="2.5" stroke-linecap="round" />
        <line x1="190" y1="80" x2="330" y2="80" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" />
        <line x1="190" y1="280" x2="330" y2="280" stroke="#8b5cf6" stroke-width="2" stroke-dasharray="5,4" stroke-linecap="round" />
        <line x1="330" y1="80" x2="330" y2="180" stroke="#10b981" stroke-width="2" stroke-linecap="round" />
        <line x1="330" y1="280" x2="330" y2="180" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" />

        <!-- Node: opencode-core -->
        <circle cx="60" cy="180" r="32" fill="#1e293b" stroke="#6366f1" stroke-width="3" />
        <text x="60" y="185" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="13" font-weight="700" fill="#f8fafc">Core</text>

        <!-- Node: mcp:github -->
        <circle cx="190" cy="80" r="28" fill="#1e293b" stroke="#0ea5e9" stroke-width="2.5" />
        <text x="190" y="85" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="11.5" font-weight="600" fill="#f8fafc">GitHub</text>
        <circle cx="210" cy="60" r="8" fill="#10b981" stroke="#090d16" stroke-width="1.5" />
        <text x="210" y="63" text-anchor="middle" font-size="9" font-weight="800" fill="#ffffff">✓</text>

        <!-- Node: agent:deploy -->
        <circle cx="190" cy="280" r="28" fill="#1e293b" stroke="#8b5cf6" stroke-width="2.5" />
        <text x="190" y="285" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="11.5" font-weight="600" fill="#f8fafc">Agent</text>

        <!-- Node: verified check -->
        <circle cx="330" cy="80" r="28" fill="#1e293b" stroke="#10b981" stroke-width="2.5" />
        <text x="330" y="85" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="11.5" font-weight="600" fill="#34d399">Verified</text>

        <!-- Node: proposal -->
        <circle cx="330" cy="280" r="28" fill="#1e293b" stroke="#f59e0b" stroke-width="2.5" />
        <text x="330" y="285" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="11.5" font-weight="600" fill="#fbbf24">HMAC</text>

        <!-- Node: goal -->
        <circle cx="330" cy="180" r="34" fill="#1e293b" stroke="url(#brandGrad)" stroke-width="3.5" />
        <text x="330" y="185" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="13" font-weight="700" fill="#f8fafc">Prod Deploy</text>
      </g>
    </g>
  </svg>`;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  mkdirSync(ASSETS_DIR, { recursive: true });

  let ok = 0,
    warn = 0,
    err = 0;

  for (const [scene, spec] of Object.entries(SCENES)) {
    const outPath = join(ASSETS_DIR, `${PROJECT}-${scene}.png`);
    const tempSvgPath = join(ASSETS_DIR, `_${scene}_temp.svg`);

    if (dryRun) {
      console.log(`  [dry] ${scene}: ${spec.width}×${spec.height}`);
      continue;
    }

    try {
      // 1. Generate specialized SVG for the scene
      const svg = renderSvgForScene(scene, spec);
      writeFileSync(tempSvgPath, svg);

      // 2. Render via rsvg-convert
      execSync(`rsvg-convert -w ${spec.width} -h ${spec.height} -o "${outPath}" "${tempSvgPath}"`, {
        stdio: 'pipe',
        timeout: 15000,
      });

      // 3. Verify
      const sz = statSync(outPath).size;
      if (sz < spec.minBytes / 2) {
        console.log(`  ⚠️  ${scene}: ${sz}B (below ${spec.minBytes}B)`);
        warn++;
      } else {
        ok++;
      }
    } catch (e: any) {
      console.error(`  ❌ ${scene}: ${e.stderr || e.message}`);
      err++;
    } finally {
      try {
        execSync(`rm -f "${tempSvgPath}"`);
      } catch {}
    }
  }

  // Copy github preview to social-preview.png and public/social-preview.png
  const mainPreview = join(ASSETS_DIR, `${PROJECT}-github.png`);
  if (existsSync(mainPreview)) {
    copyFileSync(mainPreview, join(ASSETS_DIR, `${PROJECT}-social-preview.png`));
    copyFileSync(mainPreview, join(ASSETS_DIR, 'social-preview.png'));
    if (existsSync(join(process.cwd(), 'src', 'client', 'public'))) {
      copyFileSync(
        mainPreview,
        join(process.cwd(), 'src', 'client', 'public', 'social-preview.png')
      );
    }
    if (existsSync(join(process.cwd(), 'dist'))) {
      copyFileSync(mainPreview, join(process.cwd(), 'dist', 'social-preview.png'));
    }
  }

  console.log(`\n${dryRun ? 'DRY RUN ' : ''}✅ ${ok}  ⚠️ ${warn}  ❌ ${err}`);
  if (err > 0) process.exit(1);
}

main();
