/**
 * Whether an answer says the call did not work.
 *
 * The engine reports a call it cannot answer as `{ error: '...' }`, and always
 * has: it is what the CLI prints and what the tests assert. Two surfaces have
 * to act on that, and each used to leave the reading to its caller. A command
 * that failed still exited 0, so `ambit sync && next` ran `next` after a usage
 * error, and over MCP the failure arrived as an ordinary success whose text
 * happened to contain the word, so a client had no field to branch on and a
 * model had to notice.
 *
 * One rule decides it for both, here so it cannot become two: a top-level
 * string `error`. An `error` nested inside a report, one failing check among
 * many or one id refused in a batch, is part of an answer that otherwise
 * stands, and does not count.
 */
export function isFailure(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}
