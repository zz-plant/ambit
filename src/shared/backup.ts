/**
 * The copy a config write keeps of what it is about to replace.
 *
 * Two writers change a config a person owns: the visualiser's edit
 * (`writeConfig` in src/server/config.ts) and `ambit connect`, which adds the
 * ambit server to every runtime it finds. Each keeps `<file>.bak` first, and
 * this is the one way both make it.
 */
import { randomBytes } from 'node:crypto';
import { constants, copyFileSync, renameSync, rmSync, statSync } from 'node:fs';

/**
 * Copies `path` to `<path>.bak`, byte for byte and with its mode, and returns
 * the backup's path, or undefined when there is no file yet and so nothing to
 * keep.
 *
 * The copy keeps the formatting a JSON round trip would lose, and a config
 * that holds a key and is chmod 600 gets a backup no more readable than
 * itself. Each call replaces the last backup, so it is always the file as it
 * stood before the most recent write.
 *
 * The copy is made beside the backup and renamed over it. Copying straight to
 * `<path>.bak` follows a link that is already there, so a link planted at that
 * name made the write land wherever it pointed, and a link pointing nowhere
 * made the copy fail in a way once read as "there is no config yet". A rename
 * replaces the name itself and follows nothing.
 *
 * Whether there is a file is decided by asking about the file, never by which
 * step failed. A backup that cannot be made throws, and the caller must not
 * write: an edit nobody can undo is not one to make.
 */
export function keepBackup(path: string): string | undefined {
  try {
    statSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  const backup = `${path}.bak`;
  const beside = `${backup}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    copyFileSync(path, beside, constants.COPYFILE_EXCL);
    renameSync(beside, backup);
  } catch (e) {
    rmSync(beside, { force: true });
    throw e;
  }
  return backup;
}
