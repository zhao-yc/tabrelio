import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { tableElementsZh as text } from '../../src/renderer/locales/tableElements.zh-CN';
import { tablePresetsZh } from '../../src/renderer/locales/tablePresets.zh-CN';
import { sidebarContextMenuZh } from '../../src/renderer/locales/sidebarContextMenu.zh-CN';
import { sidebarLocateZh } from '../../src/renderer/locales/sidebarLocate.zh-CN';
import { sidebarViewZh } from '../../src/renderer/locales/sidebarView.zh-CN';
import { objectInformationZh } from '../../src/renderer/locales/objectInformation.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { columnPatchZh } from '../../src/renderer/locales/columnPatches.zh-CN';
import { indexPatchZh } from '../../src/renderer/locales/indexPatches.zh-CN';
import { foreignKeyPatchZh } from '../../src/renderer/locales/foreignKeyPatches.zh-CN';
import { sqliteColumnsZh } from '../../src/renderer/locales/sqliteColumns.zh-CN';
import { sqliteIndexesZh } from '../../src/renderer/locales/sqliteIndexes.zh-CN';
import { postgresStructureZh } from '../../src/renderer/locales/postgresStructure.zh-CN';
import { postgresColumnEditZh } from '../../src/renderer/locales/postgresColumnEdit.zh-CN';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('在原生对象树查看结构并定位原表设计器', async ({}, info) => {
  const dialect = process.env.DBARK_TREE_ELEMENTS_DIALECT;
  test.skip(!dialect, '需显式启用表结构子节点专项');
  const sqlite = dialect === 'sqlite', postgres = dialect === 'postgresql';
  const rename = process.env.DBARK_TREE_RENAME_NATIVE === '1';
  const postgresDependencyKinds = process.env.DBARK_TREE_DEPENDENCIES_PG_EXTRA === '1';
  const database = sqlite ? 'main' : process.env.DBARK_TREE_ELEMENTS_DATABASE ?? '';
  const password = process.env.DBARK_TREE_ELEMENTS_PASSWORD ?? '', port = Number(process.env.DBARK_TREE_ELEMENTS_PORT);
  if (postgresDependencyKinds && !postgres || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL || (sqlite ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['mysql', 'mariadb', 'postgresql'].includes(dialect!) ||
    !/^tabrelio_te_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
    !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('只允许本例源码与独占数据库');
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = sqlite ? undefined : {
    id: '', dialect: dialect as NetworkConnectionProfile['dialect'] | 'postgresql', name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const file = join(await realpath(dataDir), '侧栏表结构.sqlite');
  try {
    if (sqlite) {
      const db = new DatabaseSync(file);
      try {
        db.exec(`CREATE TABLE parent_catalog(scope_id INTEGER, id INTEGER, PRIMARY KEY(scope_id,id));
          INSERT INTO parent_catalog VALUES (7,1);
          CREATE TABLE a_small(id INTEGER PRIMARY KEY, scope_id INTEGER, parent_id INTEGER, marker TEXT,
            derived INTEGER GENERATED ALWAYS AS (id+scope_id) STORED,
            FOREIGN KEY(scope_id,parent_id) REFERENCES parent_catalog);
          INSERT INTO a_small(id,scope_id,parent_id,marker) VALUES (1,7,1,'catalog-marker');
          CREATE INDEX idx_parent_pair ON a_small(scope_id,parent_id) WHERE parent_id>0;
          CREATE VIEW visible_view AS SELECT id FROM a_small;`);
      } finally { db.close(); }
      await desktop.evaluate(({ BrowserWindow, dialog }, path) => {
        const original = dialog.showOpenDialog;
        dialog.showOpenDialog = (async (...args: unknown[]) => {
          dialog.showOpenDialog = original;
          if (args[0] !== BrowserWindow.getAllWindows()[0] ||
              !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite')) {
            throw Error('只允许当前窗口选择本例 SQLite 文件');
          }
          return { canceled: false, filePaths: [path] };
        }) as typeof original;
      }, file);
    }
    const before = sqlite ? await readFile(file) : undefined;
    const connectionId = await page.evaluate(async ({ profile, database, dialect, rename }) => {
      const id = 'table-elements-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('缺少本例 SQLite 文件授权');
      const saved = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: dialect!, group: '',
        color: '#123456', sqlite: { fileToken: picked!.token, readOnly: !rename, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, sidebarWidth: 300, activeTabId: 'original', tabs: [
        { id: 'original', title: '原查询草稿', kind: 'query', connectionId: saved.id, database, sql: 'SELECT 123;' },
      ] });
      return saved.id;
    }, { profile, database, dialect, rename });
    await page.reload();
    const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const originalTabs = (await settings()).tabs;

    const tree = page.locator('.sidebar');
    const key = (values: (string | null)[]) => '[data-sidebar-node=' + JSON.stringify(JSON.stringify(values)) + ']';
    const connectionRow = tree.locator(key([connectionId, null, 'connection', null]));
    const trigger = tree.getByRole('button', { name: sidebarViewZh.controls, exact: true });
    const panel = tree.getByRole('group', { name: sidebarViewZh.controls, exact: true });
    const openedOnly = panel.getByRole('checkbox', { name: sidebarViewZh.openedOnly, exact: true });
    const openedIds = () => page.evaluate(() => window.dbark.invoke('connections.opened', {}));
    expect(await openedIds()).toEqual([]);
    await trigger.click();
    await openedOnly.check();
    await expect(connectionRow).toBeHidden();
    await expect(tree.getByText(sidebarViewZh.noMatch, { exact: true })).toBeVisible();
    await page.evaluate(id => window.dbark.invoke('connections.open', { id }), connectionId);
    await expect(connectionRow).toBeVisible();
    expect(await openedIds()).toEqual([connectionId]);
    await trigger.press('Escape');
    await connectionRow.locator('.tree-label').click();
    const databaseRow = tree.locator(key([connectionId, database, 'database', null]));
    await databaseRow.locator('.tree-label').click();
    const name = postgres ? '"public"."a_small"' : 'a_small';
    const row = tree.locator(key([connectionId, database, 'table', name]));
    const view = tree.locator(key([connectionId, database, 'view', postgres ? '"public"."visible_view"' : 'visible_view']));
    await expect(view).toBeVisible();
    await expect(view.locator('.table-elements-toggle')).toHaveCount(0);
    const branch = tree.getByRole('group', { name: text.branch(name), exact: true });
    const expand = row.getByRole('button', { name: text.expand(name), exact: true });
    const collapse = row.getByRole('button', { name: text.collapse(name), exact: true });
    await expect(branch).toHaveCount(0);
    await expand.press('Enter');
    const fields = branch.getByRole('group', { name: text.columns, exact: true });
    await expect(fields.getByRole('listitem')).toHaveCount(5);
    await expect(fields.getByRole('listitem').filter({ hasText: /^id/ }).locator('svg')).toHaveAttribute('aria-label', text.primary);
    await expect(fields.getByRole('listitem').filter({ hasText: 'derived' })).toContainText(text.generated);

    await branch.getByRole('button', { name: new RegExp('^' + text.indexes) }).press('Space');
    const index = branch.getByRole('group', { name: text.indexes, exact: true }).getByRole('listitem').filter({ hasText: 'idx_parent_pair' });
    await expect(index).toBeVisible();
    if (sqlite) await expect(index).toContainText(text.partial);
    await branch.getByRole('button', { name: new RegExp('^' + text.foreignKeys) }).click();
    const foreign = branch.getByRole('group', { name: text.foreignKeys, exact: true }).locator('details');
    await expect(foreign).toHaveCount(1);
    await expect(foreign.locator('summary')).toHaveText(sqlite ? text.ordinal(0) : 'fk_parent_pair');
    await foreign.locator('summary').press('Enter');
    await expect(foreign.getByText(/parent_catalog/)).toBeVisible();
    await expect(foreign.getByText('scope_id → ' + (sqlite ? text.implicitPrimary : 'scope_id'), { exact: true })).toBeVisible();
    await expect(foreign.getByText('parent_id → ' + (sqlite ? text.implicitPrimary : 'id'), { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('对象树结构子节点.png') });
    expect((await settings()).tabs).toEqual(originalTabs);

    const splitter = await page.locator('.vertical-resize').boundingBox();
    if (!splitter) throw Error('侧栏宽度手柄不可用');
    const y = splitter.y + splitter.height / 2;
    await page.mouse.move(splitter.x + splitter.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(splitter.x - 140, y);
    await page.mouse.up();
    await expect.poll(() => tree.evaluate(node => node.clientWidth)).toBe(180);
    expect(await tree.locator('.tree-scroll').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await expect(foreign.getByText(/parent_catalog/)).toBeVisible();
    await page.screenshot({ path: info.outputPath('最窄侧栏结构.png') });

    async function checkDesigner(title: string, name: string, screenshot?: string) {
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      const chosen = dialog.locator('[data-structure-focus][aria-current="true"]');
      await expect(chosen).toHaveCount(1);
      await expect(chosen).toContainText(name);
      await expect(chosen).toBeFocused();
      if (screenshot) await page.screenshot({ path: info.outputPath(screenshot) });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
    const columnButton = fields.getByRole('button', { name: text.designNamed('derived'), exact: true });
    const columnTitle = postgres ? postgresStructureZh.title : sqlite ? sqliteColumnsZh.title : columnPatchZh.title;
    await columnButton.click();
    await expect(page.getByRole('dialog', { name: columnTitle, exact: true })).toHaveCount(0);
    await columnButton.dblclick();
    await checkDesigner(columnTitle, 'derived', '从对象树定位字段.png');
    await expect(columnButton).toBeFocused();
    const indexButton = index.getByRole('button', { name: text.designNamed('idx_parent_pair'), exact: true });
    await indexButton.press('Enter');
    await checkDesigner(postgres ? postgresStructureZh.title : sqlite ? sqliteIndexesZh.title : indexPatchZh.title, 'idx_parent_pair');
    await expect(indexButton).toBeFocused();
    const foreignDesign = foreign.getByRole('button', { name: text.design, exact: true });
    if (sqlite) await expect(foreignDesign).toHaveCount(0);
    else {
      await foreignDesign.press('Enter');
      await checkDesigner(postgres ? postgresStructureZh.title : foreignKeyPatchZh.title, 'fk_parent_pair');
      await expect(foreignDesign).toBeFocused();
    }
    expect((await settings()).tabs).toEqual(originalTabs);

    const presets = row.getByRole('button', { name: tablePresetsZh.treeExpand(name), exact: true });
    await presets.click();
    const presetBranch = tree.getByRole('group', { name: tablePresetsZh.treeExpand(name), exact: true });
    await expect(presetBranch.getByText(tablePresetsZh.treeEmpty, { exact: true })).toBeVisible();
    await expect(branch).toBeVisible();
    await collapse.press('Space');
    await expect(branch).toHaveCount(0);
    await expect(presetBranch).toBeVisible();
    await expand.click();
    await expect(fields.getByText('derived', { exact: true })).toBeVisible();

    await clickSidebarAction(row, { name: sidebarContextMenuZh.refreshObject(name), exact: true });
    await expect(branch).toHaveCount(0);
    await expand.click();
    await expect(fields.getByText('derived', { exact: true })).toBeVisible();

    if (rename) {
      const oldName = 'marker', newName = 'marker_renamed';
      const field = fields.getByRole('button', { name: text.designNamed(oldName), exact: true });
      if (postgres || sqlite) await field.press('F2');
      else {
        await field.click({ button: 'right' });
        const menu = page.getByRole('menu', { name: sidebarContextMenuZh.title(oldName), exact: true });
        await expect(menu.getByRole('menuitem')).toHaveCount(1);
        await menu.getByRole('menuitem', { name: text.rename, exact: true }).click();
      }
      const dialog = page.getByRole('dialog', { name: columnTitle, exact: true });
      const input = dialog.getByRole('textbox', { name: postgres ? postgresColumnEditZh.name : sqlite ? sqliteColumnsZh.renameTo : columnPatchZh.name, exact: true });
      await expect(input).toBeFocused();
      if (postgres) {
        await expect(dialog.getByRole('combobox', { name: postgresColumnEditZh.from, exact: true })).toHaveValue(oldName);
        await expect(dialog.getByRole('combobox', { name: postgresColumnEditZh.operation, exact: true })).toHaveValue('rename');
      } else await expect(input).toHaveValue(oldName);
      await input.fill(newName);
      await page.screenshot({ path: info.outputPath('字段改名输入.png') });
      const stage = postgres ? postgresColumnEditZh.stage : sqlite ? sqliteColumnsZh.saveDesign : columnPatchZh.rowSave;
      const preview = postgres ? postgresColumnEditZh.preview : sqlite ? sqliteColumnsZh.preview : columnPatchZh.preview;
      const apply = postgres ? postgresColumnEditZh.apply : sqlite ? sqliteColumnsZh.apply : columnPatchZh.apply;
      await dialog.getByRole('button', { name: stage, exact: true }).click();
      await dialog.getByRole('button', { name: preview, exact: true }).click();
      const sql = postgres || sqlite ? dialog.getByLabel(postgres ? postgresColumnEditZh.previewTitle : sqliteColumnsZh.previewTitle, { exact: true })
        : dialog.locator('.monaco-editor .view-lines');
      await expect(sql).toContainText(/(?:RENAME|CHANGE)\s+COLUMN/i);
      await expect(sql).toContainText(newName);
      const readFields = () => page.evaluate(async ({ connectionId, database, table }) =>
        (await window.dbark.invoke('metadata.tableElements', { connectionId, database, table })).columns.map(column => column.name),
      { connectionId, database, table: name });
      expect(await readFields()).toContain(oldName);
      expect(await readFields()).not.toContain(newName);
      if (before) expect(await readFile(file)).toEqual(before);
      await page.screenshot({ path: info.outputPath('字段改名预览.png') });
      if (sqlite) {
        await dialog.getByRole('textbox', { name: sqliteColumnsZh.confirmation, exact: true }).fill('main.a_small');
      } else if (!postgres) {
        const confirmations = dialog.locator('.column-patch-acks');
        for (const label of [columnPatchZh.ackImplicit, columnPatchZh.ackWindow, columnPatchZh.ackDependencies]) {
          const checkbox = confirmations.getByRole('checkbox', { name: label, exact: true });
          if (await checkbox.count()) await checkbox.check();
        }
      }
      await dialog.getByRole('button', { name: apply, exact: true }).click();
      await expect.poll(readFields).toContain(newName);
      expect(await readFields()).not.toContain(oldName);
      if (!postgres) {
        await expect(dialog.getByText(sqlite ? sqliteColumnsZh.committed : columnPatchZh.succeeded, { exact: true }).first()).toBeVisible();
        await dialog.getByRole('button', { name: sqlite ? sqliteColumnsZh.close : columnPatchZh.close, exact: true }).click();
      }
      await expect(dialog).toHaveCount(0);
      await expect(branch).toHaveCount(0);
      await expand.click();
      await expect(fields.getByRole('button', { name: text.designNamed(newName), exact: true })).toBeVisible();
      await expect(fields.getByRole('button', { name: text.designNamed(oldName), exact: true })).toHaveCount(0);
      if (sqlite) {
        const disk = new DatabaseSync(file, { readOnly: true });
        try { expect(disk.prepare('SELECT marker_renamed FROM a_small').get()).toEqual({ marker_renamed: 'catalog-marker' }); }
        finally { disk.close(); }
      }
    }
    const rowLabel = row.locator('.tree-label');
    if (sqlite) await rowLabel.dblclick(); else await rowLabel.click();
    if (rename) await expect(page.getByRole('columnheader', { name: /^marker_renamed(?:\s|$)/ })).toBeVisible();
    const cellName = sqlite && rename ? 'TEXT · catalog-marker' : 'catalog-marker';
    await expect(page.getByRole('gridcell', { name: cellName, exact: true }).first()).toBeVisible();
    const tableTabs = (await settings()).tabs;
    await tree.locator(key([connectionId, null, 'connection', null])).locator('.tree-label').click();
    await expect(row).toHaveCount(0);
    const search = tree.getByRole('textbox', { name: zh.sidebar.text003, exact: true });
    await search.fill(' A_SMALL ');
    await expect(row).toBeVisible();
    await expect(view).toHaveCount(0);
    await expect(page.getByRole('gridcell', { name: cellName, exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('对象树搜索自动展开.png') });
    await search.clear();
    await expect(row).toHaveCount(0);
    await tree.getByRole('button', { name: sidebarLocateZh.action, exact: true }).click();
    await expect(row).toHaveClass(/\bactive\b/);
    await expect(rowLabel).toBeFocused();
    await expect(page.getByRole('gridcell', { name: cellName, exact: true }).first()).toBeVisible();
    expect((await settings()).tabs).toEqual(tableTabs);
    await page.screenshot({ path: info.outputPath('对象树定位表页.png') });
    const information = objectInformationZh;
    const inspector = page.getByRole('complementary', { name: information.title, exact: true });
    const definition = inspector.locator('.object-info-content .view-lines');
    await page.getByRole('button', { name: information.title, exact: true }).click();
    await expect(inspector.locator('.object-info-subject')).toContainText(name);
    await inspector.getByRole('button', { name: information.structure, exact: true }).click();
    await expect(inspector.getByRole('region', { name: text.columns, exact: true })).toContainText(text.generated);
    await expect(inspector.getByRole('region', { name: text.indexes, exact: true })).toContainText('idx_parent_pair');
    await expect(inspector.getByRole('region', { name: text.foreignKeys, exact: true })).toContainText('parent_id');
    await page.screenshot({ path: info.outputPath('对象信息表结构.png') });
    await inspector.getByRole('button', { name: information.ddl, exact: true }).click();
    await expect(definition).toContainText('a_small');
    await view.locator('.tree-label').click({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect(definition).toContainText('visible_view');
    await page.screenshot({ path: info.outputPath('对象信息视图定义.png') });
    const outbound = inspector.getByRole('region', { name: information.references, exact: true });
    const inbound = inspector.getByRole('region', { name: information.referencedBy, exact: true });
    await inspector.getByRole('button', { name: information.dependencies, exact: true }).click();
    await expect(outbound).toContainText('a_small');
    const parentName = postgres ? '"public"."parent_catalog"' : 'parent_catalog';
    await tree.locator(key([connectionId, database, 'table', parentName])).locator('.tree-label').click({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect(inbound).toContainText('a_small');
    await page.screenshot({ path: info.outputPath('对象信息入向依赖.png') });
    await rowLabel.click({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect(outbound).toContainText('parent_catalog');
    await page.screenshot({ path: info.outputPath('对象信息出向依赖.png') });
    const openDependency = outbound.getByRole('button', { name: /查看 .*parent_catalog.* 的定义/ }).first();
    const dependencyDefinition = inspector.getByRole('region', { name: information.dependencyDefinition, exact: true });
    await openDependency.press('Enter');
    await expect(dependencyDefinition.locator('.view-lines')).toContainText('parent_catalog');
    await page.screenshot({ path: info.outputPath('依赖对象只读定义.png') });
    await dependencyDefinition.getByRole('button', { name: information.backToDependencies, exact: true }).press('Enter');
    await expect(openDependency).toBeFocused();
    await expect(outbound).toContainText('parent_catalog');
    if (postgresDependencyKinds) {
      for (const [kind, target] of [['function', '"public"."pane_reference"()'], ['sequence', '"public"."pane_sequence"']]) {
        await tree.locator(key([connectionId, database, kind, target])).locator('.tree-label').click({ button: 'right' });
        await page.keyboard.press('Escape');
        await expect(inspector.locator('.object-info-subject')).toContainText(target);
        await expect(outbound).toContainText('a_small');
      }
    }
    const identifiers = inspector.getByRole('region', { name: information.identifiers, exact: true });
    const identifierMode = inspector.getByRole('button', { name: information.identifiers, exact: true });
    await databaseRow.locator('.tree-label').click({ button: 'right' });
    await page.keyboard.press('Escape');
    await identifierMode.click();
    const relationSearch = identifiers.getByRole('searchbox', { name: information.searchRelationIdentifiers, exact: true });
    await relationSearch.fill('visible_view');
    await expect(identifiers.getByRole('listitem')).toHaveCount(1);
    await expect(identifiers.getByRole('listitem')).toContainText('visible_view');
    await page.screenshot({ path: info.outputPath('对象信息数据库标识符.png') });
    const viewName = postgres ? '"public"."visible_view"' : 'visible_view';
    await identifiers.getByRole('button', { name: information.openIdentifier(viewName), exact: true }).press('Enter');
    const activeView = page.locator('.tab-strip [data-active-workspace-tab="true"]').filter({ hasText: viewName });
    await expect(activeView).toBeVisible();
    await expect(page.getByRole('gridcell', { name: '1', exact: true }).first()).toBeVisible();
    await activeView.locator('.tab-close').click();
    await expect(page.getByRole('gridcell', { name: cellName, exact: true }).first()).toBeVisible();
    await view.locator('.tree-label').click({ button: 'right' });
    await page.keyboard.press('Escape');
    const fieldSearch = identifiers.getByRole('searchbox', { name: information.searchFieldIdentifiers, exact: true });
    await fieldSearch.fill('id');
    await expect(identifiers.getByRole('button', { name: information.copyIdentifier('id'), exact: true })).toBeVisible();
    await rowLabel.click({ button: 'right' });
    await page.keyboard.press('Escape');
    await fieldSearch.fill('derived');
    await expect(identifiers.getByRole('listitem')).toHaveCount(1);
    await expect(identifiers.getByRole('listitem')).toContainText('derived');
    await page.screenshot({ path: info.outputPath('对象信息字段标识符.png') });
    await inspector.getByRole('button', { name: information.close, exact: true }).click();
    await expect(inspector).toHaveCount(0);
    await expect(page.getByRole('gridcell', { name: cellName, exact: true }).first()).toBeVisible();
    expect((await settings()).tabs).toEqual(tableTabs);
    if (sqlite) {
      await trigger.click();
      const [panelBounds, treeBounds] = await Promise.all([panel.boundingBox(), tree.boundingBox()]);
      expect(panelBounds!.x).toBeGreaterThanOrEqual(treeBounds!.x);
      expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(treeBounds!.x + treeBounds!.width);
      await panel.getByRole('combobox', { name: sidebarViewZh.vendor, exact: true }).selectOption('sqlite');
      await panel.getByRole('checkbox', { name: sidebarViewZh.flat, exact: true }).check();
      await expect(row).toBeVisible();
      await page.screenshot({ path: info.outputPath('最窄侧栏视图菜单.png') });
      await panel.getByRole('button', { name: sidebarViewZh.collapse, exact: true }).click();
      await expect(row).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page.getByRole('gridcell', { name: cellName, exact: true }).first()).toBeVisible();
      expect((await settings()).tabs).toEqual(tableTabs);
    }
    await trigger.click();
    await openedOnly.check();
    await expect(connectionRow).toBeVisible();
    await page.screenshot({ path: info.outputPath('仅显示已打开连接.png') });
    await panel.getByRole('button', { name: sidebarViewZh.collapse, exact: true }).click();
    await expect(connectionRow.locator('.tree-label')).toHaveAttribute('aria-expanded', 'false');
    await expect(connectionRow).toBeVisible();
    await connectionRow.locator('.tree-label').click({ button: 'right' });
    await page.getByRole('menuitem', { name: zh.sidebar.text013, exact: true }).click();
    await expect(connectionRow).toBeHidden();
    expect(await openedIds()).toEqual([]);
    await tree.getByRole('button', { name: sidebarViewZh.reset, exact: true }).click();
    await expect(connectionRow).toBeVisible();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    if (before && !rename) expect(await readFile(file)).toEqual(before);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
