import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateDossiers } from '../src/core/dossier.mjs';

test('Dossier Generator: writes markdown dossiers and compact index', () => {
  const fakeResults = {
    suites: [
      {
        title: 'Billing Suite',
        file: 'billing.spec.ts',
        specs: [
          {
            title: 'charge customer card',
            file: 'billing.spec.ts',
            tests: [
              {
                status: 'unexpected',
                results: [
                  {
                    status: 'failed',
                    error: {
                      message: 'Error: expect(received).toBe(expected)\nExpected: 200\nReceived: 400',
                      stack: 'Error: expect(received).toBe(expected)\n    at billing.spec.ts:50:10',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const tempJsonPath = path.join(os.tmpdir(), `pw-lean-dossier-test-${Date.now()}.json`);
  fs.writeFileSync(tempJsonPath, JSON.stringify(fakeResults));

  const result = generateDossiers(tempJsonPath);

  assert.equal(result.summary.failed, 1);
  assert.ok(result.indexMarkdown.includes('### 📊 Test Run Summary'));
  assert.ok(result.indexMarkdown.includes('CLUSTER-01'));

  const dossierPath = path.join(result.dossierDir, 'CLUSTER-01.md');
  assert.equal(fs.existsSync(dossierPath), true);

  const dossierContent = fs.readFileSync(dossierPath, 'utf8');
  assert.ok(dossierContent.includes('# Failure Dossier: CLUSTER-01'));
  assert.ok(dossierContent.includes('billing.spec.ts'));

  fs.unlinkSync(tempJsonPath);
});
