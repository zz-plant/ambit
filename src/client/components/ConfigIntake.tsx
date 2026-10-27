import { useRef, useState } from 'react';
import { useCopied } from '../hooks/useCopied';
import { AGENTS, CONFIG_PATHS, PICKS, useConfigImport } from '../hooks/useConfigImport';

interface ConfigIntakeProps {
  /** Called once a config has been read and drawn. */
  onMapped?: () => void;
  /** Rows for the paste box; the tour card has less room than the landing. */
  rows?: number;
  /** The question over the agents, which the tour words as its own. */
  ask?: string;
}

/**
 * The way a visitor's own setup gets in, asking first which agent they use.
 *
 * The agent decides what the setup is placed with (the model it runs on), the
 * one file to paste, and whether the tab can read that file at all, so it is
 * the first question and costs one press. Then the file, pasted or picked, or
 * the servers people most often run, to tick: a visitor on a phone, or one who
 * would sooner not open a dotfile for a demo, still sees their own map.
 * Pasting comes first because the files live in hidden directories a file
 * picker will not show by default.
 */
export default function ConfigIntake({
  onMapped,
  rows = 4,
  ask = 'Which agent do you use?',
}: ConfigIntakeProps) {
  const [agent, setAgent] = useState<(typeof AGENTS)[number] | null>(null);
  const { readText, readFile, readPicked, error } = useConfigImport(onMapped, agent?.runtime);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'paste' | 'pick'>('paste');
  const [picked, setPicked] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, copy] = useCopied();
  const toggle = (server: string) =>
    setPicked(p => (p.includes(server) ? p.filter(s => s !== server) : [...p, server]));
  // An agent whose file the tab cannot read is offered the servers to tick.
  const readable = !agent || agent.path !== undefined || agent.runtime.id === null;
  const showing = readable ? mode : 'pick';

  return (
    <div className="intake">
      <fieldset className="intake-agents">
        <legend className="intake-ask">{ask}</legend>
        <div className="intake-agent-row">
          {AGENTS.map(a => (
            <button
              key={a.runtime.name}
              type="button"
              className="intake-agent"
              aria-pressed={agent?.runtime.name === a.runtime.name}
              onClick={() => setAgent(a)}
            >
              {a.runtime.name}
            </button>
          ))}
        </div>
      </fieldset>
      {agent && (
        <>
          {readable ? (
            <div className="intake-modes">
              <button
                type="button"
                className="intake-mode"
                aria-pressed={mode === 'paste'}
                onClick={() => setMode('paste')}
              >
                Paste its config
              </button>
              <button
                type="button"
                className="intake-mode"
                aria-pressed={mode === 'pick'}
                onClick={() => setMode('pick')}
              >
                Tick what it runs
              </button>
            </div>
          ) : (
            <p className="intake-note">
              {agent.runtime.name} keeps its config in TOML, which only the CLI reads. Tick what it
              runs, or run the CLI below.
            </p>
          )}
          {showing === 'pick' ? (
            <>
              <ul className="intake-picks" aria-label={`Servers ${agent.runtime.name} runs`}>
                {PICKS.map(p => (
                  <li key={p.server}>
                    <button
                      type="button"
                      className="intake-pick"
                      aria-pressed={picked.includes(p.server)}
                      onClick={() => toggle(p.server)}
                    >
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="intake-actions">
                <button
                  type="button"
                  className="intake-btn"
                  disabled={!picked.length}
                  onClick={() => readPicked(picked)}
                >
                  Map {picked.length ? `these ${picked.length}` : 'them'}
                </button>
              </div>
            </>
          ) : (
            <>
              {agent.path && (
                <div className="intake-path">
                  <code>{agent.path}</code>
                  <button
                    type="button"
                    onClick={() => copy('path', agent.path as string)}
                    aria-label={`Copy the path to ${agent.runtime.name}'s config`}
                  >
                    {copied === 'path' ? 'Copied ✓' : 'Copy path'}
                  </button>
                </div>
              )}
              <PasteBox
                text={text}
                rows={rows}
                onText={setText}
                onRead={() => readText(text)}
                onChoose={() => fileInput.current?.click()}
              />
            </>
          )}
          {error && (
            <p className="intake-error" role="alert">
              {error}
            </p>
          )}
          {/* Every runtime's file, for a visitor whose agent is not listed. */}
          {showing === 'paste' && !agent.path && (
            <details className="intake-where">
              <summary>Where is mine?</summary>
              <dl>
                {CONFIG_PATHS.map(p => (
                  <div key={p.runtime}>
                    <dt>{p.runtime}</dt>
                    <dd>
                      <code>{p.path}</code>
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <p className="intake-note">
            {showing === 'pick'
              ? 'Placed in this tab; nothing is sent.'
              : 'Read in this tab and never uploaded.'}
          </p>
        </>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json,.jsonc"
        aria-label="Choose an agent config file to map"
        className="visually-hidden"
        onChange={e => readFile(e.target.files?.[0])}
      />
    </div>
  );
}

interface PasteBoxProps {
  text: string;
  rows: number;
  onText: (text: string) => void;
  onRead: () => void;
  onChoose: () => void;
}

function PasteBox({ text, rows, onText, onRead, onChoose }: PasteBoxProps) {
  return (
    <>
      <textarea
        className="intake-paste"
        rows={rows}
        value={text}
        onChange={e => onText(e.target.value)}
        placeholder={'Paste a config here: {"mcpServers": { … }}'}
        aria-label="Paste an agent config"
        spellCheck={false}
      />
      <div className="intake-actions">
        <button type="button" className="intake-btn" disabled={!text.trim()} onClick={onRead}>
          Map it
        </button>
        <button type="button" className="intake-link" onClick={onChoose}>
          or choose the file
        </button>
      </div>
    </>
  );
}
