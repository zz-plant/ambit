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
  { id: 'reading', label: 'Reading the map' },
  { id: 'doing', label: 'What you can do' },
  { id: 'hotkeys', label: 'Shortcuts' },
];

const HOTKEYS = [
  {
    key: '/',
    desc: 'Find a capability, on the map or in your setup, or run an action on it: an outage, an unlock, its check, a lens, Proposals',
  },
  { key: 'J / K', desc: 'Step through the nodes on the map, skipping any a focus hides' },
  { key: '1 / 2 / 3', desc: 'Switch lens: Standard, Attention, Authority' },
  { key: '+ / -', desc: 'Zoom in / out on the map' },
  { key: '0', desc: 'Back to actual size' },
  { key: 'G', desc: 'Open proposals' },
  { key: '?', desc: 'Open this guide' },
  {
    key: 'Esc',
    desc: 'Close one thing a press: this guide, Proposals or search first, then a highlight, a simulation, and last the selection',
  },
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
    answers: 'What is reached, what is verified, what is failing, and what rests on one provider',
  },
  { cmd: 'ambit verify', answers: "Run each capability's check and record the result" },
  {
    cmd: 'ambit authority',
    answers: 'What an agent may do without asking, and what needs a person',
  },
  {
    cmd: 'ambit goal "<intent>"',
    answers: 'Describe a goal in plain words and get the capabilities it needs',
  },
  {
    cmd: 'ambit opportunities',
    answers: 'What to set up next, ranked by how much of your time it would save',
  },
  {
    cmd: 'ambit impact <id>',
    answers: 'What stops working if a tool or credential goes away',
  },
  {
    cmd: 'ambit propose <cap>',
    answers: 'Write a change down as a proposal for a person to approve',
  },
  { cmd: 'ambit approve / apply', answers: 'Sign an approval, then apply the change it covers' },
];

export default function DocsModal({ isOpen, onClose, initialTab }: DocsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'concepts');

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  if (!isOpen) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click to dismiss modal
    <div className="docs-overlay" onClick={onClose} role="presentation">
      <div
        className="docs-panel"
        onClick={e => e.stopPropagation()}
        // Escape closes it from inside; from outside, the shell's Escape
        // closes it first. It used to listen on the document as well, so one
        // press closed it and cleared the selection behind it.
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
        role="dialog"
        aria-modal="true"
      >
        <div className="docs-header">
          <div className="docs-title-wrap">
            <div>
              <h2 className="docs-title">Guide</h2>
              <p className="docs-subtitle">What the map shows, and what you can do with it</p>
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
                The {concepts.concepts.length} words the map and the CLI use, in the order you meet
                them.
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
                Each column is an era, from the foundations on the left to what depends on them on
                the right.
              </p>
              <h3 className="docs-h3">The circles</h3>
              <div className="docs-list">
                {NODE_TYPES.map(n => (
                  <div key={n.label} className="docs-row">
                    <span className="docs-swatch" style={{ background: typeColor(n.type) }}>
                      {n.sym}
                    </span>
                    <span>
                      <strong>{n.label}</strong>: {n.desc}
                    </span>
                  </div>
                ))}
              </div>

              {/* One section for the three states, in the legend's order. It
                  was two: "Solid vs outlined" and, further down, "The states",
                  saying the same thing about the same circles. */}
              <h3 className="docs-h3">Filled, outlined, dashed</h3>
              <p className="docs-p">
                A filled circle is reached. An outlined one is a next step: its prerequisites are
                met, and its setup cost sits beside it. A dashed one is blocked, with a prerequisite
                missing.
              </p>

              <h3 className="docs-h3">The lines</h3>
              <div className="docs-list">
                <div className="docs-row">
                  <span className="docs-line-solid" />
                  <span>
                    <strong>Required</strong>: without it the dependent capability cannot work
                  </span>
                </div>
                <div className="docs-row">
                  <span className="docs-line-dashed" />
                  <span>
                    <strong>Optional</strong>: helps, but does not gate
                  </span>
                </div>
              </div>
              <p className="docs-p docs-muted">
                The data model and the CLI call these hard and soft prerequisites.
              </p>

              <h3 className="docs-h3">Which way an edge runs</h3>
              <p className="docs-p">
                Select a node and its edges are drawn apart: what it needs in violet, what it
                enables in blue, one hop each way. The simulations follow the edges all the way.
              </p>

              <h3 className="docs-h3">The minimap</h3>
              <p className="docs-p">
                When the map is bigger than the window, a thumbnail at the bottom right shows all of
                it: a dot for every node, the failing ones in red, and the part on screen outlined.
                Drag the outline to move around, or tab to it and use the arrow keys, with Shift for
                a screen at a time. It is not drawn when the whole map fits, and the line over the
                map says which way a failing node lies when it is out of sight.
              </p>

              <h3 className="docs-h3">The map and My Setup</h3>
              <p className="docs-p">
                <strong>The map</strong> is the curated tree with your position on it.{' '}
                <strong>My Setup</strong> is what was found in your agent configs, one row per
                entry, each with what its latest check said, a strip of how the last fourteen checks
                went (a failure is taller than a pass), and the nodes on the map it provides. A tool
                server your config names also has a switch, which writes <code>enabled</code> to
                that config. On the map, rows in a column are ordered so a node sits near what it
                connects to; height on its own means nothing there.
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
                    What depends on it, whether its check passes, and a simulation: an outage for a
                    node you have, what it would unlock for one you do not
                  </span>
                </div>
                <div className="docs-action">
                  <span className="docs-cmd">Click an era</span>
                  <span className="docs-answers">
                    Opens its ladder: how far up the era you are, then each node as reached, a next
                    step with its setup time, or blocked with what it waits for. A node whose check
                    is failing is listed as failing, and is not counted as reached
                  </span>
                </div>
                <div className="docs-action">
                  <span className="docs-cmd">Focus</span>
                  <span className="docs-answers">
                    In the panel of a selected node: keeps only what it needs and enables within a
                    few hops, and hides the rest. Choose which way and how far, and the pill says
                    how many nodes are hidden and brings them back. Esc ends it. It is off unless
                    you ask, and the header still counts the whole map
                  </span>
                </div>
                <div className="docs-action">
                  <span className="docs-cmd">Click a legend key</span>
                  <span className="docs-answers">
                    Highlights only that kind: keystones, failing checks, next steps. The counts in
                    the header do the same. Esc clears it
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
                  <span className="docs-cmd">Audit</span>
                  <span className="docs-answers">
                    Who approved what and what ran, one line per event, newest first. Narrow it with
                    actor:, action: and target:, or any word
                  </span>
                </div>
                <div className="docs-action">
                  <span className="docs-cmd">Timeline</span>
                  <span className="docs-answers">
                    Under the map, once two observations are recorded. Drag the playhead or step it
                    with the arrow keys, and the map redraws as that observation left it, with
                    today's names and edges. Lenses and simulations wait for now
                  </span>
                </div>
                <div className="docs-action">
                  <span className="docs-cmd">Share</span>
                  <span className="docs-answers">
                    Copies a link to this exact view: graph, selected node, lens, filter, focus and
                    the moment the timeline is on
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
                The same answers from the CLI, as text you can keep or pipe.
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
              <p className="docs-lede">These work anywhere on the page, except while typing.</p>
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
