import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { TableTab } from '../../../src/renderer/components/TableTab';
import { useWorkspace, type WorkspaceTab } from '../../../src/renderer/store';
import { mysqlJoinPreviewSchema } from '../../../src/shared/mysqlJoinPreview';
import { manualJoinDesignSchema, type ManualJoinDesign } from '../../../src/shared/manualJoinDesigns';
import type { QueryOutcome, TableInfo, TablePage } from '../../../src/shared/contracts';
import { parseExplainPlan } from '../../../src/shared/explain';
import type { IncomingReferencesOutput } from '../../../src/shared/incomingReferences';
import 'react-data-grid/lib/styles.css';
import '../../../src/renderer/styles.css';

const table = (name: string, columns: string[]): TableInfo => ({ database: '合成关联库', name, objectKind: 'table', columns: columns.map(name => ({ name, type: 'BIGINT UNSIGNED', nullable: true, generated: false, extra: '', comment: '', defaultValue: null })), indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], engine: 'InnoDB', ddl: '', comment: '' });
const child = table('child', ['id', 'parent_id']), parent = table('parent', ['id', 'amount']);
const options = new URLSearchParams(location.search), incoming = options.get('direction') === 'incoming', manual = options.get('direction') === 'manual';
const queryEntry = options.get('entry') === 'query', holdSource = options.get('hold') === '1';
const NewQueryDialog = queryEntry ? (await import('../../../src/renderer/App')).NewQueryDialog : undefined;
parent.columns[1].type = 'DECIMAL(30,4)';
child.foreignKeys = [{ name: 'fk_parent', columns: ['parent_id'], referencedDatabase: parent.database, referencedTable: parent.name, referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }];
if (incoming) child.foreignKeys.push({ ...child.foreignKeys[0], name: 'fk_other_parent', columns: ['id'] });
const source = incoming || manual ? parent : child;
const other = { ...table('payments', ['order_id', 'total']), database: '另一库' };
const another = { ...other, name: 'other_payments' };
const designs = new Map<string, { id: string; name: string; design: ManualJoinDesign }>();
const calls: { command: string; input: unknown }[] = [], denied: string[] = [];
let releaseSource!: () => void, releaseCancel!: () => void;
const sourceGate = new Promise<void>(resolve => { releaseSource = resolve; }), cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; });
Object.defineProperty(window, '__joinEntryControls', { value: { releaseSource, releaseCancel, invalidate: () => {
  useWorkspace.setState({ connectionVersions: { 'offline-join': 1 } });
  useWorkspace.setState({ connectionVersions: {} });
} } });
/** 只替代数据库输入；真实TableTab、菜单、JOIN窗口、来源租约及工作区打开行为均参与。 */
Object.defineProperty(window, 'dbark', { value: { invoke: async (command: string, input: Record<string, unknown>) => {
  calls.push({ command, input: structuredClone(input) });
  if (queryEntry) {
    if (command === 'connections.open' && input.id === 'offline-join') return { dialect: 'mysql', version: '8.0.46' };
    if (command === 'metadata.databases' && input.connectionId === 'offline-join') return [child.database, other.database];
    if (command === 'metadata.objects' && input.connectionId === 'offline-join') {
      if (input.database === child.database) return [{ name: child.name, kind: 'table' }, { name: parent.name, kind: 'table' }, { name: 'view_only', kind: 'view' }];
      if (input.database === other.database) return [{ name: other.name, kind: 'table' }];
    }
    if (command === 'metadata.table' && input.connectionId === 'offline-join' && input.database === other.database && input.table === other.name) return structuredClone(other);
    if (holdSource && command === 'metadata.table' && input.connectionId === 'offline-join' && input.database === child.database && input.table === child.name) {
      await sourceGate;
      return structuredClone(child);
    }
    if (holdSource && command === 'query.cancel') { await cancelGate; return; }
  }
  if (manual && input.connectionId === 'offline-join') {
    if (input.database === source.database && input.table === source.name) {
      if (command === 'joinDesigns.list') return Array.from(designs.values(), ({ id, name }) => ({ id, name }));
      if (command === 'joinDesigns.save') {
        const id = 'fixture-design-' + (designs.size + 1), name = String(input.name);
        designs.set(id, { id, name, design: manualJoinDesignSchema.parse(input.design) });
        return { id, name };
      }
      if (command === 'joinDesigns.read' && designs.has(String(input.id))) return structuredClone(designs.get(String(input.id))!.design);
    }
    if (command === 'mysql.join.preview') {
      const request = mysqlJoinPreviewSchema.parse(input);
      if (request.source.table !== source.name || request.parent.table !== other.name || request.steps.length !== 2 ||
          'sql' in input || request.steps[1].target.table !== other.name) throw Error('JOIN 预览范围不符');
      if (request.mode === 'explain') {
        const raw = JSON.stringify({ query_block: { nested_loop: [
          { table: { table_name: 'c', access_type: 'ALL', rows_examined_per_scan: 125 } },
          { table: { table_name: 'p', access_type: 'ref', key: 'idx_order_id', rows_examined_per_scan: 1 } },
        ] } }, null, 2);
        return { results: [{ columns: [{ key: 'plan', name: 'EXPLAIN', type: 'TEXT' }], rows: [{ plan: raw }], statement: 'EXPLAIN FORMAT=JSON SELECT 1', elapsedMs: 3, truncated: false }],
          explain: parseExplainPlan(raw, 'mysql', '8.0.46'), elapsedMs: 3 } satisfies QueryOutcome;
      }
      if (request.mode === 'explainText') return { results: [{ columns: [{ key: 'key', name: 'key', type: 'TEXT' }],
        rows: [{ key: 'idx_order_id' }], statement: 'EXPLAIN FORMAT=TRADITIONAL SELECT 1', elapsedMs: 3, truncated: false }], elapsedMs: 3,
        explain: { dialect: 'mysql', version: '8.0.46', format: 'text', nodes: [], raw: '', rawTruncated: false, warnings: [] } } satisfies QueryOutcome;
      return { results: [{ columns: [{ key: 'c_1_id', name: 'c_1_id', type: 'BIGINT' }],
        rows: [{ c_1_id: '18446744073709551615' }], elapsedMs: 3, truncated: true }], elapsedMs: 3 };
    }
    if (command === 'metadata.databases') return [source.database, other.database];
    if (command === 'metadata.objects' && input.database === other.database) return [{ name: other.name, kind: 'table' }, { name: another.name, kind: 'table' }, { name: 'view_only', kind: 'view' }];
    if (command === 'metadata.table' && input.database === other.database) {
      const target = [other, another].find(item => item.name === input.table);
      if (target) return structuredClone(target);
    }
  }
  if (command === 'metadata.table' && input.connectionId === 'offline-join' && input.database === child.database && [child.name, parent.name].includes(input.table as string)) return structuredClone(input.table === child.name ? child : parent);
  if (command === 'table.page' && input.connectionId === 'offline-join' && input.database === source.database && input.table === source.name) return { rows: incoming || manual ? [] : [{ id: '9007199254740993', parent_id: '18446744073709551615' }, { id: '9007199254740994', parent_id: null }], columns: source.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), page: 1, pageSize: 50, hasMore: false } satisfies TablePage;
  if (command === 'table.incomingReferences' && incoming && input.connectionId === 'offline-join' && input.database === parent.database &&
      input.table === parent.name && (input.cursor === undefined || input.cursor === 'fixture-page-2')) {
    const next = input.cursor === 'fixture-page-2';
    return structuredClone({ source: parent, sourceDigest: 'a'.repeat(64), scope: 'visible-only',
      relations: [{ database: child.database, table: child.name, foreignKey: child.foreignKeys[next ? 0 : 1], digest: (next ? 'b' : 'c').repeat(64) }],
      ...(next ? {} : { nextCursor: 'fixture-page-2' }),
    } satisfies IncomingReferencesOutput);
  }
  if (command === 'connections.open') return {};
  if (command === 'table.preferences.get') return null;
  if (command === 'settings.save') return undefined;
  denied.push(command); throw Error('JOIN离线组件拒绝未声明命令：' + command);
}, onTask: () => () => {} } });
Object.defineProperty(window, '__joinOrderEvidence', { value: () => ({ calls: structuredClone(calls), denied: [...denied], tabs: structuredClone(useWorkspace.getState().settings.tabs), active: useWorkspace.getState().settings.activeTabId, resultLimit: useWorkspace.getState().settings.resultLimit, dirty: structuredClone(useWorkspace.getState().dirtyTabs), jobs: structuredClone(useWorkspace.getState().activeJobs) }) });
const tab: WorkspaceTab = { id: 'offline-join-table', kind: 'table', connectionId: 'offline-join', database: source.database, table: source.name, title: source.name };
const seed: WorkspaceTab = { id: 'existing-query', kind: 'query', connectionId: 'offline-join', database: child.database, sql: 'SELECT 7', title: '原查询' };
const theme = options.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;
useWorkspace.setState({ ready: true, connections: [{ id: 'offline-join', name: 'JOIN合成目录', host: '127.0.0.1', port: 1, user: 'offline', group: '', color: '#123456', dialect: 'mysql' }],
  settings: { ...useWorkspace.getState().settings, theme, resultLimit: 43, tabs: [queryEntry ? seed : tab], activeTabId: queryEntry ? seed.id : tab.id } });
/** 只读显示真实工作区已新建草稿，不代替产品消费预览或修改生成的SQL。 */
function Fixture() {
  const query = useWorkspace(state => state.settings.tabs.find(tab => tab.kind === 'query' && tab.id !== seed.id));
  const [newQuery, setNewQuery] = useState(queryEntry);
  if (query) return <pre aria-label="本例独立查询SQL">{query.sql}</pre>;
  if (NewQueryDialog) return newQuery ? <NewQueryDialog onClose={() => setNewQuery(false)}/> : <p>返回原查询</p>;
  return <div style={{ height: '100vh' }}><TableTab tab={tab} refreshVersion={0} refreshAutomatically={false} onOpenGeneratedQuery={candidate => useWorkspace.getState().openTab(candidate)} onDesign={() => {}} onTransfer={() => {}} onColumnPatches={() => {}} onIndexPatches={() => {}} onForeignKeyPatches={() => {}} onTableRename={() => {}} onTableAutoIncrement={() => {}} onTableComment={() => {}} onTableDefaultEncoding={() => {}}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
