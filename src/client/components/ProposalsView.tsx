import { ProposalsDesk } from './ProposalsDesk';

/**
 * Proposals, as a view: what an agent wants changed, waiting on the one
 * decision only a person can make. The address bar names it, `g` and `]`
 * reach it, and the desk it draws is the one the demo's modal narrates.
 */
export default function ProposalsView() {
  return (
    <div className="proposals-view">
      <div className="proposals-inner">
        <div className="proposals-head">
          <h1 className="setup-title">Proposals</h1>
          <p className="setup-subtitle">
            Changes an agent wants to make to your setup. Nothing is applied until you approve it,
            and applying is a command you run.
          </p>
        </div>
        <ProposalsDesk />
      </div>
    </div>
  );
}
