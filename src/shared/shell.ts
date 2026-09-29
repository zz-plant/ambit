/**
 * A word made safe to put in a command a person will paste.
 *
 * Ambit prints commands for someone to type: the page copies `ambit verify
 * <id>`, `ambit status` ends on one, a dispatch message says how to approve.
 * Most ids are ones the shipped tree wrote (`combo:shell-execution`) or the
 * engine minted (`prop-…`), and those pass through unchanged. Others are not:
 * an agent registers a skill under any name it likes, and a sync file carries
 * whatever ids its author chose. An id such as `skill:x$(rm -rf ~)` pasted
 * into a terminal is a command that runs on whoever pasted it, which is the
 * one thing a file that travels must never be (rule 7).
 *
 * So every id goes through here on its way into a command. A word made only of
 * characters no shell treats specially is left as it is, so the usual command
 * reads as it always did. Anything else is wrapped in single quotes, inside
 * which a POSIX shell gives nothing a meaning, and a single quote in the word
 * is closed, escaped and reopened. The result is one word to the shell and
 * exactly the original string to the program that receives it.
 */
const PLAIN = /^[A-Za-z0-9_.:/@+=,%-]+$/;

export function shellQuote(word: string): string {
  if (PLAIN.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}
