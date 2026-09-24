import { useRef, useState } from 'react';
import { CONFIG_PATHS, useConfigImport } from '../hooks/useConfigImport';

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
 * default, and a person who has to hunt for one leaves.
 */
export default function ConfigIntake({ onMapped, rows = 4 }: ConfigIntakeProps) {
  const { readText, readFile, error } = useConfigImport(onMapped);
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="intake">
      <textarea
        className="intake-paste"
        rows={rows}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={'Paste a config here: {"mcpServers": { … }}'}
        aria-label="Paste an agent config"
        spellCheck={false}
      />
      <div className="intake-actions">
        <button
          type="button"
          className="intake-btn"
          disabled={!text.trim()}
          onClick={() => readText(text)}
        >
          Map it
        </button>
        <button type="button" className="intake-link" onClick={() => fileInput.current?.click()}>
          or choose the file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Choose an agent config file to map"
          className="visually-hidden"
          onChange={e => readFile(e.target.files?.[0])}
        />
      </div>
      {error && (
        <p className="intake-error" role="alert">
          {error}
        </p>
      )}
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
      <p className="intake-note">Read in this tab and never uploaded.</p>
    </div>
  );
}
