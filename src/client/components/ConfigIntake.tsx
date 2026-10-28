import { useRef, useState } from 'react';
import { useCopied } from '../hooks/useCopied';
import { AGENTS, CONFIG_PATHS, PICKS, useConfigImport } from '../hooks/useConfigImport';

interface ConfigIntakeProps {
  /** Called once a config has been read and drawn. */
  onMapped?: () => void;
  /** Rows for the paste box; the tour card has less room than the landing. */
  rows?: number;
  /** The question over the intake, which the tour words as its own. */
  ask?: string;
}

/**
 * The way a visitor's own setup gets in: the config pasted or picked first,
 * the agent named only to help.
 *
 * The file's shape says whose it is as often as not, and the readout says
 * what it was read as and why, so the paste box is first and costs no
 * answer. Naming the agent still does three things the file cannot: it
 * points at the one file to paste, it names the client a bare `mcpServers`
 * block leaves unnamed, which decides the model the setup is placed with,
 * and for a runtime whose file this tab cannot read, it swaps the box for
 * the servers to tick. Pasting comes first because the files live in
 * hidden directories a file picker will not show by default.
 */
export default function ConfigIntake({ onMapped, rows = 4, ask }: ConfigIntakeProps) {
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
      {ask && <p className="intake-ask">{ask}</p>}
      {showing === 'pick' ? (
        <>
          <ul
            className="intake-picks"
            aria-label={`Servers ${agent?.runtime.name ?? 'your agent'} runs`}
          >
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
            {readable && (
              <button type="button" className="intake-link" onClick={() => setMode('paste')}>
                or paste a config instead
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {agent?.path && (
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
            onTick={() => setMode('pick')}
          />
        </>
      )}
      <fieldset className="intake-agents">
        <legend className="intake-ask">Which agent is it for?</legend>
        <div className="intake-agent-row">
          {AGENTS.map(a => (
            <button
              key={a.runtime.name}
              type="button"
              className="intake-agent"
              aria-pressed={agent?.runtime.name === a.runtime.name}
              onClick={() => setAgent(cur => (cur?.runtime.name === a.runtime.name ? null : a))}
            >
              {a.runtime.name}
            </button>
          ))}
        </div>
      </fieldset>
      {agent && !readable && (
        <p className="intake-note">
          {agent.runtime.name} keeps its config in TOML, which only the CLI reads. Tick what it
          runs, or run the CLI below.
        </p>
      )}
      {error && (
        <p className="intake-error" role="alert">
          {error}
        </p>
      )}
      {/* Every runtime's file, for a visitor whose agent is not listed. */}
      {showing === 'paste' && !agent?.path && (
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
      <p className="intake-note">Read in this tab; nothing is sent.</p>
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
  /** Offered where the tab can swap to the servers to tick. */
  onTick?: () => void;
}

function PasteBox({ text, rows, onText, onRead, onChoose, onTick }: PasteBoxProps) {
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
        {onTick && (
          <button type="button" className="intake-link" onClick={onTick}>
            or tick what it runs
          </button>
        )}
      </div>
    </>
  );
}
