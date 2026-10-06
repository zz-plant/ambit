/**
 * An edit to a JSON or JSONC file that changes only the member it names.
 *
 * `ambit apply` used to parse the config, assign the entry and write the whole
 * object back with `JSON.stringify`. A file with comments, which OpenCode
 * reads and `ambit seed` reads, was refused outright, since plain JSON could
 * not parse it; and a plain file came back reformatted, so the rollback that
 * removed the entry again left a file with the same content and different
 * bytes. Splicing the member into the text in place keeps every comment, every
 * blank line and the file's own indentation, and removing what was spliced in
 * gives back the bytes that were there before.
 *
 * Two operations, over a path of object keys: set a member, creating the
 * objects on the way when they are missing, and remove one. Arrays are never
 * entered: a config section is an object, and nothing apply writes is
 * addressed by index.
 */

interface Member {
  key: string;
  /** Where the member's quoted key starts. */
  keyStart: number;
  valueStart: number;
  valueEnd: number;
}

interface ObjectSpan {
  open: number;
  close: number;
  members: Member[];
}

/** A comma ending its line after a value, and any comment after it on that line. */
const TRAILING = /^[ \t]*,[ \t]*(?:\/\/[^\r\n]*|\/\*[^\r\n]*?\*\/)?[ \t]*(?=\r?\n)/;

/** The index of the first character at or after `i` that is not space or a comment. */
function skip(text: string, i: number): number {
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
    else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else break;
  }
  return i;
}

/** The index just past the string that opens at `i`. */
function stringEnd(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
  return j + 1;
}

/** The index just past the value that starts at `i`. */
function valueEnd(text: string, i: number): number {
  const c = text[i];
  if (c === '"') return stringEnd(text, i);
  if (c === '{' || c === '[') {
    const close = c === '{' ? '}' : ']';
    let j = skip(text, i + 1);
    while (j < text.length && text[j] !== close) {
      if (text[j] === ',') {
        j = skip(text, j + 1);
        continue;
      }
      j = valueEnd(text, j);
      j = skip(text, j);
      if (c === '{' && text[j] === ':') j = skip(text, valueEnd(text, skip(text, j + 1)));
    }
    return j + 1;
  }
  // A number, true, false or null: it ends where punctuation, space or a
  // comment begins.
  let j = i;
  while (j < text.length && !/[\s,}\]/]/.test(text[j])) j++;
  return j;
}

/** The members of the object whose `{` is at `open`. */
function objectAt(text: string, open: number): ObjectSpan {
  const members: Member[] = [];
  let i = skip(text, open + 1);
  while (i < text.length && text[i] !== '}') {
    if (text[i] === ',') {
      i = skip(text, i + 1);
      continue;
    }
    if (text[i] !== '"') throw new Error(`Expected a key at offset ${i}`);
    const keyStart = i;
    const keyEnd = stringEnd(text, i);
    const key = JSON.parse(text.slice(keyStart, keyEnd));
    i = skip(text, keyEnd);
    if (text[i] !== ':') throw new Error(`Expected ":" at offset ${i}`);
    const valueStart = skip(text, i + 1);
    const end = valueEnd(text, valueStart);
    members.push({ key, keyStart, valueStart, valueEnd: end });
    i = skip(text, end);
  }
  if (text[i] !== '}') throw new Error('Unterminated object');
  return { open, close: i, members };
}

function rootObject(text: string): ObjectSpan {
  const open = skip(text, 0);
  if (text[open] !== '{') throw new Error('The file is not a JSON object');
  return objectAt(text, open);
}

/** The whitespace a line starts with, for the line holding `i`. */
function lineIndent(text: string, i: number): string {
  const start = text.lastIndexOf('\n', i - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start))![0];
}

/** One level of the file's own indentation: a tab, or its smallest run of spaces. */
function indentUnit(text: string): string {
  if (/\n\t/.test(text)) return '\t';
  const widths = [...text.matchAll(/\n( +)\S/g)].map(m => m[1].length);
  return ' '.repeat(widths.length ? Math.min(...widths) : 2);
}

/** A value written at `indent`, its continuation lines indented to match. */
function written(value: unknown, indent: string, unit: string): string {
  return JSON.stringify(value, null, unit).split('\n').join(`\n${indent}`);
}

/** `{ path[0]: { path[1]: … value } }`, for the part of a path that is missing. */
function nest(path: string[], value: unknown): unknown {
  return path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
}

/** Adds `key: value` as the object's last member. */
function insertMember(text: string, obj: ObjectSpan, key: string, value: unknown): string {
  const unit = indentUnit(text);
  const last = obj.members[obj.members.length - 1];
  if (last) {
    const first = obj.members[0];
    const multiline = text.slice(obj.open, first.keyStart).includes('\n');
    const indent = multiline ? lineIndent(text, first.keyStart) : '';
    const member = `${JSON.stringify(key)}: ${written(value, indent, unit)}`;
    if (!multiline) {
      return `${text.slice(0, last.valueEnd)}, ${member}${text.slice(last.valueEnd)}`;
    }
    // A last member that already ends its line with a comma, the way a JSONC
    // file is often kept, keeps that line, comment and all: the new member
    // goes on a line of its own after it, with a comma of its own.
    const trailing = TRAILING.exec(text.slice(last.valueEnd));
    if (trailing) {
      const at = last.valueEnd + trailing[0].length;
      return `${text.slice(0, at)}\n${indent}${member},${text.slice(at)}`;
    }
    return `${text.slice(0, last.valueEnd)},\n${indent}${member}${text.slice(last.valueEnd)}`;
  }
  const outer = lineIndent(text, obj.open);
  const indent = outer + unit;
  const member = `\n${indent}${JSON.stringify(key)}: ${written(value, indent, unit)}\n${outer}`;
  // Whatever stood between the braces was space or a comment. Space is
  // replaced; a comment is kept, with the member after it.
  const between = text.slice(obj.open + 1, obj.close);
  return between.trim() === ''
    ? text.slice(0, obj.open + 1) + member + text.slice(obj.close)
    : text.slice(0, obj.close) + member + text.slice(obj.close);
}

/**
 * Sets the member at `path` to `value`, creating the objects on the way. An
 * existing member keeps its place and only its value changes.
 */
export function setIn(text: string, path: string[], value: unknown): string {
  if (!path.length) throw new Error('An edit needs a path');
  let obj = rootObject(text);
  for (let depth = 0; depth < path.length; depth++) {
    const member = obj.members.find(m => m.key === path[depth]);
    const rest = path.slice(depth + 1);
    if (!member) return insertMember(text, obj, path[depth], nest(rest, value));
    if (!rest.length) {
      const unit = indentUnit(text);
      const indent = lineIndent(text, member.keyStart);
      return (
        text.slice(0, member.valueStart) +
        written(value, indent, unit) +
        text.slice(member.valueEnd)
      );
    }
    if (text[member.valueStart] !== '{') {
      throw new Error(`${path.slice(0, depth + 1).join('.')} is not an object`);
    }
    obj = objectAt(text, member.valueStart);
  }
  return text;
}

/**
 * Removes the member at `path`, with the separator that joined it to its
 * neighbour, so removing what `setIn` added gives back the text it was given.
 * A path that is not there leaves the text as it is.
 */
export function removeIn(text: string, path: string[]): string {
  if (!path.length) return text;
  let obj = rootObject(text);
  for (let depth = 0; depth < path.length - 1; depth++) {
    const member = obj.members.find(m => m.key === path[depth]);
    if (!member || text[member.valueStart] !== '{') return text;
    obj = objectAt(text, member.valueStart);
  }
  const at = obj.members.findIndex(m => m.key === path[path.length - 1]);
  if (at < 0) return text;
  const member = obj.members[at];
  if (at > 0) {
    // A member on a line of its own that ends in its own comma goes with that
    // line, a comment on it included, and the line before, its comma and its
    // comment, stays as it was.
    const lineStart = text.lastIndexOf('\n', member.keyStart - 1);
    const ownLine = /^[ \t]*$/.test(text.slice(lineStart + 1, member.keyStart));
    const comma = /^[ \t]*,[ \t]*(?:\/\/[^\r\n]*|\/\*[^\r\n]*?\*\/)?/.exec(
      text.slice(member.valueEnd)
    );
    if (ownLine && comma) {
      return text.slice(0, lineStart) + text.slice(member.valueEnd + comma[0].length);
    }
    // Otherwise from the end of the one before: the comma, the line break and
    // the member itself, which is what an insert after it added.
    return text.slice(0, obj.members[at - 1].valueEnd) + text.slice(member.valueEnd);
  }
  const next = obj.members[at + 1];
  if (next) return text.slice(0, member.keyStart) + text.slice(next.keyStart);
  return text.slice(0, obj.open + 1) + text.slice(obj.close);
}
