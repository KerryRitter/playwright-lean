import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolGroupManager } from '../src/mcp/groups.mjs';

test('Tool Groups: starts in core mode and enables groups on demand', () => {
  const manager = new ToolGroupManager('core');

  // Core tools are enabled
  assert.equal(manager.isToolEnabled('playwright-lean_run'), true);
  assert.equal(manager.isToolEnabled('browser_navigate'), true);

  // Advanced tools are initially disabled
  assert.equal(manager.isToolEnabled('browser_eval'), false);
  assert.equal(manager.isToolEnabled('playwright-lean_codemod'), false);

  // Enable browser_advanced
  const newlyEnabled = manager.enable(['browser_advanced']);
  assert.deepEqual(newlyEnabled, ['browser_advanced']);
  assert.equal(manager.isToolEnabled('browser_eval'), true);
  assert.equal(manager.isToolEnabled('playwright-lean_codemod'), false);

  // Enable all
  manager.enable(['all']);
  assert.equal(manager.isToolEnabled('playwright-lean_codemod'), true);
});
