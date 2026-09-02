interface ToastProps {
  message: string;
  onDismiss: () => void;
  /** Offered when the notice is an approval, so the receipt is one click away. */
  onViewGovernance: () => void;
}

/** A transient notice from the graph stream, with its actions. */
export default function Toast({ message, onDismiss, onViewGovernance }: ToastProps) {
  return (
    <div role="status" className="ambit-toast">
      <span>{message}</span>
      <div style={{ display: 'flex', gap: '6px', marginTop: '6px', justifyContent: 'flex-end' }}>
        {message.includes('Approved:') && (
          <button
            type="button"
            className="tp-btn-sm"
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              color: 'var(--ok)',
              borderColor: 'var(--ok)',
            }}
            onClick={e => {
              e.stopPropagation();
              onViewGovernance();
            }}
          >
            View Governance
          </button>
        )}
        <button
          type="button"
          className="tp-btn-sm"
          style={{ fontSize: '10px', padding: '2px 8px' }}
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
