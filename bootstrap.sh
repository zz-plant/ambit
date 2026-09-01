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
# Render the engine's own status report rather than keeping a second copy of
# its queries here. The copy that used to live in this file counted every row
# in the capabilities table — the 28 `action` rows and the providers included —
# so it announced "28/69 capabilities" seconds before `ambit status` said
# "15/41" about the same graph. A reader has no way to tell which is real. The
# rule for what counts as a capability lives in one place now; this only draws.
node --experimental-sqlite "$ROOT/src/engine/engine.ts" status --json 2>/dev/null | node -e "
let raw='';
process.stdin.on('data', c => raw += c).on('end', () => {
  let s; try { s = JSON.parse(raw); } catch { return; }
  if (typeof s.total !== 'number') return;
  const bar = (r, t) => { const n = t > 0 ? Math.round((r / t) * 10) : 0; return '█'.repeat(n) + '░'.repeat(10 - n); };
  console.log('┌─ Your environment ────────────────────────────────────┐');
  console.log('│ ' + s.reached + '/' + s.total + ' capabilities reached · ' + (s.domains || []).length + ' domains');
  for (const d of s.domains || []) console.log('│ ' + bar(d.reached, d.total) + ' ' + String(d.domain).padEnd(12) + ' ' + d.reached + '/' + d.total);
  if (s.actions) console.log('│ ' + ' '.repeat(10) + ' ' + 'actions'.padEnd(12) + ' ' + s.actions.reached + '/' + s.actions.total);
  console.log('└───────────────────────────────────────────────────────┘');
});" || true

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
  # Only commands that answer on a graph built one second ago. `attention` and
  # `opportunities` read the work ledger, which is empty until runs have been
  # recorded — recommending them here sent every new user straight into two
  # "nothing recorded yet" notes as their first experience of the tool.
  echo "ambit status         — health, single points of failure, what is unverified"
  echo "ambit goal <name>    — what it would take to reach a capability"
  echo "ambit impact <id>    — what stops working if this goes away"
  echo "./bootstrap.sh web   — open the visualiser"
  echo ""
  echo "ambit attention and ambit opportunities price the human cost of running"
  echo "this. They read a work ledger that starts empty, so they become useful"
  echo "after runs have been recorded — not on first run."
fi
