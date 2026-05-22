import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// --- CONFIG & STATE ---
const CONFIG_PATH = join(process.env.HOME || '', '.config/opencode/opencode.json');
let activeSession = 'SESSION-42-A';
let systemPromptSize = 12000;
let historySize = 45000;
let maxContext = 128000;
let currentSelection = 'context'; // 'context', 'tools', 'telemetry'
let isPruning = false;

// Mock active tools and their attention values
interface ToolNode {
  name: string;
  category: string;
  attention: number; // 0.0 to 1.0 (relative orbit radius/focus)
  calls: number;
  errorCount: number;
  lastUsed: string;
}

let tools: ToolNode[] = [
  { name: 'dbsnp-database', category: 'mcp', attention: 0.85, calls: 24, errorCount: 0, lastUsed: '32s ago' },
  { name: 'clinvar-database', category: 'mcp', attention: 0.60, calls: 12, errorCount: 0, lastUsed: '2m ago' },
  { name: 'chrome-devtools', category: 'mcp', attention: 0.15, calls: 3, errorCount: 1, lastUsed: '15m ago' },
  { name: 'git-diff-tool', category: 'command', attention: 0.95, calls: 42, errorCount: 0, lastUsed: '5s ago' },
  { name: 'pubmed-search', category: 'mcp', attention: 0.05, calls: 1, errorCount: 2, lastUsed: '1h ago' }
];

// Telemetry logs feed
let logs: string[] = [
  '[04:12:10] Session initialized using model: Gemini 3.5 Flash',
  '[04:12:15] System instructions loaded (12,000 tokens)',
  '[04:13:02] Tool git-diff-tool invoked successfully',
  '[04:14:45] Warning: pubmed-search connection timeout',
  '[04:15:10] Context pressure exceeded 40%'
];

function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    try {
      const data = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      // Extract tools if needed, but we keep our dynamic metrics active
    } catch {}
  }
}

// --- TERMINAL RENDER ENGINE ---
const ESC = '\x1b[';
const CLEAR = ESC + '2J' + ESC + 'H';
const HIDE_CURSOR = ESC + '?25l';
const SHOW_CURSOR = ESC + '?25h';

// Colors (high contrast mechanical theme: amber, slate, obsidian)
const C_RESET = '\x1b[0m';
const C_BG_DARK = '\x1b[48;5;232m';
const C_TEXT_MUTED = '\x1b[38;5;244m';
const C_AMBER = '\x1b[38;5;214m';
const C_AMBER_BG = '\x1b[48;5;214m\x1b[30m';
const C_RED = '\x1b[38;5;196m';
const C_GREEN = '\x1b[38;5;46m';
const C_CYAN = '\x1b[38;5;45m';
const C_WHITE = '\x1b[38;5;255m';

function drawBox(x: number, y: number, w: number, h: number, title: string, focused: boolean) {
  const borderCol = focused ? C_AMBER : C_TEXT_MUTED;
  const titleCol = focused ? C_WHITE : C_TEXT_MUTED;
  
  // Top border
  process.stdout.write(ESC + `${y};${x}H` + borderCol + '┌' + '─'.repeat(w - 2) + '┐' + C_RESET);
  // Title
  if (title) {
    process.stdout.write(ESC + `${y};${x + 2}H ` + titleCol + title + ' ' + C_RESET);
  }
  // Sides
  for (let i = 1; i < h - 1; i++) {
    process.stdout.write(ESC + `${y + i};${x}H` + borderCol + '│' + ' '.repeat(w - 2) + '│' + C_RESET);
  }
  // Bottom border
  process.stdout.write(ESC + `${y + h - 1};${x}H` + borderCol + '└' + '─'.repeat(w - 2) + '┘' + C_RESET);
}

// Draw text at coordinates
function drawText(x: number, y: number, text: string, color = C_RESET) {
  process.stdout.write(ESC + `${y};${x}H` + color + text + C_RESET);
}

// Draw Isometric Cube
function drawIsoCube(x: number, y: number, label: string, color = C_AMBER, hollow = false) {
  const c = color;
  if (hollow) {
    drawText(x + 3, y,     '┌───────┐', c);
    drawText(x + 2, y + 1, '╱       ╱│', c);
    drawText(x + 1, y + 2, '┌───────┐ │', c);
    drawText(x + 1, y + 3, '│ ' + label.padEnd(5) + ' │ ┘', c);
    drawText(x + 1, y + 4, '└───────┘', c);
  } else {
    drawText(x + 3, y,     '┌───────┐', c);
    drawText(x + 2, y + 1, '╱       ╱│', c);
    drawText(x + 1, y + 2, '┌───────┐ │', c);
    drawText(x + 1, y + 3, '│ ' + label.padEnd(5) + ' │ ┘', c);
    drawText(x + 1, y + 4, '└───────┘', c);
  }
}

// Render the 3D Context Stack (Isometric Tower)
function renderContextTower(x: number, y: number) {
  const toolTokens = tools.reduce((acc, t) => acc + (t.attention > 0.1 ? 3500 : 500), 0);
  const totalTokens = systemPromptSize + historySize + toolTokens;
  const pct = totalTokens / maxContext;
  
  // Dynamic color matching context pressure
  let towerCol = C_GREEN;
  if (pct > 0.5) towerCol = C_AMBER;
  if (pct > 0.8) towerCol = C_RED;

  // Draw Stack from Bottom to Top (overlapping properly in isometric projection)
  // 1. Tool schemas base
  drawIsoCube(x, y + 8, 'TOL', tools.length > 0 ? C_CYAN : C_TEXT_MUTED);
  
  // 2. Memory/History blocks (number of blocks represents scale)
  const memBlocks = Math.max(1, Math.min(3, Math.round(historySize / 20000)));
  for (let i = 0; i < memBlocks; i++) {
    drawIsoCube(x, y + 4 - (i * 3), 'MEM', towerCol);
  }

  // 3. System Instructions cap
  drawIsoCube(x, y - (memBlocks * 3), 'SYS', C_WHITE);

  // Indicators
  drawText(x + 16, y + 1, `SYSTEM : ${(systemPromptSize/1000).toFixed(1)}k tokens`, C_WHITE);
  drawText(x + 16, y + 4, `HISTORY: ${(historySize/1000).toFixed(1)}k tokens`, towerCol);
  drawText(x + 16, y + 7, `SCHEMAS: ${(toolTokens/1000).toFixed(1)}k tokens`, C_CYAN);
  
  // Token bar
  const barWidth = 20;
  const filled = Math.min(barWidth, Math.round(pct * barWidth));
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  drawText(x + 16, y + 9, `BUDGET : [${bar}] ${Math.round(pct * 100)}%`, pct > 0.8 ? C_RED : C_AMBER);
}

// Render the Isometric Attention Grid (Tools Constellation)
function renderAttentionGrid(x: number, y: number, w: number, h: number) {
  const midX = x + Math.floor(w / 2);
  const midY = y + Math.floor(h / 2);

  // Draw grid helper lines
  for (let i = 1; i < h - 1; i++) {
    const spaces = ' '.repeat(w - 2);
    drawText(x + 1, y + i, spaces, C_TEXT_MUTED);
  }

  // Draw concentric orbits (isometric ellipses using text)
  // Inner orbit (high attention)
  drawText(midX - 8, midY - 2, '  . - ─── - .  ', C_TEXT_MUTED);
  drawText(midX - 10, midY - 1, ' :             : ', C_TEXT_MUTED);
  drawText(midX - 10, midY,     ' :    [CORE]   : ', C_TEXT_MUTED);
  drawText(midX - 10, midY + 1, ' :             : ', C_TEXT_MUTED);
  drawText(midX - 8, midY + 2, '  \' - ─── - \'  ', C_TEXT_MUTED);

  // Plot tools relative to attention (high attention = close to core)
  tools.forEach((tool, idx) => {
    let theta = (idx * (2 * Math.PI)) / tools.length;
    // Add dynamic sway animation
    theta += Math.sin(Date.now() / 1500 + idx) * 0.1;
    
    // Scale position based on inverse attention (high attention = small radius)
    const radiusX = 14 * (1.1 - tool.attention);
    const radiusY = 5 * (1.1 - tool.attention);

    const px = Math.round(midX + Math.cos(theta) * radiusX);
    const py = Math.round(midY + Math.sin(theta) * radiusY);

    const isSelected = currentSelection === 'tools' && idx === 0; // Highlight first tool for proto selection
    const marker = tool.errorCount > 0 ? '⬡' : '⬢';
    const markerCol = tool.errorCount > 0 ? C_RED : tool.attention > 0.7 ? C_AMBER : C_CYAN;

    drawText(px, py, marker, isSelected ? C_WHITE : markerCol);
    drawText(px + 2, py, tool.name.slice(0, 12), isSelected ? C_WHITE : C_TEXT_MUTED);

    // Dynamic connection lines pulsing to active tools
    if (tool.attention > 0.5) {
      const lineChar = '•';
      const step = Math.floor((Date.now() / 150) % 5);
      // Draw a tiny trail towards the core
      const lex = Math.round(px + (midX - px) * (step / 5));
      const ley = Math.round(py + (midY - py) * (step / 5));
      drawText(lex, ley, lineChar, C_AMBER);
    }
  });
}

// Render Telemetry & Hyper-Focus metrics
function renderTelemetry(x: number, y: number, w: number, h: number) {
  // Clear pane
  for (let i = 1; i < h - 1; i++) {
    drawText(x + 1, y + i, ' '.repeat(w - 2));
  }

  // Active metrics
  drawText(x + 2, y + 2, `SESSION   : ${activeSession}`, C_WHITE);
  drawText(x + 2, y + 3, `ENGINE    : Gemini 3.5 Pro`, C_CYAN);
  drawText(x + 2, y + 4, `COHESION  : 94.2% [EXCELLENT]`, C_GREEN);
  
  // Semantic alignment delta
  const alignmentDelta = Math.sin(Date.now() / 3000) * 2.5 + 95;
  drawText(x + 2, y + 5, `ALIGNMENT : ${alignmentDelta.toFixed(1)}%`, C_AMBER);

  // Divider
  drawText(x + 2, y + 7, '─'.repeat(w - 4), C_TEXT_MUTED);
  drawText(x + 2, y + 8, 'LIVE TELEMETRY LOGS:', C_AMBER);

  // Render logs
  const visibleLogs = logs.slice(-6);
  visibleLogs.forEach((log, idx) => {
    let col = C_TEXT_MUTED;
    if (log.includes('Warning') || log.includes('error')) col = C_RED;
    if (log.includes('successfully')) col = C_GREEN;
    drawText(x + 2, y + 10 + idx, log.slice(0, w - 4).padEnd(w - 4), col);
  });
}

// Main Draw Loop
function render() {
  const cols = process.stdout.columns || 100;
  const rows = process.stdout.rows || 24;

  const contextW = Math.floor(cols * 0.42);
  const orbitW = Math.floor(cols * 0.28);
  const telemetryW = cols - contextW - orbitW - 2;

  // Base layout panels
  drawBox(1, 1, contextW, rows - 3, 'COGNITIVE CONTEXT TOWER (SYS/MEM/TOL)', currentSelection === 'context');
  drawBox(contextW + 1, 1, orbitW, rows - 3, 'ATTENTION CONSTELLATION ORBITS', currentSelection === 'tools');
  drawBox(contextW + orbitW + 1, 1, telemetryW, rows - 3, 'HYPER-FOCUS TELEMETRY READOUT', currentSelection === 'telemetry');

  // Render contents
  renderContextTower(5, 5);
  renderAttentionGrid(contextW + 1, 1, orbitW, rows - 3);
  renderTelemetry(contextW + orbitW + 1, 1, telemetryW, rows - 3);

  // Status/Control bar
  const prnMsg = isPruning ? ' [COMPACTING...] ' : ' ';
  drawText(2, rows - 1, `[TAB] Swap Focus | [P] Prune Context${prnMsg}| [E] Eject Idle Tools | [S] Snapshot | [Ctrl+C] Exit`, C_AMBER);
}

// --- INTERACTIVE KEYBOARD HANDLING ---
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
}

process.stdin.on('data', (key) => {
  if (key === '\u0003') { // Ctrl+C
    process.stdout.write(SHOW_CURSOR);
    process.stdout.write(CLEAR);
    process.exit();
  }

  const k = key.toLowerCase();
  
  if (k === '\t') { // Tab
    const views = ['context', 'tools', 'telemetry'];
    const idx = views.indexOf(currentSelection);
    currentSelection = views[(idx + 1) % views.length];
    logs.push(`[${new Date().toLocaleTimeString()}] Focus switched to: ${currentSelection}`);
  }

  if (k === 'p') { // Prune Context
    isPruning = true;
    logs.push(`[${new Date().toLocaleTimeString()}] Context compaction triggered...`);
    setTimeout(() => {
      historySize = Math.max(10000, historySize - 15000);
      isPruning = false;
      logs.push(`[${new Date().toLocaleTimeString()}] History compacted (-15k tokens)`);
    }, 1200);
  }

  if (k === 'e') { // Eject tools
    if (tools.length > 2) {
      const removed = tools.pop();
      logs.push(`[${new Date().toLocaleTimeString()}] Ejected idle tool schema: ${removed?.name}`);
    } else {
      logs.push(`[${new Date().toLocaleTimeString()}] Cannot eject: Core tools required.`);
    }
  }

  if (k === 's') { // Snapshot
    const snapId = `snap-${Date.now().toString().slice(-4)}`;
    logs.push(`[${new Date().toLocaleTimeString()}] Snapshot ${snapId} stored to SQLite.`);
  }

  render();
});

// --- EXECUTE ---
loadConfig();
process.stdout.write(CLEAR);
process.stdout.write(HIDE_CURSOR);

// Update telemetry periodically
setInterval(() => {
  // Randomly sway telemetry metrics slightly to make it feel alive
  if (Math.random() > 0.7) {
    const delta = Math.floor((Math.random() - 0.5) * 500);
    historySize = Math.max(5000, Math.min(80000, historySize + delta));
  }
  
  // Randomly simulate tool call logs
  if (Math.random() > 0.9) {
    const activeTool = tools[Math.floor(Math.random() * tools.length)];
    activeTool.calls++;
    activeTool.attention = Math.min(0.98, activeTool.attention + 0.05);
    // reduce other tools attention slightly
    tools.forEach(t => {
      if (t !== activeTool) t.attention = Math.max(0.05, t.attention - 0.02);
    });
    logs.push(`[${new Date().toLocaleTimeString()}] Tool ${activeTool.name} requested by LLM`);
  }

  render();
}, 200);

// Initial draw
render();
