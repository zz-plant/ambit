import { useDialogFocus } from '../hooks/useDialogFocus';
import { trapTab } from '../utils/keys';
import { ProposalsDesk } from './ProposalsDesk';

/**
 * The approval gate as the demo's tour narrates it, over the map: the same
 * decisions, in the same drawing the Proposals view shows, held in a dialog
 * so the tour's card can point at them. The decisions live in one body, so
 * the narration and the page can never disagree about what approving does.
 */
export function ApprovalModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const dialog = useDialogFocus<HTMLDivElement>(isOpen);

  if (!isOpen) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click to dismiss modal
    <div className="uplink-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="uplink-modal"
        ref={dialog}
        tabIndex={-1}
        style={{ maxWidth: '680px', width: '100%' }}
        onClick={e => e.stopPropagation()}
        // Escape closes it from wherever the focus is inside it. Dismissal was
        // a click on the backdrop, and then a document listener this handler
        // hid: the key never reached it once anything inside had been clicked.
        // Every key stops here, so the map behind does not move under it, and
        // Tab comes round inside it.
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          else trapTab(e, document.activeElement);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposals-title"
      >
        <div className="sp-hdr">
          <div className="sp-title-group">
            <h2 id="proposals-title" className="sp-designation">
              Proposals
            </h2>
            <div className="sp-class">
              Changes an agent wants to make to your setup. Nothing is applied until you approve it,
              and applying is a command you run.
            </div>
          </div>
          <button type="button" className="sp-close" onClick={onClose} aria-label="Close proposals">
            ✕
          </button>
        </div>

        <ProposalsDesk />
      </div>
    </div>
  );
}

export default ApprovalModal;
