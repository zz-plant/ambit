import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import concepts from '../../shared/concepts.json';

/**
 * A house word, defined where it is used.
 *
 * The vocabulary was documented in one place — a twelve-term glossary behind
 * the Docs button — and used in another: the header, the legend and the detail
 * panel all said "reached", "keystone", "maturity" to a reader who had not
 * opened it. A dictionary you must know to consult is not an explanation, so
 * the definition now travels with the word.
 *
 * The text comes from src/shared/concepts.json, the same file the Docs overlay
 * and `ambit help <term>` read, so there is one wording of each definition and
 * no way for this to drift from either.
 */
const BY_KEY = new Map(concepts.concepts.map(c => [c.key, c]));

interface TermProps {
  /** A `key` from concepts.json. An unknown one renders as plain text. */
  name: string;
  /** The word as this sentence needs it — defaults to the glossary's own term. */
  children?: ReactNode;
}

export function Term({ name, children }: TermProps) {
  const concept = BY_KEY.get(name);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();

  // Escape and a click elsewhere close it. Bound only while something is open,
  // so the common case adds no listeners at all.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (!concept) return <>{children ?? name}</>;

  return (
    <span className="term-wrap" ref={wrap}>
      <button
        type="button"
        className="term"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children ?? concept.term}
      </button>
      {open && (
        <span className="term-pop" role="tooltip" id={id}>
          <span className="term-pop-title">{concept.term}</span>
          <span className="term-pop-short">{concept.short}.</span>
          <span className="term-pop-seen">Where you see it: {concept.seen}</span>
        </span>
      )}
    </span>
  );
}

/**
 * The same definition, for an SVG `<title>`.
 *
 * The map's legend and era headers are SVG, where a popover cannot go and the
 * browser's own tooltip can. One sentence rather than three, because a native
 * tooltip is read at a glance.
 */
export function termTitle(name: string, prefix?: string): string | undefined {
  const concept = BY_KEY.get(name);
  if (!concept) return prefix;
  const definition = `${concept.term}: ${concept.short}.`;
  return prefix ? `${prefix} — ${definition}` : definition;
}

export default Term;
