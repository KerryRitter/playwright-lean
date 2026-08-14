import fs from 'fs';
import path from 'path';
import { session } from '../browser/session.mjs';

export async function runScript(scriptPathOrCode, options = {}) {
  let code = scriptPathOrCode;
  let isFilePath = false;

  if (fs.existsSync(scriptPathOrCode)) {
    code = fs.readFileSync(scriptPathOrCode, 'utf8');
    isFilePath = true;
  }

  const page = await session.ensurePage(options);
  const startTime = Date.now();

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const runner = new AsyncFunction('page', 'context', 'browser', 'session', code);
    const result = await runner(page, session.context, session.browser, session);
    const durationMs = Date.now() - startTime;

    return {
      success: true,
      result,
      durationMs,
      file: isFilePath ? scriptPathOrCode : null,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      error: err.message,
      stack: err.stack,
      durationMs,
      file: isFilePath ? scriptPathOrCode : null,
    };
  }
}
