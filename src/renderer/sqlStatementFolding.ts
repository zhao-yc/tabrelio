import type { editor, languages } from 'monaco-editor';
import type { CompletionLexicalMode } from '../shared/completionLexical';
import type { SqlFoldingBlock } from '../shared/sqlFoldingBlocks';
import { statementNavigationLimits, statementNavigationStart, type NavigableStatement, type StatementNavigationDialect } from '../shared/statementNavigation';
import type { StatementNavigationWorkerClient } from './statementNavigationWorkerClient';

/** 折叠整行时保留起始行。末行带有其他语句或注释时也必须保留。 */
export function statementFoldingRanges(model: Pick<editor.ITextModel, 'getPositionAt' | 'getLineContent'>, statements: readonly NavigableStatement[], source: string, dialect: StatementNavigationDialect, blocks: readonly SqlFoldingBlock[] = []): languages.FoldingRange[] {
  const ranges: languages.FoldingRange[] = [];
  for (const statement of statements) {
    const start = model.getPositionAt(statementNavigationStart(source, statement, dialect)).lineNumber;
    const offset = statement.delimiterStart < statement.delimiterEnd ? statement.delimiterEnd : statement.end;
    const last = model.getPositionAt(offset - 1);
    const suffix = model.getLineContent(last.lineNumber).slice(last.column);
    const end = last.lineNumber - (suffix.trim() ? 1 : 0);
    if (end > start) ranges.push({ start, end });
  }
  for (const block of blocks) {
    const start = model.getPositionAt(block.start).lineNumber;
    // 闭括号行可能含别名、逗号、下个块或条件，始终保留整行。
    const end = model.getPositionAt(block.end - 1).lineNumber - 1;
    if (end > start) ranges.push({ start, end });
  }
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  // Monaco 每行只有一个折叠按钮，同一行保留外层范围。
  return ranges.filter((range, index) => index === 0 || range.start !== ranges[index - 1].start);
}

/** 只扫描当前编辑器模型。取消、正文更新或卸载后，旧线程不能提交折叠范围。 */
export function sqlStatementFoldingProvider(instance: Pick<editor.IStandaloneCodeEditor, 'getModel'>, dialect: StatementNavigationDialect, client: Pick<StatementNavigationWorkerClient, 'analyze'>, active: () => boolean, mode: CompletionLexicalMode = {}): languages.FoldingRangeProvider {
  let cached: { model: editor.ITextModel; version: number; ranges?: languages.FoldingRange[] } | undefined;
  return {
    async provideFoldingRanges(model, _context, token) {
      const current = () => active() && !token.isCancellationRequested && !model.isDisposed() && instance.getModel() === model;
      if (!current() || model.getLineCount() < 2 || model.getValueLength() > statementNavigationLimits.sourceUnits) return;
      const version = model.getVersionId();
      if (cached?.model === model && cached.version === version) return cached.ranges;
      const abort = new AbortController();
      const subscription = token.onCancellationRequested(() => abort.abort());
      try {
        // 只用已有会话模式缓存。未知模式由线程验证语句与块边界。
        const source = model.getValue();
        const result = await client.analyze(source, dialect, mode, abort.signal, true);
        if (!current() || model.getVersionId() !== version) return;
        if (result.status === 'blocked') {
          if (['script', 'budget', 'input'].includes(result.reason)) cached = { model, version };
          return;
        }
        const ranges = statementFoldingRanges(model, result.statements, source, dialect, result.blocks);
        cached = { model, version, ranges: ranges.length ? ranges : undefined };
        return cached.ranges;
      } finally { subscription.dispose(); }
    },
  };
}
