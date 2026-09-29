/**
 * Each dialog has a name, and takes the focus itself.
 *
 * The docs dialog had no accessible name, so a screen reader announced "dialog"
 * and nothing else. Proposals and the docs take the focus on their own element
 * when they open (tabIndex -1), which is what lets Tab start inside them; the
 * moving of the focus is an effect, which the browser check holds.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import ApprovalModal from './ApprovalModal';
import DocsModal from './DocsModal';

/** The dialog element's opening tag, and the text of what its label points at. */
function dialogOf(html: string) {
  const tag = html.match(/<div[^>]*role="dialog"[^>]*>/)?.[0] ?? '';
  const labelledBy = tag.match(/aria-labelledby="([^"]+)"/)?.[1];
  const label = labelledBy
    ? html
        .match(new RegExp(`id="${labelledBy}"[^>]*>([\\s\\S]*?)<\\/`))?.[1]
        ?.replace(/<[^>]+>/g, '')
        .trim()
    : undefined;
  return { tag, label };
}

test('the docs dialog is named by its title, and takes the focus itself', () => {
  const { tag, label } = dialogOf(renderToStaticMarkup(<DocsModal isOpen onClose={() => {}} />));
  expect(label).toBe('Guide');
  expect(tag).toContain('tabindex="-1"');
  expect(tag).toContain('aria-modal="true"');
});

test('the proposals dialog is named by its title, and takes the focus itself', () => {
  const { tag, label } = dialogOf(
    renderToStaticMarkup(<ApprovalModal isOpen onClose={() => {}} />)
  );
  expect(label).toBe('Proposals');
  expect(tag).toContain('tabindex="-1"');
});

test('a closed dialog draws nothing to take the focus', () => {
  expect(renderToStaticMarkup(<DocsModal isOpen={false} onClose={() => {}} />)).toBe('');
  expect(renderToStaticMarkup(<ApprovalModal isOpen={false} onClose={() => {}} />)).toBe('');
});
