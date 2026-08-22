import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { clusterResults } from '../src/core/cluster.mjs';

test('Cluster Engine: groups duplicate failures into root cause clusters', () => {
  const fakeResults = {
    suites: [
      {
        title: 'CRM Suite',
        file: 'crm.spec.ts',
        suites: [
          {
            title: 'Lead Creation',
            file: 'crm.spec.ts',
            specs: [
              {
                title: 'should create a lead with valid phone',
                file: 'crm.spec.ts',
                tests: [
                  {
                    status: 'unexpected',
                    results: [
                      {
                        status: 'failed',
                        error: {
                          message: 'Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\nLocator: getByText("Lead Created")',
                          stack: 'Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\n    at LeadsPage.saveLead (src/objects/pages/LeadsPage.ts:42:15)\n    at crm.spec.ts:18:22',
                        },
                      },
                    ],
                  },
                ],
              },
              {
                title: 'should create a lead with valid email',
                file: 'crm.spec.ts',
                tests: [
                  {
                    status: 'unexpected',
                    results: [
                      {
                        status: 'failed',
                        error: {
                          message: 'Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\nLocator: getByText("Lead Created")',
                          stack: 'Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\n    at LeadsPage.saveLead (src/objects/pages/LeadsPage.ts:42:15)\n    at crm.spec.ts:35:22',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const tempJsonPath = path.join(os.tmpdir(), `pw-lean-test-results-${Date.now()}.json`);
  fs.writeFileSync(tempJsonPath, JSON.stringify(fakeResults));

  const summary = clusterResults(tempJsonPath);

  assert.equal(summary.total, 2);
  assert.equal(summary.failed, 2);
  assert.equal(summary.clusterCount, 1);
  assert.equal(summary.clusters[0].id, 'CLUSTER-01');
  assert.equal(summary.clusters[0].count, 2);
  assert.equal(summary.clusters[0].category, 'TIMEOUT_EXPECT');
  assert.ok(summary.clusters[0].primaryFrame.includes('LeadsPage.ts:42'));

  fs.unlinkSync(tempJsonPath);
});

test('Cluster Engine: groups Jest/Vitest testResults format into root cause clusters', () => {
  const fakeJestResults = {
    numTotalTests: 2,
    numPassedTests: 0,
    numFailedTests: 2,
    testResults: [
      {
        name: 'apps/api/src/modules/billing/subscription.service.spec.ts',
        status: 'failed',
        assertionResults: [
          {
            title: 'should compute prorated amount on plan switch',
            status: 'failed',
            failureMessages: [
              'Error: expect(received).toBe(expected)\n\nExpected: 2500\nReceived: 2000\n    at SubscriptionService.prorate (src/modules/billing/subscription.service.ts:88:12)\n    at subscription.service.spec.ts:45:20',
            ],
          },
          {
            title: 'should apply discount code on tier upgrade',
            status: 'failed',
            failureMessages: [
              'Error: expect(received).toBe(expected)\n\nExpected: 2500\nReceived: 2000\n    at SubscriptionService.prorate (src/modules/billing/subscription.service.ts:88:12)\n    at subscription.service.spec.ts:60:20',
            ],
          },
        ],
      },
    ],
  };

  const tempJsonPath = path.join(os.tmpdir(), `jest-test-results-${Date.now()}.json`);
  fs.writeFileSync(tempJsonPath, JSON.stringify(fakeJestResults));

  const summary = clusterResults(tempJsonPath);

  assert.equal(summary.total, 2);
  assert.equal(summary.failed, 2);
  assert.equal(summary.clusterCount, 1);
  assert.equal(summary.clusters[0].id, 'CLUSTER-01');
  assert.equal(summary.clusters[0].count, 2);
  assert.equal(summary.clusters[0].category, 'ASSERTION_FAILURE');
  assert.ok(summary.clusters[0].primaryFrame.includes('subscription.service.ts:88'));

  fs.unlinkSync(tempJsonPath);
});

test('Cluster Engine: treats expected Playwright failures as passing outcomes', () => {
  const fakeResults = {
    suites: [{
      specs: [{
        title: 'expected failure',
        file: 'expected.spec.ts',
        tests: [{
          status: 'expected',
          results: [{
            status: 'failed',
            error: { message: 'Error: intentional failure', stack: 'Error: intentional failure' },
          }],
        }],
      }],
    }],
  };
  const tempJsonPath = path.join(os.tmpdir(), `pw-lean-expected-${Date.now()}.json`);
  fs.writeFileSync(tempJsonPath, JSON.stringify(fakeResults));

  const summary = clusterResults(tempJsonPath);
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 0);
  assert.equal(summary.clusterCount, 0);

  fs.unlinkSync(tempJsonPath);
});
