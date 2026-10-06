import { useCopied } from '../hooks/useCopied';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { INSTALL } from '../utils/copy';
import { trapTab } from '../utils/keys';
import ConfigIntake from './ConfigIntake';
import { Term } from './Term';

/**
 * The two ways a visitor's own setup gets onto the map: paste a config, read
 * in the tab, or install the CLI, which reads every runtime on the machine.
 * The tour's last card and the header's Map yours both show it, so the two
 * say the same thing in the same order.
 */
export function YourSetup({ onMapped, rows = 3 }: { onMapped: () => void; rows?: number }) {
  const [copied, copy] = useCopied();
  return (
    <div className="app-tour-yours">
      <ConfigIntake onMapped={onMapped} rows={rows} />
      <div className="app-tour-install">
        <code>{INSTALL}</code>
        <button type="button" onClick={() => copy('install', INSTALL)}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <p className="app-tour-note">
        The install reads every runtime on the machine and places it on the full map.
      </p>
    </div>
  );
}

interface MapYoursDialogProps {
  open: boolean;
  onClose: () => void;
  /** A config was read; what to show next is the caller's. */
  onMapped: () => void;
}

/**
 * Map yours, from the header of the sample: what Ambit is, in a sentence, and
 * the way in. The tour's first card was the only place the page said what it
 * was for, so a visitor who skipped it never read it.
 */
export default function MapYoursDialog({ open, onClose, onMapped }: MapYoursDialogProps) {
  const dialog = useDialogFocus<HTMLDivElement>(open);
  if (!open) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click to dismiss modal
    <div className="docs-overlay" onClick={onClose} role="presentation">
      <div
        className="docs-panel map-yours"
        ref={dialog}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          else trapTab(e, document.activeElement);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-yours-title"
      >
        <div className="docs-header">
          <div>
            <h2 id="map-yours-title" className="docs-title">
              Map your own setup
            </h2>
            <p className="docs-subtitle">
              What your agents can do together is your <Term name="ambit">ambit</Term>. Ambit reads
              their configs, draws it, and ranks what to set up next by what it would open.
            </p>
          </div>
          <button type="button" className="docs-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="map-yours-body">
          <YourSetup onMapped={onMapped} rows={4} />
        </div>
      </div>
    </div>
  );
}
