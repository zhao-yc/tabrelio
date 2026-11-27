import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { MysqlDataTransferDialog } from '../../src/renderer/components/MysqlDataTransferDialog';
import { mysqlDataTransferZh as text } from '../../src/renderer/locales/mysqlDataTransfer.zh-CN';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke, errorMessage: String, uid: () => '00000000-0000-4000-8000-000000000001' }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const connections = [
  { id: 'source', name: '源连接', group: '', color: '', dialect: 'mysql' as const, host: '127.0.0.1', port: 3306, user: 'test', database: 'source_db' },
  { id: 'target', name: '目标连接', group: '', color: '', dialect: 'mysql' as const, host: '127.0.0.1', port: 3306, user: 'test', database: 'target_db' },
];

beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null;
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as MemoryNode & { selected?: boolean }).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as MemoryNode & { selected?: boolean }).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => { invoke.mockReset().mockImplementation(async command => command === 'mysql.backup.tables' ? ['orders', 'users', 'audit'] : undefined); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

async function mount(names = ['orders', 'users', 'audit']) {
  invoke.mockImplementation(async command => command === 'mysql.backup.tables' ? names : undefined);
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(<MysqlDataTransferDialog connections={connections} onClose={vi.fn()} onRefresh={vi.fn()} />));
  const source = document.querySelectorAll('select')[0]; source.value = 'source'; await act(async () => source.dispatchEvent(new MemoryEvent('change')));
  const load = document.querySelectorAll('button').find(button => button.textContent === text.load)!; await act(async () => load.dispatchEvent(new MemoryEvent('click')));
}
function button(label: string) { const value = document.querySelectorAll('button').find(node => node.textContent === label); if (!value) throw Error('缺少按钮：' + label); return value; }
function tableChecks() { return document.querySelectorAll('input[type="checkbox"]'); }
async function click(label: string) { const value = button(label); expect(value.disabled).toBe(false); await act(async () => value.dispatchEvent(new MemoryEvent('click'))); }

describe('MySQL／MariaDB 数据传输源表选择', () => {
  it('全选与清空只作用于已读取目录', async () => {
    await mount(); expect(tableChecks()).toHaveLength(3); expect(tableChecks().some(node => node.checked)).toBe(false); await click(text.selectAll); expect(tableChecks().every(node => node.checked)).toBe(true); await click(text.clearSelection); expect(tableChecks().some(node => node.checked)).toBe(false);
  });
  it('超过32张表时拒绝全选且不截断选择', async () => {
    const names = Array.from({ length: 33 }, (_, index) => 'table_' + index); await mount(names); await click(text.selectAll);
    expect(tableChecks().some(node => node.checked)).toBe(false); expect(document.body.textContent).toContain(text.tooManyTables(32));
  });
});
