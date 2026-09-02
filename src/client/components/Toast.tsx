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
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px', justifyContent: 'flex-end' }}>
        {message.includes('Approved:') && (
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
