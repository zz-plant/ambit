import { useState } from 'react';
import concepts from '../../shared/concepts.json';

interface DocsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'concepts' | 'reading' | 'doing' | 'hotkeys';

const TABS: { id: Tab; label: string }[] = [
  { id: 'concepts', label: 'Concepts' },
  { id: 'reading', label: 'Reading the Map' },
  { id: 'doing', label: 'Common Actions' },
  { id: 'hotkeys', label: 'Shortcuts' },
];

const HOTKEYS = [
  { key: '/', desc: 'Search capabilities in the sidebar' },
  { key: '\\', desc: 'Toggle capabilities sidebar' },
  { key: 'J / K', desc: 'Navigate up / down through capabilities' },
  { key: '1 - 3', desc: 'Switch graph lens (1: Standard, 2: Attention, 3: SPOFs)' },
  { key: '+ / -', desc: 'Zoom in / out on the canvas' },
  { key: '0', desc: 'Reset zoom to 100%' },
  { key: 'G', desc: 'Open Proposals & Governance modal' },
  { key: '?', desc: 'Open Documentation & Concept guide' },
  { key: 'ESC', desc: 'Clear selection or close active modal' },
];

const NODE_TYPES = [
  { color: 'var(--accent)', sym: '★', label: 'Framework', desc: 'The agent runtime itself' },
  { color: '#f59e0b', sym: '◈', label: 'MCP server', desc: 'A tool the agent can call' },
  { color: '#ec4899', sym: '◆', label: 'Agent', desc: 'A subagent with its own prompt and model' },
  { color: '#10b981', sym: '◇', label: 'Skill', desc: 'A procedure loaded on demand' },
  { color: '#0284c7', sym: '⬢', label: 'Provider / model', desc: 'Where inference happens' },
  {
    color: '#8b5cf6',
    sym: '●',
    label: 'Tech tree node',
    desc: 'A capability you reach by having others',
  },
];

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

export default function DocsModal({ isOpen, onClose }: DocsModalProps) {
  const [tab, setTab] = useState<Tab>('concepts');
  if (!isOpen) return null;

  return (
    <div className="docs-overlay" onClick={onClose}>
      <div className="docs-panel" onClick={e => e.stopPropagation()}>
        <div className="docs-header">
          <div>
            <h2 className="docs-title">How to read this</h2>
            <p className="docs-subtitle">Your setup, placed on a tree of agent capabilities</p>
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
                Nine terms carry all the meaning here. Everything the tool says is built from them.
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
              {NODE_TYPES.map(n => (
                <div key={n.label} className="docs-row">
                  <span className="docs-swatch" style={{ background: n.color }}>
                    {n.sym}
                  </span>
                  <span>
                    <strong>{n.label}</strong> — {n.desc}
                  </span>
                </div>
              ))}

              <h3 className="docs-h3">Solid vs outlined</h3>
              <p className="docs-p">
                A solid circle is something you have. An outlined one is a capability you have not
                reached — its description tells you what is missing or what to add.
              </p>

              <h3 className="docs-h3">The lines</h3>
              <div className="docs-row">
                <span className="docs-line-solid" />
                <span>
                  <strong>Hard prerequisite</strong> — required; without it the dependent capability
                  cannot work
                </span>
              </div>
              <div className="docs-row">
                <span className="docs-line-dashed" />
                <span>
                  <strong>Soft prerequisite</strong> — helps, but does not gate
                </span>
              </div>

              <h3 className="docs-h3">The states</h3>
              <p className="docs-p">
                Filled circles are reached capabilities. Outlined circles are not yet reached; the
                halo marks what you could take next, with its setup cost beside it.
              </p>

              <h3 className="docs-h3">Two sources</h3>
              <p className="docs-p">
                <strong>CONFIG</strong> shows your <code>opencode.json</code> as a graph.{' '}
                <strong>TECH TREE</strong> shows the curated capability tree with your position on
                it. Same renderer, different question.
              </p>
            </>
          )}

          {tab === 'doing' && (
            <>
              <p className="docs-lede">
                Click any circle to see what depends on it. Everything below is also available in
                the terminal, where the output is easier to keep.
              </p>
              {ACTIONS.map(a => (
                <div key={a.cmd} className="docs-action">
                  <code className="docs-cmd">{a.cmd}</code>
                  <span className="docs-answers">{a.answers}</span>
                </div>
              ))}
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
              <p className="docs-lede">
                Operate Ambit entirely from your keyboard with demoscene-speed shortcuts.
              </p>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}
              >
                {HOTKEYS.map(h => (
                  <div key={h.key} className="docs-action" style={{ alignItems: 'center' }}>
                    <kbd
                      style={{
                        fontFamily: 'var(--font)',
                        fontWeight: 800,
                        color: 'var(--accent)',
                        background: 'var(--bg-deep)',
                        border: '1px solid var(--border-bright)',
                        borderRadius: 'var(--radius-xs)',
                        padding: '3px 8px',
                        fontSize: '11px',
                        minWidth: '60px',
                        textAlign: 'center',
                      }}
                    >
                      {h.key}
                    </kbd>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {h.desc}
                    </span>
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
