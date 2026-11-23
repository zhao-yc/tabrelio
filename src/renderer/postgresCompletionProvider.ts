import type * as monaco from 'monaco-editor';
import type { PostgresCompletionInput, PostgresCompletionReference, PostgresCompletionResult } from '../shared/postgresCompletion';
import { postgresCompletionLimits } from '../shared/postgresCompletion';
import { postgresIdentifier } from '../shared/postgresSql';
import { postgresConflictExpression } from '../shared/postgresConflictExpression';
import { analyzePostgresCompletion, analyzePostgresFieldHover, analyzePostgresSignature, catalogColumnReferences,
  isJoinedProjection, type PostgresFieldTarget } from './postgresCompletionAnalysis';
import { joinCatalogRelations, joinedOutputColumns, sharedJoinColumns } from './postgresJoinColumns';
import { postgresNamedParameterCompletion, postgresNamedParameterHover } from './postgresNamedParameterReferences';
import { postgresSignatureHelp } from './postgresSignatureHelp';
import { postgresZh } from './locales/postgres.zh-CN';
import { sqlFieldHoverZh as fieldText } from './locales/sqlFieldHover.zh-CN';

export interface PostgresCompletionScope { tabId: string; connectionId: string; database: string; connectionVersion: number; sessionId?: string; }
type Kind = 'schema' | 'table' | 'view' | 'column' | 'routine' | 'keyword' | 'variable';
type Status = 'idle' | 'partial' | 'unavailable' | 'limited' | 'sessionUnknown';
const keywords = ['SELECT','FROM','JOIN','LEFT JOIN','RIGHT JOIN','INNER JOIN','WHERE','GROUP BY','ORDER BY',
  'HAVING','LIMIT','OFFSET','INSERT INTO','VALUES','UPDATE','SET','DELETE FROM','RETURNING','ON CONFLICT',
  'DISTINCT','WITH','UNION ALL','IS NULL','IS NOT NULL','CASE','WHEN','THEN','ELSE','END','BEGIN','COMMIT','ROLLBACK',
  'WINDOW','OVER','FILTER','PARTITION BY','ROWS','RANGE','BETWEEN','UNBOUNDED','PRECEDING','FOLLOWING','CURRENT ROW'];

/** 名称、默认值和备注均作为纯文本显示，不能在悬停中产生HTML或可点击命令。 */
function fieldHoverText(field: PostgresFieldTarget, result: PostgresCompletionResult): string | undefined {
  if (result.incomplete || result.deferred) return;
  const items = result.items.filter(item => item.kind === 'columnDetail')
    .filter(item => item.name === field.name && !!field.relations[item.reference]);
  if (!items.length) return;
  const qualified = (item: typeof items[number]) => [item.schema, item.relation, item.name].map(postgresIdentifier).join('.');
  const relation = (item: typeof items[number]) => {
    const alias = field.relations[item.reference].alias;
    return alias ? postgresIdentifier(alias) + ' → ' + qualified(item) : qualified(item);
  };
  const [item] = items;
  const lines = items.length > 1 ? [fieldText.ambiguous, ...items.map(relation)] : [
    fieldText.field + '：' + relation(item), fieldText.source + '：' + (item.temporary ? fieldText.temporary : fieldText.permanent),
    fieldText.type + '：' + item.type, fieldText.catalogNullable + '：' + (item.nullable ? fieldText.yes : fieldText.no),
    (item.generated ? fieldText.generatedExpression : fieldText.defaultValue) + '：' + (item.expression ?? fieldText.noDefault),
    fieldText.comment + '：' + (item.comment ?? fieldText.none),
  ];
  return lines.join('\n').split(/\r\n|\r|\n/).map(line => '    ' + line).join('\n');
}

/** 等待短防抖，编辑取消立即唤醒，目录在途请求只由原承诺收尾。 */
function debounce(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** 单编辑器请求串行，旧正文、光标、标签、连接及取消都不能交付迟到建议。 */
export function createPostgresCompletionProvider(options: {
  scope: PostgresCompletionScope;
  standardStrings?: boolean;
  model(): monaco.editor.ITextModel | null;
  position(): monaco.Position | null;
  current(): boolean;
  request(input: PostgresCompletionInput): Promise<PostgresCompletionResult>;
  kinds: Record<Kind, monaco.languages.CompletionItemKind>;
  snippetRule: monaco.languages.CompletionItemInsertTextRule;
  status(value: Status): void;
}): monaco.languages.CompletionItemProvider & { signatureHelp: monaco.languages.SignatureHelpProvider; hover: monaco.languages.HoverProvider; invalidate(): void; dispose(): void } {
  let active: AbortController | undefined;
  let inFlight: Promise<PostgresCompletionResult> | undefined;
  let signatureGeneration = 0;
  let hoverGeneration = 0;
  let disposed = false;
  const { connectionId, database, sessionId } = options.scope;
  const target = { connectionId, database, ...(sessionId ? { sessionId } : {}) };
  const parameterText = postgresZh.parameterEditor;

  /** 两类提示共用原会话请求通道，过期请求在排队后也不能发出。 */
  async function request(input: PostgresCompletionInput, current: () => boolean) {
    while (inFlight && current()) await inFlight.catch(() => {});
    if (!current()) return;
    const pending = options.request(input);
    inFlight = pending;
    try { return await pending; }
    finally { if (inFlight === pending) inFlight = undefined; }
  }

  const signatureHelp: monaco.languages.SignatureHelpProvider = {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [',', ')', '>', '='],
    async provideSignatureHelp(model, position, token) {
      // 其他 SQL 模型也会调用全局注册的 provider，不能使原模型的在途提示失效。
      if (disposed || options.model() !== model || !options.current() || model.isDisposed() || token.isCancellationRequested ||
          model.getValueLength() > postgresCompletionLimits.source) return null;
      const generation = ++signatureGeneration, version = model.getVersionId();
      const current = () => {
        const cursor = options.position();
        return !disposed && signatureGeneration === generation && !token.isCancellationRequested &&
          options.current() && options.model() === model && !model.isDisposed() && model.getVersionId() === version &&
          cursor?.lineNumber === position.lineNumber && cursor.column === position.column;
      };
      const call = analyzePostgresSignature(model.getValue(), model.getOffsetAt(position));
      if (!call) return null;
      try {
        const result = await request({ ...target, kind: 'signatures', prefix: call.name, routine: call.routine }, current);
        if (!result || result.deferred || !current()) return null;
        const value = postgresSignatureHelp(result.items, call);
        return value ? { value, dispose() {} } : null;
      } catch { return null; }
    },
  };
  return {
    signatureHelp,
    hover: {
      async provideHover(model, position, token) {
        if (disposed || !options.current() || options.model() !== model || model.isDisposed() || token.isCancellationRequested ||
            model.getValueLength() > postgresCompletionLimits.source) return null;
        const generation = ++hoverGeneration, version = model.getVersionId();
        const source = model.getValue(), offset = model.getOffsetAt(position);
        const range = (value: { start: number; end: number }) => {
          const start = model.getPositionAt(value.start), end = model.getPositionAt(value.end);
          return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
        };
        const fact = postgresNamedParameterHover(source, offset, options.standardStrings);
        if (fact) return { range: range(fact), contents: [{ value: '`[$' + fact.name + ']` · ' + parameterText.title },
          { value: parameterText.references(fact.statementCount, fact.draftCount) }] };
        if (active) return null;
        const field = analyzePostgresFieldHover(source, offset, options.standardStrings);
        if (!field) return null;
        const current = () => !disposed && !active && hoverGeneration === generation && !token.isCancellationRequested &&
          options.current() && options.model() === model && !model.isDisposed() && model.getVersionId() === version;
        try {
          const result = await request({ ...target, kind: 'columnDetails', prefix: field.name,
            relations: field.relations.map(({ alias: _, ...relation }) => relation) }, current);
          if (!result || !current()) return null;
          const value = fieldHoverText(field, result);
          return value ? { range: range(field), contents: [{ value, isTrusted: false, supportHtml: false }] } : null;
        } catch { return null; }
      },
    },
    triggerCharacters: ['.', '"', '$'],
    /** 先校验本地词法，只向服务端发送目标和前缀。 */
    async provideCompletionItems(model, position, context, token) {
      const empty = { suggestions: [] };
      if (disposed || !options.current() || options.model() !== model || model.isDisposed() || token.isCancellationRequested) return empty;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const version = model.getVersionId();
      const current = () => {
        const cursor = options.position();
        return !disposed && !controller.signal.aborted && active === controller && options.current() &&
          options.model() === model && !model.isDisposed() && model.getVersionId() === version &&
          cursor?.lineNumber === position.lineNumber && cursor.column === position.column;
      };
      const cancel = token.onCancellationRequested(() => controller.abort());
      const change = model.onDidChangeContent(() => controller.abort());
      try {
        options.status('idle');
        if (model.getValueLength() > postgresCompletionLimits.source) { options.status('limited'); return empty; }
        const source = model.getValue();
        const offset = model.getOffsetAt(position);
        const parameter = postgresNamedParameterCompletion(source, offset, options.standardStrings);
        if (parameter) {
          const start = model.getPositionAt(parameter.start), end = model.getPositionAt(parameter.end);
          const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
          return { incomplete: parameter.items.length > 0, suggestions: parameter.items.map(({ name, local }, index) => {
            const text = '[$' + name + ']';
            return { range, kind: options.kinds.variable, label: text, filterText: text, insertText: text,
              detail: local ? parameterText.currentStatement : parameterText.otherStatement, sortText: String(index).padStart(3, '0') };
          }) };
        }
        if (parameter === null || context?.triggerCharacter === '$') return empty;
        const analysis = analyzePostgresCompletion(source, offset, options.standardStrings);
        if (!analysis) return empty;
        const { query, prefix, quoted, routine } = analysis;
        const start = model.getPositionAt(analysis.start), end = model.getPositionAt(analysis.end);
        if (start.lineNumber !== end.lineNumber) return empty;
        const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
        const windows = analysis.windows;
        if (windows) {
          const normalized = (name: string) => quoted ? name : name.replace(/[A-Z]/g, character => character.toLowerCase());
          const suggestions: monaco.languages.CompletionItem[] = windows.names.filter(name => normalized(name).startsWith(normalized(prefix)))
            .map((name, index) => ({ range, kind: options.kinds.variable, label: { label: name, description: postgresZh.namedWindow },
              insertText: postgresIdentifier(name), filterText: quoted ? postgresIdentifier(name) : name,
              sortText: '0' + String(index).padStart(3, '0') }));
          if (windows.inline && !quoted) {
            for (const label of ['PARTITION BY', 'ORDER BY', 'ROWS', 'RANGE', 'GROUPS'].filter(word => word.startsWith(prefix.toUpperCase()))) {
              suggestions.push({ label, kind: options.kinds.keyword, insertText: label, range, sortText: '9' + label });
            }
          }
          return { suggestions: suggestions.slice(0, postgresCompletionLimits.items), incomplete: true };
        }
        const using = query?.kind === 'using' ? query : undefined;
        const joinOutput = query?.kind === 'columns' ? query.joinOutput : undefined;
        let joined: ReturnType<typeof joinedOutputColumns>;
        let inventoryFailed = false;
        const normalize = (name: string) => quoted ? name : name.replace(/[A-Z]/g, letter => letter.toLowerCase());
        const joinMatches = (name: string) => normalize(name).startsWith(normalize(prefix));
        if (query?.kind === 'conflictTarget') {
          await debounce(controller.signal, 100);
          try {
            const result = await request({ ...target, kind: 'conflictTargets', relation: query.relation, selection: query.selection, prefix }, current);
            if (!result || !current()) return empty;
            if (result.deferred) options.status(result.deferred === 'transaction' ? 'sessionUnknown' : 'unavailable');
            else if (result.incomplete) options.status('partial');
            const suggestions: monaco.languages.CompletionItem[] = [];
            const seen = new Set<string>();
            for (const item of result.items) {
              let names: string[], description: string, key: string;
              let insertion: string | undefined, filter: string | undefined;
              if (query.selection.mode === 'constraint' && item.kind === 'conflictConstraint' && joinMatches(item.name)) {
                if (item.constraint === 'exclusion' && !query.selection.allowExclusion) continue;
                names = [item.name];
                description = item.constraint === 'primary' ? postgresZh.conflictPrimary :
                  item.constraint === 'unique' ? postgresZh.conflictUnique : postgresZh.conflictExclusion;
                key = item.name;
              } else if (query.selection.mode === 'key' && item.kind === 'conflictKey') {
                const used = query.selection.used;
                if (!used.every(name => item.columns.includes(name))) continue;
                const rest = item.columns.filter(name => !used.includes(name));
                const first = rest.findIndex(joinMatches);
                if (first < 0) continue;
                key = JSON.stringify([...rest].sort());
                names = [rest[first], ...rest.slice(0, first), ...rest.slice(first + 1)];
                description = (item.primary ? postgresZh.conflictPrimary : postgresZh.conflictUnique) + ' · ' + item.name;
              } else if (query.selection.mode === 'key' && query.selection.whole && item.kind === 'conflictIndex') {
                const relation = query.relation.name;
                const fragments = item.terms.map(term => 'column' in term ? postgresIdentifier(term.column) :
                  postgresConflictExpression(term.expression, relation));
                const predicate = item.predicate === undefined ? undefined : postgresConflictExpression(item.predicate, relation);
                if (!fragments.length || fragments.some(fragment => !fragment) || item.predicate !== undefined && !predicate) continue;
                names = item.terms.map(term => 'column' in term ? term.column : term.expression);
                filter = names.map(name => name.replace(/^[ (]+/, '')).find(joinMatches);
                if (!filter && joinMatches(item.name)) filter = item.name;
                if (!filter) continue;
                const sql = fragments.map((fragment, index) => 'column' in item.terms[index] ? fragment : '(' + fragment + ')').join(', ');
                insertion = '(' + sql + ')' + (predicate ? ' WHERE (' + predicate + ')' : '');
                key = JSON.stringify(['index', [...fragments].sort(), predicate]);
                description = (predicate ? postgresZh.conflictPartial : postgresZh.conflictExpression) + ' · ' + item.name;
              } else continue;
              if (seen.has(key)) continue;
              seen.add(key);
              const sql = names.map(postgresIdentifier).join(', ');
              suggestions.push({ range, kind: options.kinds.column, label: { label: names.join(', '), description },
                insertText: insertion ?? (query.selection.mode === 'key' && query.selection.whole ? '(' + sql + ')' : sql),
                filterText: quoted ? postgresIdentifier(filter ?? names[0]) : filter ?? names[0],
                sortText: String(suggestions.length).padStart(3, '0') });
            }
            return { incomplete: true, suggestions: suggestions.slice(0, postgresCompletionLimits.items) };
          } catch {
            if (current()) options.status('unavailable');
            return empty;
          }
        }
        if (using || joinOutput) {
          const sources = using ? [using.left, using.right] : joinOutput
            ? [joinOutput.source, ...joinOutput.qualifiers.map(item => item.source)] : [];
          const relations = joinCatalogRelations(sources);
          if (relations) {
            let inventory: PostgresCompletionResult = { items: [], incomplete: false };
            if (relations.length) {
              await debounce(controller.signal, 100);
              try {
                const result = await request({ ...target, kind: 'joinColumns', prefix: '', relations }, current);
                if (!result || !current()) return empty;
                inventory = result;
              } catch {
                if (!current()) return empty;
                options.status('unavailable');
                if (using) return empty;
                inventoryFailed = true;
              }
            }
            if (inventory.deferred) options.status(inventory.deferred === 'transaction' ? 'sessionUnknown' : 'unavailable');
            else if (inventory.incomplete) options.status('partial');
            if (using) {
              const names = sharedJoinColumns(using, relations, inventory)?.filter(joinMatches);
              if (!names) return empty;
              if (names.length > postgresCompletionLimits.items) options.status('partial');
              return { incomplete: true, suggestions: names.slice(0, postgresCompletionLimits.items).map((name, index) => ({
                range, kind: options.kinds.column, label: { label: name, description: postgresZh.joinSharedColumn },
                insertText: postgresIdentifier(name), filterText: quoted ? postgresIdentifier(name) : name,
                sortText: String(index).padStart(3, '0'),
              })) };
            }
            if (joinOutput && !inventoryFailed) joined = joinedOutputColumns(joinOutput, relations, inventory);
          }
          if (using) return empty;
        }
        const references: PostgresCompletionReference[] = [];
        const origins: number[] = [];
        const localColumns: { reference: number; name: string; type?: string }[] = [];
        const matches = (name: string) => name.toLowerCase().startsWith(prefix.toLowerCase());
        if (query?.kind === 'columns' && !joined) {
          for (const [index, ref] of query.relations.entries()) {
            if (isJoinedProjection(ref)) continue;
            for (const source of catalogColumnReferences(ref)) {
              references.push(source);
              origins.push(index);
            }
            for (const name of ref.projection?.names ?? []) {
              if (name && matches(name)) localColumns.push({ reference: index, name });
            }
          }
        }
        const base = { ...target, prefix, ...(routine ? { routine } : {}) };
        // CTE 名称、别名和投影只在编辑器中使用，目录只接收实际物理目标。
        const input: PostgresCompletionInput | undefined = inventoryFailed ? undefined : query?.kind === 'relations'
          ? { ...base, kind: 'relations', ...(query.schema ? { schema: query.schema } : {}), ...(query.mergeTarget ? { mergeTarget: true } : {}) }
          : references.length > 0 && references.length <= postgresCompletionLimits.relations
            ? { ...base, kind: 'columns', relations: references } : routine ? { ...base, kind: 'routines', routine } : undefined;
        let result: PostgresCompletionResult = { items: [], incomplete: false };
        if (input) {
          await debounce(controller.signal, 100);
          try { result = await request(input, current) ?? result; }
          catch { if (current()) options.status('unavailable'); }
          if (!current()) return empty;
        }
        const suggestions: monaco.languages.CompletionItem[] = [];
        for (const {name, qualifier} of joined ?? []) {
          if (!joinMatches(name)) continue;
          const qualifiedName = qualifier ? [qualifier.schema, qualifier.name].filter((part): part is string => !!part)
            .map(postgresIdentifier).join('.') : undefined;
          suggestions.push({ range, kind: options.kinds.column,
            label: { label: name, description: qualifiedName ?? postgresZh.joinOutputColumn },
            insertText: (qualifiedName ? qualifiedName + '.' : '') + postgresIdentifier(name),
            filterText: quoted ? postgresIdentifier(name) : name, sortText: '0' + String(suggestions.length).padStart(3, '0') });
        }
        // 本地对象排在目录前；显式 schema 仍可选择同名物理关系。
        for (const name of query?.kind === 'relations' ? query.ctes ?? [] : []) {
          if (!matches(name)) continue;
          suggestions.push({ range, kind: options.kinds.table, label: { label: name, description: 'CTE' },
            insertText: postgresIdentifier(name), filterText: quoted ? postgresIdentifier(name) : name,
            sortText: '0' + String(suggestions.length).padStart(3, '0') });
        }
        for (const item of result.items) {
          if (item.kind === 'columnDetail' || item.kind === 'joinColumns' || item.kind === 'conflictConstraint' ||
              item.kind === 'conflictKey' || item.kind === 'conflictIndex') continue;
          const filterText = quoted ? '"' + item.name.replaceAll('"', '""') : item.name;
          const common = { range, kind: options.kinds[item.kind], filterText, sortText: '0' + String(suggestions.length).padStart(3, '0') };
          if (item.kind === 'schema' && query?.kind === 'relations' && !query.schema) {
            suggestions.push({ ...common, label: item.name, insertText: postgresIdentifier(item.name) + '.',
              command: { id: 'editor.action.triggerSuggest', title: '' } });
          } else if ((item.kind === 'table' || item.kind === 'view') && query?.kind === 'relations') {
            suggestions.push({ ...common, label: { label: item.name, description: item.schema },
              insertText: (query.schema ? '' : postgresIdentifier(item.schema) + '.') + postgresIdentifier(item.name) });
          } else if (item.kind === 'column' && origins[item.reference] !== undefined) {
            localColumns.push({ reference: origins[item.reference], name: item.name, type: item.type || undefined });
          } else if (item.kind === 'routine' && routine) {
            const name = postgresIdentifier(item.name);
            const insert = analysis.existingCall ? { insertText: name } : {
              insertText: name.replace(/[\\$}]/g, value => '\\' + value) + '($0)', insertTextRules: options.snippetRule,
              command: { id: 'editor.action.triggerParameterHints', title: '' },
            };
            suggestions.push({ ...common, ...insert, sortText: '1' + common.sortText,
              label: { label: item.name, detail: '(' + item.arguments + ')', description: item.schema + (item.returns ? ' → ' + item.returns : '') } });
          }
        }
        if (query?.kind === 'columns') {
          const counts = new Map<string, number>();
          for (const { reference, name } of localColumns) {
            const key = reference + ':' + name;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
          for (const { reference, name, type } of localColumns) {
            if (counts.get(reference + ':' + name) !== 1) continue;
            const ref = query.relations[reference];
            const qualified = !query.qualified && query.relations.length > 1;
            const qualifier = qualified ? (ref.alias ? postgresIdentifier(ref.alias) : ref.schema
              ? postgresIdentifier(ref.schema) + '.' + postgresIdentifier(ref.name) : postgresIdentifier(ref.name)) + '.' : '';
            suggestions.push({ range, kind: options.kinds.column, label: { label: name, description: ref.alias ?? ref.name },
              insertText: qualifier + postgresIdentifier(name), detail: type,
              filterText: quoted ? postgresIdentifier(name) : name, sortText: '0' + String(suggestions.length).padStart(3, '0') });
          }
        }
        const hasDot = source.slice(0, analysis.start).trimEnd().endsWith('.');
        for (const label of analysis.keywords ?? []) {
          suggestions.unshift({ label, kind: options.kinds.keyword, insertText: label, range, sortText: '0 ' + label });
        }
        if (!quoted && !hasDot && query?.kind !== 'relations' && routine?.context !== 'call' && routine?.context !== 'from') {
          for (const label of keywords.filter(word => word.startsWith(prefix.toUpperCase()))) {
            suggestions.push({ label, kind: options.kinds.keyword, insertText: label, range, sortText: '9' + label });
          }
        }
        if (result.deferred === 'transaction') options.status('sessionUnknown');
        else if (result.deferred === 'busy') options.status('unavailable');
        else if (result.incomplete || suggestions.length > postgresCompletionLimits.items) options.status('partial');
        return { suggestions: suggestions.slice(0, postgresCompletionLimits.items), incomplete: !!query || !!routine };
      } finally {
        cancel.dispose();
        change.dispose();
        if (active === controller) active = undefined;
      }
    },
    /** 标签切换即撤销本次请求，返回原标签也不会复活旧建议。 */
    invalidate() { active?.abort(); signatureGeneration++; hoverGeneration++; },
    /** 卸载后只终止本地交付，原目录承诺仍由引擎按原连接收尾。 */
    dispose() { disposed = true; active?.abort(); signatureGeneration++; hoverGeneration++; },
  };
}
