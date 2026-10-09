import { useRef, useState } from 'react';
import { CONFIG_PATHS, PICKS, useConfigImport } from '../hooks/useConfigImport';

interface ConfigIntakeProps {
  /** Called once a config has been read and drawn. */
  onMapped?: () => void;
  /** Rows for the paste box; the tour card has less room than the landing. */
  rows?: number;
}

/**
 * The way a visitor's own setup gets in: paste it, or pick the file, with the
 * path each runtime keeps it at one click away. Pasting comes first because
 * the files live in hidden directories a file picker will not show by
 * default, and a person who has to hunt for one leaves. Beside it, the
 * servers people most often run, to tick: a visitor on a phone, or one who
 * would sooner not open a dotfile for a demo, still sees their own map.
 */
export default function ConfigIntake({ onMapped, rows = 4 }: ConfigIntakeProps) {
  const { readText, readFile, readPicked, error } = useConfigImport(onMapped);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'paste' | 'pick'>('paste');
  const [picked, setPicked] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const toggle = (server: string) =>
    setPicked(p => (p.includes(server) ? p.filter(s => s !== server) : [...p, server]));

  return (
    <div className="intake">
      <div className="intake-modes">
        <button
          type="button"
          className="intake-mode"
          aria-pressed={mode === 'paste'}
          onClick={() => setMode('paste')}
        >
          Paste a config
        </button>
        <button
          type="button"
          className="intake-mode"
          aria-pressed={mode === 'pick'}
          onClick={() => setMode('pick')}
        >
          Pick what you use
        </button>
      </div>
      {mode === 'pick' ? (
        <>
          <ul className="intake-picks" aria-label="Servers your agent runs">
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
        <PasteBox
          text={text}
          rows={rows}
          onText={setText}
          onRead={() => readText(text)}
          onChoose={() => fileInput.current?.click()}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json,.jsonc"
        aria-label="Choose an agent config file to map"
        className="visually-hidden"
        onChange={e => readFile(e.target.files?.[0])}
      />
      {error && (
        <p className="intake-error" role="alert">
          {error}
        </p>
      )}
      {mode === 'paste' && (
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
        {mode === 'pick'
          ? 'Placed in this tab; nothing is sent.'
          : 'Read in this tab and never uploaded.'}
      </p>
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
