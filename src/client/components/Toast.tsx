interface ToastProps {
  message: string;
  onDismiss: () => void;
  /** Offered when the notice is an approval, so the receipt is one click away. */
  onViewProposals: () => void;
}

/** A transient notice from the graph stream, with its actions. */
export default function Toast({ message, onDismiss, onViewProposals }: ToastProps) {
  return (
    <div role="status" className="ambit-toast">
      <span>{message}</span>
      <div className="ambit-toast-actions">
        {message.startsWith('Approved ') && (
          <button
            type="button"
            className="tp-btn-sm"
            onClick={e => {
              e.stopPropagation();
              onViewProposals();
            }}
          >
            Open proposals
          </button>
        )}
        <button
          type="button"
          className="tp-btn-sm"
          onClick={e => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
