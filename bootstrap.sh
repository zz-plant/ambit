#!/usr/bin/env bash
set -e

MODE="${1:-cli}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Node is the only runtime. The engine, the CLI and the API server all open the
# graph through node:sqlite; the visualiser is Vite, which runs on Node too.
# This check exists so the first failure is a sentence rather than whatever
# error `node` happens to print.
command -v node >/dev/null 2>&1 || { echo "Node 22+ is required — https://nodejs.org"; exit 1; }
if [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]; then
  echo "Node 22+ is required (found $(node -v)); the engine uses node:sqlite."; exit 1
fi
# Frontend dependencies are only needed for the optional visualiser, so a
# checkout that only wants a graph never installs them.
if [ "$MODE" = "web" ]; then
  if [ ! -d node_modules ]; then echo "Installing..."; npm install --silent; fi
fi

# Seed unconditionally. Guarding this on the config existing meant a machine
# without OpenCode got an empty database file and a SQLite error from the
# summary below; the engine now reports for itself when it found no config.
node --experimental-sqlite "$ROOT/src/engine/engine.ts" seed

# Ask the engine where it put the graph rather than reconstructing the rule.
# Guessing is how the summary previously ended up reading a different database
# than seed had just written, and always reporting an empty graph.
DB="$(node --experimental-sqlite "$ROOT/src/engine/engine.ts" where --json | sed -n 's/.*"graph": *"\([^"]*\)".*/\1/p')"
DB="${DB:-$ROOT/toolchain-viz.db}"
node --experimental-sqlite -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('$DB');
const g=db.prepare(\"SELECT COUNT(*) as t, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as u FROM capabilities\").get();
const d=db.prepare(\"SELECT domain, COUNT(*) as t, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as u FROM capabilities GROUP BY domain ORDER BY domain\").all();
const c=db.prepare(\"SELECT COUNT(*) as c FROM capabilities WHERE category='combo'\").get()||{c:0};
console.log('┌─ Toolchain ───────────────────────────────────────────┐');
console.log('│ '+(g.u||0)+'/'+g.t+' capabilities, '+d.length+' domains'+(c.c>0?', '+c.c+' combos':''));
for(const s of d){const p=s.t>0?Math.round((s.u/s.t)*100):0;console.log('│ '+'█'.repeat(Math.round(p/10))+'░'.repeat(10-Math.round(p/10))+' '+s.domain.padEnd(12)+' '+s.u+'/'+s.t);}
console.log('└───────────────────────────────────────────────────────┘');
db.close();"

# The CLI is \`ambit\`. Older installs knew it as \`tt\`; link the current name,
# and keep \`tt\` as an alias when nothing already occupies it.
echo ""
if command -v ambit >/dev/null 2>&1; then
  :
else
  chmod +x "$ROOT/cli.js"
  if [ -d "$HOME/.local/bin" ] && case ":$PATH:" in *":$HOME/.local/bin:"*) true ;; *) false ;; esac; then
    ln -sf "$ROOT/cli.js" "$HOME/.local/bin/ambit"
    command -v tt >/dev/null 2>&1 || ln -sf "$ROOT/cli.js" "$HOME/.local/bin/tt"
    echo "Linked ambit → ~/.local/bin/ambit"
  else
    echo "To get the ambit command on your PATH:"
    echo "  ln -s $ROOT/cli.js /usr/local/bin/ambit      # or any directory on your PATH"
    echo "Until then, run it in place: $ROOT/cli.js status"
  fi
fi

echo ""
if [ "$MODE" = "web" ]; then
  echo "Starting visualizer at http://localhost:3000"
  npm run dev
else
  echo "ambit status        — health, degraded, spofs, deficits, pending approvals"
  echo "ambit attention     — where the human's time actually goes"
  echo "ambit opportunities — what is worth building next, priced and ranked"
  echo "./bootstrap.sh web  — start visualizer"
fi
