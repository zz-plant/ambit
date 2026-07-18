#!/usr/bin/env bash
set -e

MODE="${1:-cli}"

if [ "$MODE" = "--dry-run" ]; then
  echo "🌳 Discovery only"
  CONFIG="${OPENCODE_CONFIG:-$HOME/.config/opencode/opencode.json}"
  [ -f "$CONFIG" ] && echo "  opencode.json: found" || echo "  opencode.json: not found"
  curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && echo "  Ollama: running" || echo "  Ollama: not detected"
  for dir in "$HOME/.agents/skills" "$HOME/.opencode/skills" "$HOME/.hermes/skills"; do
    [ -d "$dir" ] && echo "  Skills: $(ls "$dir" 2>/dev/null | wc -l | tr -d ' ') in $(basename $(dirname $dir))"
  done
  exit 0
fi

[ ! -d node_modules ] && echo "Installing..." && bun install -q

if [ -f "${OPENCODE_CONFIG:-$HOME/.config/opencode/opencode.json}" ]; then
  node --experimental-sqlite src/engine/engine.ts seed 2>/dev/null
fi

DB="${TOOLCHAIN_DB:-$HOME/.config/opencode/toolchain-viz.db}"
node --experimental-sqlite -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('$DB');
const g=db.prepare('SELECT COUNT(*) as t, SUM(CASE WHEN state IN (\"unlocked\",\"active\") THEN 1 ELSE 0 END) as u FROM capabilities').get();
const d=db.prepare('SELECT domain, COUNT(*) as t, SUM(CASE WHEN state IN (\"unlocked\",\"active\") THEN 1 ELSE 0 END) as u FROM capabilities GROUP BY domain ORDER BY domain').all();
const c=db.prepare(\"SELECT COUNT(*) as c FROM capabilities WHERE category='combo'\").get()||{c:0};
console.log('┌─ Toolchain ───────────────────────────────────────────┐');
console.log('│ '+g.u+'/'+g.t+' capabilities, '+d.length+' domains'+(c.c>0?', '+c.c+' combos':''));
for(const s of d){const p=s.t>0?Math.round((s.u/s.t)*100):0;console.log('│ '+'█'.repeat(Math.round(p/10))+'░'.repeat(10-Math.round(p/10))+' '+s.domain.padEnd(12)+' '+s.u+'/'+s.t);}
console.log('└───────────────────────────────────────────────────────┘');
db.close();" 2>/dev/null

echo ""
if [ "$MODE" = "web" ]; then
  echo "Starting visualizer at http://localhost:3000"
  bun run dev
else
  echo "tt stats  — full overview"
  echo "tt decay  — what needs maintenance"
  echo "tt fork   — which combo to unlock"
  echo "bootstrap web — start visualizer"
fi
