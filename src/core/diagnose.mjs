import fs from 'fs';
import path from 'path';
import { generateDossiers } from './dossier.mjs';

export function getDiagnostic(clusterId, options = {}) {
  const dossierPath = path.resolve(process.cwd(), `.playwright-lean/errors/${clusterId}.md`);

  if (!fs.existsSync(dossierPath)) {
    // Attempt generating dossiers first
    generateDossiers();
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
