/**
 * The map's one sentence: what is broken, then what to reach next.
 *
 * Sits where the simulation banner sits, and gives way to it, since a running
 * simulation is its own sentence. Hidden while a node is selected: the panel
 * is then the thing being read.
 */
import type { Item } from '../../utils/configImporter';
import { costOf, type MapFindings } from './layout';

interface MapFindingProps {
  findings: MapFindings;
  onShow: (id: string) => void;
  onPreview: (id: string) => void;
  leftInset?: number;
  rightInset?: number;
}

const names = (list: Item[]) =>
  list.length <= 2
    ? list.map(i => i.name).join(' and ')
    : `${list[0].name}, ${list[1].name} and ${list.length - 2} more`;

export function MapFinding({
  findings,
  onShow,
  onPreview,
  leftInset = 0,
  rightInset = 0,
}: MapFindingProps) {
  const { failing, best } = findings;
  if (!failing.length && !best) return null;
  const cost = best ? costOf(best.item) : '';
  return (
    <div
      className="civ-sim-wrap civ-finding-wrap"
      style={{ paddingLeft: 12 + leftInset, paddingRight: 12 + rightInset }}
    >
      {failing.length > 0 ? (
        <div role="status" className="civ-finding civ-finding--bad">
          <span className="civ-finding-dot" aria-hidden="true">
            !
          </span>
          <span>
            <strong>{names(failing)}</strong> {failing.length === 1 ? 'is' : 'are'} configured but
            failing {failing.length === 1 ? 'its check' : 'their checks'}.
          </span>
          <button type="button" className="civ-finding-btn" onClick={() => onShow(failing[0].id)}>
            Show
          </button>
        </div>
      ) : best ? (
        <div role="status" className="civ-finding">
          <span>
            Best next step: <strong>{best.item.name}</strong>
            {cost ? ` · ${cost} of setup` : ''}
            {best.reaches ? ` · reaches ${best.reaches} more` : ''}
          </span>
          <button type="button" className="civ-finding-btn" onClick={() => onPreview(best.item.id)}>
            Preview
          </button>
        </div>
      ) : null}
    </div>
  );
}
