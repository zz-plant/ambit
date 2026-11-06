#!/usr/bin/env node --experimental-sqlite
/**
 * The executable the CLI runs.
 *
 * The implementation lives in modules named after the thing they do rather than
 * in one file: what the system is (`ontology`), how it finds out (`discovery`),
 * what it can infer (`inference`), what it has evidence for (`assurance`), what
 * it could do next (`planning`), who may authorise it (`governance`), and how
 * the frontier moved (`ledger`). Ambit's conceptual architecture is the point of
 * the project, so it may as well be the file layout.
 */
import { main } from './cli.ts';

if (import.meta.main) main();
