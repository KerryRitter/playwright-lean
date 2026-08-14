import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

class BrowserSession {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.refMap = new Map();
    this.refCounter = 1;
    this.consoleLogs = [];
    this.cdpPort = null;
  }

  async connectOverCDP(port = 9222) {
    this.cdpPort = port;
    const wsEndpoint = `http://localhost:${port}`;
    this.browser = await chromium.connectOverCDP(wsEndpoint);
    const contexts = this.browser.contexts();
    this.context = contexts.length > 0 ? contexts[0] : await this.browser.newContext();
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    this._attachListeners(this.page);
    return { success: true, port, tabCount: pages.length };
  }

  _attachListeners(page) {
    page.on('console', (msg) => {
      this.consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location(),
        timestamp: new Date().toISOString(),
      });
    });

    page.on('pageerror', (err) => {
      this.consoleLogs.push({
        type: 'error',
        text: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString(),
      });
    });
  }

  async ensurePage(options = {}) {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    const {
      headless = process.env.PW_LEAN_HEADED !== '1',
      userDataDir = null,
      viewport = { width: 1280, height: 800 },
      port = null,
    } = options;

    if (port) {
      await this.connectOverCDP(port);
      return this.page;
    }

    if (userDataDir) {
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      this.context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        viewport,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    } else {
      if (!this.browser) {
        this.browser = await chromium.launch({
          headless,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
      }
      this.context = await this.browser.newContext({ viewport });
      this.page = await this.context.newPage();
    }

    this._attachListeners(this.page);
    return this.page;
  }

  async tabs() {
    await this.ensurePage();
    const pages = this.context ? this.context.pages() : (this.page ? [this.page] : []);
    const tabList = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      tabList.push({
        index: i + 1,
        title: await p.title().catch(() => ''),
        url: p.url(),
        active: p === this.page,
      });
    }
    return tabList;
  }

  async selectTab(filter) {
    await this.ensurePage();
    const pages = this.context.pages();
    let targetPage = null;

    if (typeof filter === 'number' || !isNaN(Number(filter))) {
      const idx = Number(filter) - 1;
      if (idx >= 0 && idx < pages.length) {
        targetPage = pages[idx];
      }
    } else if (typeof filter === 'string') {
      for (const p of pages) {
        const title = await p.title().catch(() => '');
        const url = p.url();
        if (title.toLowerCase().includes(filter.toLowerCase()) || url.includes(filter)) {
          targetPage = p;
          break;
        }
      }
    }

    if (!targetPage) {
      throw new Error(`Tab matching "${filter}" not found`);
    }

    this.page = targetPage;
    await this.page.bringToFront().catch(() => {});
    return {
      index: pages.indexOf(targetPage) + 1,
      title: await this.page.title(),
      url: this.page.url(),
    };
  }

  async navigate(url, options = {}) {
    const page = await this.ensurePage(options);
    this.refMap.clear();
    this.refCounter = 1;

    const response = await page.goto(url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || 30000,
    });

    const status = response ? response.status() : 200;
    const title = await page.title();
    const currentUrl = page.url();

    const snapshot = await this.snapshot({ depth: 4 });

    return {
      status,
      title,
      url: currentUrl,
      snapshot: snapshot.tree,
    };
  }

  async snapshot(options = {}) {
    const page = await this.ensurePage(options);
    const { target = null, foldSiblingsThreshold = 5 } = options;

    this.refMap.clear();
    this.refCounter = 1;

    const locator = target ? this.resolveTarget(target) : page.locator(':root');
    let ariaText = '';

    try {
      ariaText = await locator.ariaSnapshot({ timeout: 10000 });
    } catch (e) {
      ariaText = '(Unable to capture aria snapshot: ' + e.message + ')';
    }

    const lines = ariaText.split('\n');
    const processedLines = [];
    let consecutiveIdenticalRole = 0;
    let lastRole = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(\s*-\s+)([a-zA-Z0-9_-]+)(\s+\"[^\"]+\")?(.*)$/);

      if (match) {
        const [, indent, role, name, rest] = match;
        const refId = `e${this.refCounter++}`;
        const cleanName = name ? name.trim().replace(/^\"|\"$/g, '') : '';

        // Register locator for targeted interactions
        try {
          if (cleanName) {
            this.refMap.set(refId, page.getByRole(role, { name: cleanName, exact: false }));
          } else {
            this.refMap.set(refId, page.locator(`[role="${role}"]`).first());
          }
        } catch (e) {}

        // Sibling folding
        if (role === lastRole) {
          consecutiveIdenticalRole++;
        } else {
          lastRole = role;
          consecutiveIdenticalRole = 1;
        }

        if (consecutiveIdenticalRole > foldSiblingsThreshold) {
          if (consecutiveIdenticalRole === foldSiblingsThreshold + 1) {
            processedLines.push(`${indent}... [additional ${role} items folded; use target or browser_find to inspect]`);
          }
          continue;
        }

        processedLines.push(`${indent}[ref=${refId}] ${role}${name || ''}${rest}`);
      } else {
        processedLines.push(line);
      }
    }

    const treeText = processedLines.join('\n');

    // Write full snapshot to disk for on-demand inspection
    const snapshotDir = path.resolve(process.cwd(), '.playwright-lean/snapshots');
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }
    const fullSnapshotPath = path.join(snapshotDir, `snapshot-latest.txt`);
    fs.writeFileSync(fullSnapshotPath, treeText, 'utf8');

    return {
      url: page.url(),
      title: await page.title(),
      tree: treeText.trimEnd(),
      snapshotFile: fullSnapshotPath,
    };
  }

  async find(options = {}) {
    const page = await this.ensurePage(options);
    const { text = '', role = null } = options;

    let locator;
    if (role && text) {
      locator = page.getByRole(role, { name: text, exact: false });
    } else if (role) {
      locator = page.getByRole(role);
    } else if (text) {
      locator = page.getByText(text, { exact: false });
    } else {
      return { count: 0, matches: [] };
    }

    const count = await locator.count();
    const matches = [];

    for (let i = 0; i < Math.min(count, 10); i++) {
      const el = locator.nth(i);
      const isVisible = await el.isVisible().catch(() => false);
      const isEnabled = await el.isEnabled().catch(() => false);
      const textContent = await el.textContent().catch(() => '');

      const refId = `e${this.refCounter++}`;
      this.refMap.set(refId, el);

      matches.push({
        ref: refId,
        text: (textContent || '').trim().substring(0, 80),
        visible: isVisible,
        enabled: isEnabled,
      });
    }

    return {
      count,
      matches,
    };
  }

  resolveTarget(target) {
    if (!target) throw new Error('Target element or selector is required');
    if (this.refMap.has(target)) {
      return this.refMap.get(target);
    }
    return this.page.locator(target);
  }

  async click(target, options = {}) {
    await this.ensurePage(options);
    const locator = this.resolveTarget(target);
    await locator.click({
      timeout: options.timeout || 15000,
      force: options.force || false,
    });
    return { success: true, target, url: this.page.url() };
  }

  async type(target, text, options = {}) {
    await this.ensurePage(options);
    const locator = this.resolveTarget(target);
    if (options.clear !== false) {
      await locator.fill(text, { timeout: options.timeout || 15000 });
    } else {
      await locator.type(text, { timeout: options.timeout || 15000 });
    }
    return { success: true, target, text };
  }

  async pressKey(key, options = {}) {
    await this.ensurePage(options);
    await this.page.keyboard.press(key, { delay: options.delay || 0 });
    return { success: true, key };
  }

  async hover(target, options = {}) {
    await this.ensurePage(options);
    const locator = this.resolveTarget(target);
    await locator.hover({ timeout: options.timeout || 15000 });
    return { success: true, target };
  }

  async selectOption(target, values, options = {}) {
    await this.ensurePage(options);
    const locator = this.resolveTarget(target);
    const selected = await locator.selectOption(values, { timeout: options.timeout || 15000 });
    return { success: true, target, selected };
  }

  async takeScreenshot(options = {}) {
    const page = await this.ensurePage(options);
    const { filename, fullPage = false } = options;

    const screenshotsDir = path.resolve(process.cwd(), '.playwright-lean/screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const name = filename || `screenshot-${Date.now()}.png`;
    const filePath = path.isAbsolute(name) ? name : path.resolve(screenshotsDir, name);

    await page.screenshot({ path: filePath, fullPage });
    return { success: true, path: filePath };
  }

  async eval(code, options = {}) {
    const page = await this.ensurePage(options);
    const { nodeContext = false } = options;

    if (nodeContext) {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction('page', 'context', 'browser', code);
      return await fn(page, this.context, this.browser);
    } else {
      return await page.evaluate(code);
    }
  }

  getConsoleMessages(level = null) {
    if (!level) return this.consoleLogs;
    return this.consoleLogs.filter((log) => log.type === level.toLowerCase());
  }

  async close() {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.page = null;
    this.refMap.clear();
    return { success: true };
  }
}

export const session = new BrowserSession();
