export const TOOL_GROUPS = {
  core: [
    'playwright-lean_enable_group',
    'playwright-lean_run',
    'playwright-lean_diagnose',
    'playwright-lean_verify',
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'browser_type',
  ],
  browser_advanced: [
    'browser_find',
    'browser_press_key',
    'browser_hover',
    'browser_select_option',
    'browser_take_screenshot',
    'browser_console_messages',
    'browser_tabs',
    'browser_select_tab',
    'browser_eval',
    'browser_close',
  ],
  suite_advanced: [
    'playwright-lean_cluster',
    'playwright-lean_dossier',
    'playwright-lean_audit',
    'playwright-lean_codemod',
  ],
};

export class ToolGroupManager {
  constructor(initialProfile = 'core') {
    this.all = initialProfile === 'all';
    this.enabledGroups = new Set(initialProfile === 'all' ? ['all'] : ['core']);
  }

  isToolEnabled(toolName) {
    if (this.all) return true;
    if (TOOL_GROUPS.core.includes(toolName)) return true;

    for (const group of this.enabledGroups) {
      if (TOOL_GROUPS[group] && TOOL_GROUPS[group].includes(toolName)) {
        return true;
      }
    }
    return false;
  }

  enable(groupNames = []) {
    const newlyEnabled = [];
    for (const g of groupNames) {
      if (g === 'all') {
        this.all = true;
        this.enabledGroups = new Set(['all', 'core', 'browser_advanced', 'suite_advanced']);
        newlyEnabled.push('all');
        break;
      }
      if (TOOL_GROUPS[g] && !this.enabledGroups.has(g)) {
        this.enabledGroups.add(g);
        newlyEnabled.push(g);
      }
    }
    return newlyEnabled;
  }

  getHiddenGroupsInfo() {
    if (this.all) return [];
    const hidden = [];
    for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
      if (group !== 'core' && !this.enabledGroups.has(group)) {
        hidden.push({ group, count: tools.length, tools });
      }
    }
    return hidden;
  }
}

export const groupManager = new ToolGroupManager('core');
