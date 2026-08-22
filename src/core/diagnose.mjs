import fs from 'fs';
import path from 'path';
import { generateDossiers } from './dossier.mjs';

export function getDiagnostic(clusterId, options = {}) {
  if (!/^CLUSTER-\d{2,}$/.test(clusterId)) {
    throw new Error(`Invalid cluster ID: ${clusterId}`);
  }

  const outputDir = path.resolve(process.cwd(), options.outputDir || '.playwright-lean');
  const dossierDir = path.join(outputDir, 'errors');
  const dossierPath = path.join(dossierDir, `${clusterId}.md`);

  if (!fs.existsSync(dossierPath)) {
    // Attempt generating dossiers first
    generateDossiers(options.jsonPath, outputDir);
  }

  if (!fs.existsSync(dossierPath)) {
    throw new Error(`Dossier for cluster ${clusterId} not found at ${dossierPath}`);
  }

  const content = fs.readFileSync(dossierPath, 'utf8');

  return {
    clusterId,
    filePath: dossierPath,
    content,
  };
}
