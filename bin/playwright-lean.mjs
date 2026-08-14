#!/usr/bin/env node
import { cli } from '../src/cli.mjs';

const exitCode = await cli(process.argv.slice(2));
process.exit(exitCode || 0);
