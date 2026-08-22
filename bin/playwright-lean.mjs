#!/usr/bin/env node
import { cli } from '../src/cli.mjs';
import { session } from '../src/browser/session.mjs';

let exitCode = 0;
try {
  exitCode = await cli(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`playwright-lean: ${err.message}\n`);
  exitCode = 1;
} finally {
  await session.close();
}
process.exitCode = exitCode || 0;
