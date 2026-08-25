import fs from 'fs';

/**
 * Reporters whose on-disk output playwright-lean can consume directly:
 *   - 'json'                    → native Playwright `suites` report
 *   - 'playwright-lean/reporter'→ Jest-style `testResults` report
 * clusterResults() understands both shapes.
 */
const MACHINE_READABLE_REPORTERS = new Set(['json', 'playwright-lean/reporter']);

function skipTrivia(text, start) {
  let index = start;
  while (index < text.length) {
    if (/\s/.test(text[index])) {
      index++;
      continue;
    }
    if (text.startsWith('//', index)) {
      index = text.indexOf('\n', index + 2);
      if (index === -1) return text.length;
      continue;
    }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      return end === -1 ? text.length : skipTrivia(text, end + 2);
    }
    break;
  }
  return index;
}

function readQuoted(text, start) {
  const quote = text[start];
  let value = '';
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') {
      value += character + (text[index + 1] || '');
      index++;
      continue;
    }
    if (character === quote) return { value, end: index + 1 };
    if (quote === '`' && character === '$' && text[index + 1] === '{') return null;
    value += character;
  }
  return null;
}

function readReporterExpression(text) {
  for (let cursor = 0; cursor < text.length;) {
    if (text.startsWith('//', cursor)) {
      const end = text.indexOf('\n', cursor + 2);
      cursor = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('/*', cursor)) {
      const end = text.indexOf('*/', cursor + 2);
      cursor = end === -1 ? text.length : end + 2;
      continue;
    }
    if (["'", '"', '`'].includes(text[cursor])) {
      const quoted = readQuoted(text, cursor);
      cursor = quoted ? quoted.end : cursor + 1;
      continue;
    }
    if (!/[A-Za-z_$]/.test(text[cursor])) {
      cursor++;
      continue;
    }

    let identifierEnd = cursor + 1;
    while (identifierEnd < text.length && /[\w$]/.test(text[identifierEnd])) identifierEnd++;
    const identifier = text.slice(cursor, identifierEnd);
    if (identifier !== 'reporter') {
      cursor = identifierEnd;
      continue;
    }

    let index = skipTrivia(text, identifierEnd);
    if (text[index] !== ':') {
      cursor = identifierEnd;
      continue;
    }
    index = skipTrivia(text, index + 1);

    if (["'", '"', '`'].includes(text[index])) {
      const quoted = readQuoted(text, index);
      if (quoted) return text.slice(index, quoted.end);
      cursor = identifierEnd;
      continue;
    }
    if (text[index] !== '[') {
      cursor = identifierEnd;
      continue;
    }

    const start = index;
    let depth = 0;
    for (; index < text.length; index++) {
      if (text.startsWith('//', index)) {
        index = text.indexOf('\n', index + 2);
        if (index === -1) return null;
        continue;
      }
      if (text.startsWith('/*', index)) {
        const end = text.indexOf('*/', index + 2);
        if (end === -1) return null;
        index = end + 1;
        continue;
      }
      if (["'", '"', '`'].includes(text[index])) {
        const quoted = readQuoted(text, index);
        if (!quoted) return null;
        index = quoted.end - 1;
        continue;
      }
      if (text[index] === '[') depth++;
      if (text[index] === ']') {
        depth--;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }

    cursor = identifierEnd;
  }

  return null;
}

function readStringOption(options, name) {
  const pattern = new RegExp(String.raw`\b${name}\s*:\s*(["'\x60])([^"'\x60]+)\1`);
  const match = options.match(pattern);
  return match ? match[2] : null;
}

/**
 * Statically inspect a Playwright config file (no execution) to decide whether it
 * already declares a machine-readable reporter that playwright-lean can consume.
 *
 * When it does, the CLI must NOT inject a `--reporter` override: some consumers
 * (correctly) forbid CLI reporter overrides so their configured JSON/integrity
 * reporters cannot be silently replaced.
 *
 * @returns {{ hasMachineReadable: boolean, outputFile: string|null, outputDir: string|null, reporter: string|null }}
 *   outputFile is the raw (config-relative) path declared on the reporter, or null
 *   when the reporter relies on PLAYWRIGHT_JSON_OUTPUT_FILE / stdout.
 */
export function inspectConfigReporters(configPath) {
  const empty = { hasMachineReadable: false, outputFile: null, outputDir: null, reporter: null };
  if (!configPath || !fs.existsSync(configPath)) return empty;

  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch {
    return empty;
  }
  const reporterExpression = readReporterExpression(text);
  if (!reporterExpression) return empty;

  const entries = [];

  // Tuple form: ['name'] or ['name', { ...options }]
  const tupleRe = /\[\s*(['"`])([^'"`]+)\1\s*(?:,\s*(\{[\s\S]*?\}))?\s*\]/g;
  let match;
  while ((match = tupleRe.exec(reporterExpression)) !== null) {
    const name = match[2];
    const options = match[3] || '';
    entries.push({
      name,
      outputFile: readStringOption(options, 'outputFile'),
      outputDir: readStringOption(options, 'outputDir'),
    });
  }

  // Bare string form: reporter: 'json'
  const bareMatch = reporterExpression.match(/^\s*(['"`])([^'"`\][]+)\1\s*$/);
  if (bareMatch) entries.push({ name: bareMatch[2], outputFile: null, outputDir: null });

  const candidates = entries.filter((entry) => MACHINE_READABLE_REPORTERS.has(entry.name));
  if (candidates.length === 0) return empty;

  // Prefer an explicit outputFile (native `json` first for its canonical shape),
  // otherwise fall back to a reporter that relies on env/stdout redirection.
  const chosen =
    candidates.find((entry) => entry.name === 'json' && entry.outputFile) ||
    candidates.find((entry) => entry.outputFile) ||
    candidates.find((entry) => entry.name === 'json') ||
    candidates[0];

  return {
    hasMachineReadable: true,
    outputFile: chosen.outputFile,
    outputDir: chosen.outputDir,
    reporter: chosen.name,
  };
}
