import { useEffect, useState } from 'react';
import concepts from '../../shared/concepts.json';
import { typeLabel } from '../utils/labels';
import { typeColor } from '../utils/typeColors';

export type DocsTab = 'concepts' | 'reading' | 'doing' | 'hotkeys';

interface DocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: DocsTab;
}

type Tab = DocsTab;

const TABS: { id: Tab; label: string }[] = [
  { id: 'concepts', label: 'Concepts' },
  { id: 'reading', label: 'Reading the Map' },
  { id: 'doing', label: 'Common Actions' },
  { id: 'hotkeys', label: 'Shortcuts' },
];

const HOTKEYS = [
  { key: '/', desc: 'Find a capability, on the map or in your setup' },
  { key: 'J / K', desc: 'Step through the nodes on the map' },
  { key: '1 - 2', desc: 'Switch lens (1: Standard, 2: Attention)' },
  { key: '+ / -', desc: 'Zoom in / out on the map' },
  { key: '0', desc: 'Back to actual size' },
  { key: 'G', desc: 'Open proposals' },
  { key: '?', desc: 'Open this guide' },
  { key: 'ESC', desc: 'Clear the selection, or close whatever is open' },
];

/** Drawn from the same label map the map and the panels read, so a rename
 *  cannot leave the documentation describing a word nothing uses. */
const NODE_TYPES = [
  { type: 'framework', sym: '★', desc: 'The agent runtime itself' },
  { type: 'mcp-server', sym: '◈', desc: 'A tool the agent can call' },
  { type: 'agent', sym: '◆', desc: 'A subagent with its own prompt and model' },
  { type: 'skill', sym: '◇', desc: 'A procedure loaded on demand' },
  { type: 'provider', sym: '●', desc: 'Where inference happens' },
  { type: 'possibility', sym: '●', desc: 'A capability you reach by having others' },
].map(n => ({ ...n, label: typeLabel(n.type) }));

const ACTIONS = [
  {
    cmd: 'ambit status',
    answers: 'How is the environment doing? (frontier, verified, failing, spofs)',
  },
  { cmd: 'ambit verify', answers: 'Run executable checks to prove capabilities are working' },
  { cmd: 'ambit authority', answers: 'What may run unattended vs what requires confirmation?' },
  {
    cmd: 'ambit goal "<intent>"',
    answers: 'Route a natural language goal to concrete capability plans',
  },
  {
    cmd: 'ambit opportunities',
    answers: 'Ranked high-ROI capability upgrades based on observed friction',
  },
  {
    cmd: 'ambit impact <id>',
    answers: 'What breaks downstream if a tool or credential disappears?',
  },
  { cmd: 'ambit propose <cap>', answers: 'Draft a safe, reviewable capability acquisition' },
  { cmd: 'ambit approve / apply', answers: 'Human-gated execution with signed approval receipts' },
];

export default function DocsModal({ isOpen, onClose, initialTab }: DocsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'concepts');

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  // Escape closes it. Dismissal used to be a click on the backdrop and nothing
  // else, which is unreachable without a pointer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click to dismiss modal
    <div className="docs-overlay" onClick={onClose} role="presentation">
      <div
        className="docs-panel"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="docs-header">
          <div className="docs-title-wrap">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="docs-header-icon"
              aria-hidden="true"
            >
              <path d="M3 4 C3 3.2 3.7 2.5 4.5 2.5 H9.5 V17.5 H4.5 C3.7 17.5 3 16.8 3 16 Z M17 4 C17 3.2 16.3 2.5 15.5 2.5 H10.5 V17.5 H15.5 C16.3 17.5 17 16.8 17 16 Z" />
            </svg>
            <div>
              <h2 className="docs-title">How to read this</h2>
              <p className="docs-subtitle">Your setup, placed on a tree of agent capabilities</p>
            </div>
          </div>
          <button type="button" className="docs-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="docs-tabs" role="tablist">
          {TABS.map(t => (
            <button
              type="button"
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`docs-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="docs-body">
          {tab === 'concepts' && (
            <>
              <p className="docs-lede">
                {concepts.concepts.length} terms carry all the meaning here, in the order you meet
                them. Everything the tool says is built from them.
              </p>
              {concepts.concepts.map(c => (
                <div key={c.key} className="docs-concept">
                  <div className="docs-concept-head">
                    <span className="docs-concept-term">{c.term}</span>
                    <span className="docs-concept-short">{c.short}</span>
                  </div>
                  <p className="docs-concept-long">{c.long}</p>
                  <p className="docs-concept-seen">Where you see it: {c.seen}</p>
                </div>
              ))}
            </>
          )}

          {tab === 'reading' && (
            <>
              <p className="docs-lede">
                Columns are areas of work. Height is roughly how far up the tree something sits.
              </p>
              <h3 className="docs-h3">The circles</h3>
              <div className="docs-list">
                {NODE_TYPES.map(n => (
                  <div key={n.label} className="docs-row">
                    <span className="docs-swatch" style={{ background: typeColor(n.type) }}>
                      {n.sym}
                    </span>
                    <span>
                      <strong>{n.label}</strong> — {n.desc}
                    </span>
                  </div>
                ))}
              </div>

              {/* One section for the three states, in the legend's order. It
                  was two: "Solid vs outlined" and, further down, "The states",
                  saying the same thing about the same circles. */}
              <h3 className="docs-h3">Solid, outlined, faded</h3>
              <p className="docs-p">
                A solid circle is reached. An outlined one is a next step: its prerequisites are
                met, and its setup cost sits beside it. A faded one is blocked, with a prerequisite
                missing.
              </p>

              <h3 className="docs-h3">The lines</h3>
              <div className="docs-list">
                <div className="docs-row">
                  <span className="docs-line-solid" />
                  <span>
                    <strong>Required</strong> — without it the dependent capability cannot work
                  </span>
                </div>
                <div className="docs-row">
                  <span className="docs-line-dashed" />
                  <span>
                    <strong>Optional</strong> — helps, but does not gate
                  </span>
                </div>
              </div>
              <p className="docs-p docs-muted">
                The data model and the CLI call these hard and soft prerequisites.
              </p>

              <h3 className="docs-h3">Which way an edge runs</h3>
              <p className="docs-p">
                Select a node and its edges are drawn apart: what it needs in teal, what it enables
                in indigo, one hop each way. The simulations follow the edges all the way.
              </p>

              <h3 className="docs-h3">The map and My Setup</h3>
              <p className="docs-p">
                <strong>The map</strong> is the curated tree with your position on it.{' '}
                <strong>My Setup</strong> is what was found in your agent configs, one row per
                entry, each with the nodes on the map it provides. Rows in a column are ordered so a
                node sits near what it connects to; height on its own means nothing.
              </p>
            </>
          )}

          {tab === 'doing' && (
            <>
              <p className="docs-lede">On this page:</p>
              <div className="docs-list">
                <div className="docs-action">
                  <span className="docs-cmd">Click a node</span>
                  <span className="docs-answers">
                    What depends on it, whether its check passes, and a simulation — an outage for a
                    node you have, what it would unlock for one you do not
                  </span>
                </div>
                <div className="docs-action">
                  <span className="docs-cmd">Click a legend key</span>
                  <span className="docs-answers">
                    Highlights only that kind — keystones, failing checks, next steps. The three
                    counts in the header do the same. Esc clears it
                  </span>
                </div>
                <div className="docs-action">
                  <span className="docs-cmd">Search</span>
                  <span className="docs-answers">
                    Finds a capability by name and opens it where it lives: the map for a node of
                    the tree, My Setup for an entry of this machine
                  </span>
                </div>
                <div className="docs-action">
                  <span className="docs-cmd">Lenses</span>
                  <span className="docs-answers">
                    Over the map: how it is coloured. Attention is offered once the ledger has
                    recorded something to colour; Authority shows what each reached node may do
                    without asking
                  </span>
                </div>
                <div className="docs-action">
                  <span className="docs-cmd">Share</span>
                  <span className="docs-answers">
                    Copies a link to this exact view: graph, selected node, lens and filter
                  </span>
                </div>
                <div className="docs-action">
                  <span className="docs-cmd">Live</span>
                  <span className="docs-answers">
                    Shown when an engine is attached: the map redraws itself when the graph is
                    rebuilt
                  </span>
                </div>
              </div>

              <h3 className="docs-h3">In the terminal</h3>
              <p className="docs-p docs-muted">
                Everything below is also on this page or under it, and the output is easier to keep.
              </p>
              <div className="docs-list">
                {ACTIONS.map(a => (
                  <div key={a.cmd} className="docs-action">
                    <code className="docs-cmd">{a.cmd}</code>
                    <span className="docs-answers">{a.answers}</span>
                  </div>
                ))}
              </div>
              <h3 className="docs-h3">Start here</h3>
              <p className="docs-p">
                If you only run one, run <code className="docs-cmd-inline">ambit status</code>. It
                answers how the system is doing, what is reached, what is broken, and what is one
                step away.
              </p>
              <p className="docs-p docs-muted">
                Run <code className="docs-cmd-inline">ambit help</code> for CLI definitions in the
                terminal.
              </p>
            </>
          )}

          {tab === 'hotkeys' && (
            <>
              <p className="docs-lede">Everything on the map has a key.</p>
              <div className="docs-list">
                {HOTKEYS.map(h => (
                  <div key={h.key} className="docs-action">
                    <kbd className="docs-kbd">{h.key}</kbd>
                    <span className="docs-answers">{h.desc}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
