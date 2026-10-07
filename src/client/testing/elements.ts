/**
 * The component tests' hand on a drawing. The suite has no DOM, so a
 * component with a hook-free view is called as a function, and a test finds
 * the element it wants in what comes back and calls the handler that element
 * carries: a key pressed on a dialog, a click on a button, a change on a range.
 */
import type { ReactElement, ReactNode } from 'react';

export type Props = Record<string, any>;

/** Every element in a tree of elements that satisfies `match`, in document order. */
export function findAll(
  node: ReactNode,
  match: (el: ReactElement<Props>) => boolean,
  out: ReactElement<Props>[] = []
): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, match, out);
  } else if (node && typeof node === 'object' && 'props' in node) {
    const el = node as ReactElement<Props>;
    if (match(el)) out.push(el);
    findAll(el.props?.children, match, out);
  }
  return out;
}
