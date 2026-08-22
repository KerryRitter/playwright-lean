import test from 'node:test';
import assert from 'node:assert/strict';
import { session } from '../src/browser/session.mjs';

test('Browser Session: executes eval expressions and navigates data URLs', async () => {
  // Test basic JS eval without loading a website
  const evalRes = await session.eval('10 + 25');
  assert.equal(evalRes, 35);

  // Navigate to an in-memory data HTML page
  const html = `data:text/html,<html><body><h1>Playwright Lean</h1><button id="btn">Click Me</button></body></html>`;
  const navRes = await session.navigate(html);

  assert.equal(navRes.status, 200);
  assert.ok(navRes.snapshot.includes('Playwright Lean'));
  assert.ok(navRes.snapshot.includes('Click Me'));

  // Test find
  const findRes = await session.find({ text: 'Click Me' });
  assert.equal(findRes.count, 1);
  assert.ok(findRes.matches[0].ref.startsWith('e'));

  // Click via ref
  const clickRes = await session.click(findRes.matches[0].ref);
  assert.equal(clickRes.success, true);

  await assert.rejects(
    session.takeScreenshot({ filename: '/tmp/outside-workspace.png' }),
    /must stay inside .playwright-lean\/screenshots/
  );

  await session.close();
});
