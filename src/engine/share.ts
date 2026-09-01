import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_DIR } from "./paths.ts";
import type { Db } from "./db.ts";

/**
 * A shareable snapshot of the map: one self-contained HTML file, built from an
 * explicit whitelist of fields, written locally. Nothing is uploaded — where
 * it goes next is the person's decision, made outside this tool.
 *
 * What may enter the file is enumerated here rather than filtered out later:
 * node name, kind, category, domain, era, state, lifecycle, and the edges.
 * Commands, URLs, paths, descriptions, economics, people's names, and
 * anything else the graph knows stay out by construction — a field that is
 * not selected cannot leak. Actors render as "a person"; `redact` replaces
 * every non-curated name with its category and an index, for sharing the
 * shape of a setup without its contents.
 */
export function shareSnapshot(db: Db, opts: { redact?: boolean } = {}) {
  const caps = db.prepare(
    `SELECT id, name, domain, category, state, lifecycle, kind FROM capabilities
     WHERE kind != 'action' ORDER BY domain, name`
  ).all() as any[];
  const deps = db.prepare(
    "SELECT from_capability f, to_capability t, is_hard_requisite hard FROM dependencies"
  ).all() as any[];

  let eras: Record<string, string> = {};
  const eraById = new Map<string, number>();
  try {
    const tree = JSON.parse(readFileSync(join(ENGINE_DIR, "techtree.json"), "utf8"));
    eras = tree.eras || {};
    for (const n of tree.nodes || []) eraById.set(`combo:${n.id}`, n.era);
  } catch { /* concrete stack only */ }

  let redactedCount = 0;
  const counters: Record<string, number> = {};
  const display = (c: any): string => {
    if (c.kind === "actor") { redactedCount++; return "a person"; }
    if (opts.redact && !eraById.has(c.id)) {
      counters[c.category] = (counters[c.category] || 0) + 1;
      redactedCount++;
      return `${c.category || c.kind} ${counters[c.category]}`;
    }
    return c.name;
  };

  const reached = (c: any) => c.state === "unlocked" || c.state === "active";
  const proven = (c: any) => ["verified", "reliable"].includes(c.lifecycle);
  const failing = (c: any) => ["degraded", "broken"].includes(c.lifecycle);

  // Columns: curated capabilities by era, the concrete stack by domain.
  const cols = new Map<string, any[]>();
  const colKey = (c: any) =>
    eraById.has(c.id) ? `era:${eraById.get(c.id)}` : (c.domain || "other");
  for (const c of caps) {
    const k = colKey(c);
    if (!cols.has(k)) cols.set(k, []);
    cols.get(k)!.push(c);
  }
  const order = [...cols.keys()].sort((a, b) => {
    const ea = a.startsWith("era:") ? Number(a.slice(4)) : 1000;
    const eb = b.startsWith("era:") ? Number(b.slice(4)) : 1000;
    return ea - eb || a.localeCompare(b);
  });

  const COL_W = 190, ROW_H = 56, R = 9, TOP = 96;
  const height = TOP + Math.max(...[...cols.values()].map(v => v.length)) * ROW_H + 80;
  const width = order.length * COL_W + 60;

  const pos = new Map<string, { x: number; y: number }>();
  order.forEach((k, ci) => cols.get(k)!.forEach((c, ri) =>
    pos.set(c.id, { x: 40 + ci * COL_W + COL_W / 2, y: TOP + ri * ROW_H })));

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const edgeSvg = deps
    .filter(d => pos.has(d.f) && pos.has(d.t))
    .map(d => {
      const a = pos.get(d.f)!, b = pos.get(d.t)!;
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#334155" stroke-width="0.6" ${d.hard ? "" : 'stroke-dasharray="4,3"'} opacity="0.45"/>`;
    }).join("\n");

  const nodeSvg = caps.map(c => {
    const p = pos.get(c.id)!;
    const name = display(c);
    const label = name.length > 24 ? name.slice(0, 22) + "…" : name;
    const fill = reached(c) ? (failing(c) ? "#7f1d1d" : "#1f7a8c") : "none";
    const stroke = reached(c) ? "#38bdf8" : "#475569";
    const badge = reached(c) && proven(c)
      ? `<circle cx="${p.x + R - 1}" cy="${p.y - R + 1}" r="5" fill="#059669"/><text x="${p.x + R - 1}" y="${p.y - R + 4}" text-anchor="middle" font-size="7" fill="#ecfdf5">✓</text>`
      : reached(c) && failing(c)
        ? `<circle cx="${p.x + R - 1}" cy="${p.y - R + 1}" r="5" fill="#dc2626"/><text x="${p.x + R - 1}" y="${p.y - R + 4}" text-anchor="middle" font-size="7" fill="#fef2f2">!</text>`
        : "";
    return `<circle cx="${p.x}" cy="${p.y}" r="${R}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" opacity="${reached(c) ? 1 : 0.5}"/>${badge}
<text x="${p.x}" y="${p.y + R + 12}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="9.5" fill="${reached(c) ? "#cbd5e1" : "#64748b"}">${esc(label)}</text>`;
  }).join("\n");

  const headers = order.map((k, ci) => {
    const title = k.startsWith("era:") ? (eras[k.slice(4)] || `Era ${k.slice(4)}`) : k;
    return `<text x="${40 + ci * COL_W + COL_W / 2}" y="${TOP - 28}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="11" letter-spacing="2" fill="#7dd3fc">${esc(String(title).toUpperCase())}</text>`;
  }).join("\n");

  const total = caps.length;
  const reachedCount = caps.filter(reached).length;
  const provenCount = caps.filter(c => reached(c) && proven(c)).length;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>An agent capability map — Ambit</title>
<style>body{margin:0;background:#0b1120;color:#cbd5e1;font-family:ui-monospace,Menlo,monospace}
header{padding:24px 32px 8px}h1{font-size:18px;margin:0;color:#e2e8f0}
p{font-size:12px;color:#64748b;margin:6px 0 0}
main{overflow:auto;padding:0 16px}
footer{padding:16px 32px 28px;font-size:12px;color:#64748b}a{color:#7dd3fc}</style></head>
<body>
<header><h1>An agent capability map</h1>
<p>${reachedCount} of ${total} capabilities reached · ${provenCount} proven by a passing check · filled circles are reached, ✓ is a passing check, ! is a failing one</p></header>
<main><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#0b1120"/>
${headers}
${edgeSvg}
${nodeSvg}
</svg></main>
<footer>Rendered locally by <a href="https://github.com/zz-plant/ambit">Ambit</a> from an allow-listed slice of the graph — names, states, and edges only. No commands, URLs, paths, or descriptions are in this file.</footer>
</body></html>`;

  return {
    html,
    nodes: total,
    reached: reachedCount,
    proven: provenCount,
    redacted_names: redactedCount,
  };
}
