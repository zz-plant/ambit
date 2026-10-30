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

# The first-run report is the readout bare `ambit` prints, so a checkout's
# first screen and `npx ambit-cli`'s are the same: what was read, how much of
# the tree it reaches, the next step, what is not proven yet. The copy that
# used to live here counted every row in the capabilities table and announced
# "28/69 capabilities" seconds before `ambit status` said "15/41".
node --experimental-sqlite --disable-warning=ExperimentalWarning "$ROOT/src/engine/engine.ts" status --brief 2>/dev/null || true

# Link the \`ambit\` command onto the PATH when ~/.local/bin is on it.
echo ""
if command -v ambit >/dev/null 2>&1; then
  :
else
  chmod +x "$ROOT/cli.js"
  if [ -d "$HOME/.local/bin" ] && case ":$PATH:" in *":$HOME/.local/bin:"*) true ;; *) false ;; esac; then
    ln -sf "$ROOT/cli.js" "$HOME/.local/bin/ambit"
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
  # The readout above ends on the one thing to do. In a checkout the map's
  # dependencies are installed by this script, so that is how it opens.
  echo "In this checkout, ./bootstrap.sh web installs the map's dependencies and opens it."
fi
