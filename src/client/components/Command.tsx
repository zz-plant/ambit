import { Fragment } from 'react';

/**
 * A command as a person will paste it, set so a line breaks only at its
 * spaces. A hyphen is a place a browser may break a line, so
 * `combo:browser-automation` broke after "browser-" and read as two ids in
 * every screenshot of a narrow panel. What is copied is the caller's string,
 * never this markup.
 */
export function Command({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((token, i) => (
        // A command's words repeat ("ambit … ambit") and keep their order, so the index is the key.
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="cmd-token">{token}</span>
        </Fragment>
      ))}
    </>
  );
}
