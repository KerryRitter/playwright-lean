import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { clusterResults } from './cluster.mjs';

const MAX_CLUSTERS_IN_INDEX = 10;
const MAX_AFFECTED_SPECS = 50;
const MAX_SIGNATURE_CHARS = 2_000;

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n… [truncated]` : text;
}

function escapeTableCell(text) {
  return text.replace(/[|\r\n]/g, (character) => (character === '|' ? '\\|' : ' '));
}

export function generateDossiers(input = '.playwright-lean/results.json', customOutputDir, options = {}) {
  const dossierDir = customOutputDir
    ? path.resolve(process.cwd(), customOutputDir, 'errors')
    : path.resolve(process.cwd(), '.playwright-lean/errors');
  const cacheDir = customOutputDir
    ? path.resolve(process.cwd(), customOutputDir, 'cache')
    : path.resolve(process.cwd(), '.playwright-lean/cache');
  const stateCache = path.join(cacheDir, 'last-run-state.json');

  const summary =
    typeof input === 'object' && input !== null && Array.isArray(input.clusters)
      ? input
      : clusterResults(typeof input === 'string' ? input : '.playwright-lean/results.json', customOutputDir);

  if (!fs.existsSync(dossierDir)) {
    fs.mkdirSync(dossierDir, { recursive: true });
  }
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const activeClusterIds = new Set();
  const indexRows = [];

  for (const c of summary.clusters) {
    activeClusterIds.add(c.id);
    const clusterFilePath = path.join(dossierDir, `${c.id}.md`);

    const visibleSpecs = c.affectedSpecs.slice(0, MAX_AFFECTED_SPECS);
    let affectedList = visibleSpecs.map((s) => `- \`${s.file}\` (${s.title})`).join('\n');
    if (c.affectedSpecs.length > visibleSpecs.length) {
      affectedList += `\n- … ${c.affectedSpecs.length - visibleSpecs.length} additional affected tests omitted`;
    }
    const signature = truncate(c.signature.replace(/```/g, '``\\`'), MAX_SIGNATURE_CHARS);
    const codeSnippet = c.snippet
      ? `\`\`\`typescript\n// ${c.snippet.file}:${c.snippet.line}\n${c.snippet.code}\n\`\`\``
      : '*(No source snippet available)*';

    const dossierContent = `# Failure Dossier: ${c.id}

**Category**: \`${c.category}\`  
**Root Stack Frame**: \`${c.primaryFrame}\`  
**Affected Tests**: ${c.count} test(s) across ${c.affectedFiles.length} file(s)

---

## 💥 Normalized Error Signature
\`\`\`text
${signature}
\`\`\`

---

## 📍 Primary Failing Code
${codeSnippet}

---

## 📁 Affected Test Files
${affectedList}

---

## 🛠️ Verification Command
\`\`\`bash
playwright-lean verify ${c.id}
\`\`\`
`;

    fs.writeFileSync(clusterFilePath, dossierContent, 'utf8');

    const fileLink = `[${c.id}](${pathToFileURL(clusterFilePath).href}#L1)`;
    const shortSig = (c.signature.split('\n')[0] || '').substring(0, 48);
    const shortFrame = (c.primaryFrame.split('/').slice(-2).join('/') || c.primaryFrame).substring(0, 36);

    if (indexRows.length < MAX_CLUSTERS_IN_INDEX) indexRows.push({
      Cluster: fileLink,
      Failed: c.count,
      Frame: escapeTableCell(shortFrame),
      Error: escapeTableCell(shortSig),
    });
  }

  // Prune fixed clusters
  if (fs.existsSync(dossierDir)) {
    const existingFiles = fs.readdirSync(dossierDir);
    for (const file of existingFiles) {
      if (file.startsWith('CLUSTER-') && file.endsWith('.md')) {
        const id = file.replace('.md', '');
        if (!activeClusterIds.has(id)) {
          fs.unlinkSync(path.join(dossierDir, file));
        }
      }
    }
  }

  // Compute deltas from previous run
  let deltas = { fixed: 0, regressed: 0 };
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  if (fs.existsSync(stateCache)) {
    try {
      const prevState = JSON.parse(fs.readFileSync(stateCache, 'utf8'));
      const prevFailedTests = new Set(prevState.failedTestIds || []);
      const currentFailedTests = new Set(summary.failedSpecs.map((s) => `${s.file}::${s.title}`));

      let fixed = 0;
      let regressed = 0;

      for (const id of prevFailedTests) {
        if (!currentFailedTests.has(id)) fixed++;
      }
      for (const id of currentFailedTests) {
        if (!prevFailedTests.has(id)) regressed++;
      }
      deltas = { fixed, regressed };
    } catch (e) {}
  }

  // Save current state
  const currentState = {
    time: new Date().toISOString(),
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    failedTestIds: summary.failedSpecs.map((s) => `${s.file}::${s.title}`),
    clusterIds: Array.from(activeClusterIds),
  };
  fs.writeFileSync(stateCache, JSON.stringify(currentState, null, 2), 'utf8');

  // Build a bounded summary index; full dossiers remain on disk.
  let deltaStr = '';
  if (deltas.fixed > 0 || deltas.regressed > 0) {
    deltaStr = ` | **Δ vs last**: +${deltas.fixed} fixed / -${deltas.regressed} regressed`;
  }

  let indexMarkdown = `### 📊 Test Run Summary
**Total**: ${summary.total} | **Passed**: ${summary.passed} | **Failed**: ${summary.failed} | **Clusters**: ${summary.clusterCount}${deltaStr}

`;

  if (options.exitCode !== undefined && options.exitCode !== 0) {
    indexMarkdown += `❌ **Playwright exited with code ${options.exitCode}; this run is not passing.**\n`;
  }
  if (summary.total === 0) {
    indexMarkdown += '⚠️ **No tests were collected; this is not proof of a passing suite.**\n';
  } else if (indexRows.length === 0 && (options.exitCode === undefined || options.exitCode === 0)) {
    indexMarkdown += '🎉 **All tests passed! 0 error clusters.**\n';
  }

  if (indexRows.length > 0) {
    indexMarkdown += '| Cluster | Count | Root Frame | Error Signature |\n| :--- | :--- | :--- | :--- |\n';
    for (const r of indexRows) {
      indexMarkdown += `| ${r.Cluster} | ${r.Failed} | \`${r.Frame}\` | ${r.Error} |\n`;
    }
    if (summary.clusterCount > indexRows.length) {
      indexMarkdown += `\n> *${summary.clusterCount - indexRows.length} additional clusters were written to disk but omitted from this summary.*\n`;
    }
    indexMarkdown += `\n> *Click any cluster link above to inspect the minimal failure dossier, or run \`playwright-lean diagnose <CLUSTER-ID>\`.*`;
  }

  fs.writeFileSync(path.join(dossierDir, 'INDEX.md'), indexMarkdown, 'utf8');

  return {
    summary,
    deltas,
    compactIndex: indexMarkdown,
    indexMarkdown,
    dossierDir,
  };
}
