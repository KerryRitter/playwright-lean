import fs from 'fs';
import path from 'path';

function stripAnsi(text) {
  return (text || '').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

function normalizeError(rawError) {
  let cleaned = stripAnsi(rawError);
  // Strip timestamps, dynamic UUIDs, ports, and transient URLs
  cleaned = cleaned.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<GUID>');
  cleaned = cleaned.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<TIMESTAMP>');
  cleaned = cleaned.replace(/http:\/\/localhost:\d+/g, 'http://localhost:<PORT>');
  cleaned = cleaned.replace(/https:\/\/[a-z0-9-_.]+\.localhost(:\d+)?/g, 'https://<HOST>.localhost');
  cleaned = cleaned.replace(/Timed out \d+ms/g, 'Timed out <TIMEOUT>ms');
  cleaned = cleaned.replace(/Received string: "[^"]*"/g, 'Received string: "<STRING>"');
  return cleaned.trim();
}

function categorizeError(rawError, stack) {
  const text = `${rawError} ${stack}`.toLowerCase();
  if (text.includes('timed out waiting for expect') || text.includes('tobevisible') || text.includes('tobeenabled')) {
    return 'TIMEOUT_EXPECT';
  }
  if (text.includes('timeout') && text.includes('waiting for locator')) {
    return 'TIMEOUT_LOCATOR';
  }
  if (text.includes('net::err_connection_refused') || text.includes('fetch failed')) {
    return 'NETWORK_REFUSED';
  }
  if (text.includes('500 internal server error') || text.includes('status: 500')) {
    return 'API_500_SERVER_ERROR';
  }
  if (text.includes('400 bad request') || text.includes('status: 400')) {
    return 'API_400_BAD_REQUEST';
  }
  if (text.includes('401 unauthorized') || text.includes('403 forbidden')) {
    return 'AUTH_FAILURE';
  }
  if (text.includes('strict-completion-reporter') || text.includes('unverified assertion')) {
    return 'STRICT_COMPLETION_VACUOUS_PASS';
  }
  if (text.includes('typeerror') || text.includes('cannot read properties')) {
    return 'TYPE_ERROR_RUNTIME';
  }
  return 'ASSERTION_FAILURE';
}

function extractPrimaryFrame(stack, specFile) {
  if (!stack) return { primaryLocation: specFile || 'unknown:0', file: specFile || '', line: 0, relativeLocation: specFile || '' };

  const lines = stack.split('\n');
  let implFrame = null;
  let specFrame = null;

  for (const line of lines) {
    const match = line.match(/at\s+(?:.*?\s+\()?([^()]+):(\d+):(\d+)\)?/);
    if (!match) continue;
    const [, filePath, lineNum] = match;

    if (filePath.includes('node_modules') || filePath.includes('node:')) continue;

    const relPath = path.relative(process.cwd(), filePath);
    const frameObj = {
      file: relPath,
      line: parseInt(lineNum, 10),
      relativeLocation: `${relPath}:${lineNum}`,
    };

    const isSpec =
      relPath.endsWith('.spec.ts') ||
      relPath.endsWith('.test.ts') ||
      relPath.endsWith('.spec.js') ||
      relPath.endsWith('.test.js') ||
      relPath.endsWith('.spec.tsx') ||
      relPath.endsWith('.test.tsx');

    if (!isSpec) {
      if (!implFrame) implFrame = frameObj;
    } else {
      if (!specFrame) specFrame = frameObj;
    }
  }

  const chosen = implFrame || specFrame || {
    file: specFile || '',
    line: 0,
    relativeLocation: specFile || 'unknown:0',
  };

  return chosen;
}

export function clusterResults(jsonPath = '.playwright-lean/results.json', outputDir = '.playwright-lean') {
  let resolvedPath = path.resolve(process.cwd(), jsonPath);
  if (!fs.existsSync(resolvedPath) && fs.existsSync(path.resolve(process.cwd(), 'tests/playwright', jsonPath))) {
    resolvedPath = path.resolve(process.cwd(), 'tests/playwright', jsonPath);
  } else if (!fs.existsSync(resolvedPath) && fs.existsSync(path.resolve(process.cwd(), 'tests/playwright/test-results/results.json'))) {
    resolvedPath = path.resolve(process.cwd(), 'tests/playwright/test-results/results.json');
  }
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Results JSON file not found at ${resolvedPath}`);
  }

  const rawData = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));

  const clustersMap = new Map();
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;
  const failedSpecs = [];

  function traverseSuite(suite) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        totalTests++;
        const results = test.results || [];
        const lastResult = results[results.length - 1];

        if (!lastResult) continue;

        if (lastResult.status === 'passed') {
          passedTests++;
        } else if (lastResult.status === 'skipped') {
          skippedTests++;
        } else if (lastResult.status === 'failed' || lastResult.status === 'timedOut' || test.status === 'unexpected') {
          failedTests++;
          failedSpecs.push({ file: spec.file, title: spec.title });

          const rawError = lastResult.error?.message || 'Unknown error';
          const stack = lastResult.error?.stack || '';
          const normalized = normalizeError(rawError);
          const category = categorizeError(rawError, stack);
          const frame = extractPrimaryFrame(stack, spec.file);

          const clusterKey = `${category}::${frame.relativeLocation}::${normalized}`;

          if (!clustersMap.has(clusterKey)) {
            clustersMap.set(clusterKey, {
              category,
              primaryLocation: frame.relativeLocation,
              primaryFrame: frame.relativeLocation,
              file: frame.file,
              line: frame.line,
              normalizedError: normalized,
              signature: normalized,
              rawErrorSample: stripAnsi(rawError).substring(0, 300),
              stackSample: stripAnsi(stack).split('\n').slice(0, 8).join('\n'),
              count: 0,
              affectedSpecs: new Map(),
            });
          }

          const cluster = clustersMap.get(clusterKey);
          cluster.count++;
          cluster.affectedSpecs.set(spec.file, { file: spec.file, title: spec.title });
        }
      }
    }

    for (const child of suite.suites || []) traverseSuite(child);
  }

  // Parse Playwright suites structure
  if (Array.isArray(rawData.suites)) {
    for (const suite of rawData.suites) traverseSuite(suite);
  }

  // Parse Jest / Vitest testResults structure
  if (Array.isArray(rawData.testResults)) {
    for (const testFile of rawData.testResults) {
      const filePath = testFile.name || '';
      for (const assertion of testFile.assertionResults || []) {
        totalTests++;
        if (assertion.status === 'passed') {
          passedTests++;
        } else if (assertion.status === 'pending' || assertion.status === 'skipped' || assertion.status === 'todo') {
          skippedTests++;
        } else if (assertion.status === 'failed') {
          failedTests++;
          const title = assertion.title || assertion.fullName || 'unknown test';
          failedSpecs.push({ file: filePath, title });

          const failureMsg = (assertion.failureMessages || []).join('\n') || 'Assertion failed';
          const rawError = failureMsg.split('\n')[0] || failureMsg;
          const stack = failureMsg;
          const normalized = normalizeError(rawError);
          const category = categorizeError(rawError, stack);
          const frame = extractPrimaryFrame(stack, filePath);

          const clusterKey = `${category}::${frame.relativeLocation}::${normalized}`;

          if (!clustersMap.has(clusterKey)) {
            clustersMap.set(clusterKey, {
              category,
              primaryLocation: frame.relativeLocation,
              primaryFrame: frame.relativeLocation,
              file: frame.file,
              line: frame.line,
              normalizedError: normalized,
              signature: normalized,
              rawErrorSample: stripAnsi(rawError).substring(0, 300),
              stackSample: stripAnsi(stack).split('\n').slice(0, 8).join('\n'),
              count: 0,
              affectedSpecs: new Map(),
            });
          }

          const cluster = clustersMap.get(clusterKey);
          cluster.count++;
          cluster.affectedSpecs.set(filePath, { file: filePath, title });
        }
      }
    }
  }

  const sortedClusters = Array.from(clustersMap.values())
    .sort((a, b) => b.count - a.count)
    .map((c, index) => {
      const affectedSpecsList = Array.from(c.affectedSpecs.values());
      const affectedFilesList = Array.from(new Set(affectedSpecsList.map((s) => s.file)));
      
      let snippet = null;
      if (c.file && fs.existsSync(c.file)) {
        try {
          const lines = fs.readFileSync(c.file, 'utf8').split('\n');
          const start = Math.max(0, c.line - 4);
          const end = Math.min(lines.length, c.line + 4);
          snippet = {
            file: c.file,
            line: c.line,
            code: lines.slice(start, end).join('\n'),
          };
        } catch (e) {}
      }

      return {
        id: `CLUSTER-${String(index + 1).padStart(2, '0')}`,
        category: c.category,
        count: c.count,
        failureCount: c.count,
        primaryFrame: c.primaryLocation,
        primaryLocation: c.primaryLocation,
        file: c.file,
        line: c.line,
        signature: c.signature,
        normalizedError: c.normalizedError,
        rawErrorSample: c.rawErrorSample,
        stackSample: c.stackSample,
        affectedSpecs: affectedSpecsList,
        affectedFiles: affectedFilesList,
        snippet,
      };
    });

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const clustersJsonPath = path.resolve(outputDir, 'clusters.json');
  fs.writeFileSync(clustersJsonPath, JSON.stringify(sortedClusters, null, 2));

  return {
    total: totalTests,
    passed: passedTests,
    failed: failedTests,
    skipped: skippedTests,
    clusterCount: sortedClusters.length,
    clusters: sortedClusters,
    failedSpecs,
    clustersJsonPath,
  };
}
