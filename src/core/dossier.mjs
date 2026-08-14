import fs from 'fs';
import path from 'path';
import { clusterResults } from './cluster.mjs';

const DOSSIER_DIR = path.resolve(process.cwd(), '.playwright-lean/errors');
const STATE_CACHE = path.resolve(process.cwd(), '.playwright-lean/cache/last-run-state.json');

export function generateDossiers(jsonPath = '.playwright-lean/results.json') {
  const summary = clusterResults(jsonPath);
  if (!fs.existsSync(DOSSIER_DIR)) {
    fs.mkdirSync(DOSSIER_DIR, { recursive: true });
  }

  const activeClusterIds = new Set();
  const indexRows = [];

  for (const c of summary.clusters) {
    activeClusterIds.add(c.id);
    const clusterFilePath = path.join(DOSSIER_DIR, `${c.id}.md`);

    const affectedList = c.affectedSpecs.map((s) => `- \`${s.file}\` (${s.title})`).join('\n');
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
${c.signature}
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

    const fileLink = `[${c.id}](file://${clusterFilePath}#L1)`;
    const shortSig = (c.signature.split('\n')[0] || '').substring(0, 48);
    const shortFrame = (c.primaryFrame.split('/').slice(-2).join('/') || c.primaryFrame).substring(0, 36);

    indexRows.push({
      Cluster: fileLink,
      Failed: c.count,
      Frame: shortFrame,
      Error: shortSig,
    });
  }

  // Prune fixed clusters
  if (fs.existsSync(DOSSIER_DIR)) {
    const existingFiles = fs.readdirSync(DOSSIER_DIR);
    for (const file of existingFiles) {
      if (file.startsWith('CLUSTER-') && file.endsWith('.md')) {
        const id = file.replace('.md', '');
        if (!activeClusterIds.has(id)) {
          fs.unlinkSync(path.join(DOSSIER_DIR, file));
        }
      }
    }
  }

  // Compute deltas from previous run
  let deltas = { fixed: 0, regressed: 0 };
  const cacheDir = path.dirname(STATE_CACHE);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  if (fs.existsSync(STATE_CACHE)) {
    try {
      const prevState = JSON.parse(fs.readFileSync(STATE_CACHE, 'utf8'));
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
  fs.writeFileSync(STATE_CACHE, JSON.stringify(currentState, null, 2), 'utf8');

  // Build compact index markdown (< 150 tokens)
  let deltaStr = '';
  if (deltas.fixed > 0 || deltas.regressed > 0) {
    deltaStr = ` | **Δ vs last**: +${deltas.fixed} fixed / -${deltas.regressed} regressed`;
  }

  let indexMarkdown = `### 📊 Test Run Summary
**Total**: ${summary.total} | **Passed**: ${summary.passed} | **Failed**: ${summary.failed} | **Clusters**: ${summary.clusterCount}${deltaStr}

`;

  if (indexRows.length === 0) {
    indexMarkdown += '🎉 **All tests passed! 0 error clusters.**\n';
  } else {
    indexMarkdown += '| Cluster | Count | Root Frame | Error Signature |\n| :--- | :--- | :--- | :--- |\n';
    for (const r of indexRows) {
      indexMarkdown += `| ${r.Cluster} | ${r.Failed} | \`${r.Frame}\` | ${r.Error} |\n`;
    }
    indexMarkdown += `\n> *Click any cluster link above to inspect the minimal failure dossier, or run \`playwright-lean diagnose <CLUSTER-ID>\`.*`;
  }

  fs.writeFileSync(path.join(DOSSIER_DIR, 'INDEX.md'), indexMarkdown, 'utf8');

  return {
    summary,
    deltas,
    indexMarkdown,
    dossierDir: DOSSIER_DIR,
  };
}
