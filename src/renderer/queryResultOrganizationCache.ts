import type { QueryResult, ResultColumn } from '../shared/contracts';
import { prepareQueryResultOrganization, type QueryResultOrganization } from './queryResultHistory';
import { queryResultFindLimits, type QueryResultFindMemory, type QueryResultFindSettings } from './queryResultFind';
import type { SortDialect } from './queryResultSort';

/** 每组只保留已应用的规则。切回时重新核对原结果和列，旧网格及操作票据不能复用。 */
export class QueryResultOrganizationCache {
  private configurations = new WeakMap<QueryResult, { execution: string | undefined; configuration: QueryResultOrganization }>();
  private findSettings = new WeakMap<QueryResult, { execution: string | undefined; settings: QueryResultFindSettings }>();
  private source?: QueryResult;
  private scope?: string;
  private execution?: string;
  private revision = 0;

  restore(source: QueryResult | undefined, scope: string, execution: string | undefined, context: readonly unknown[], visible: ResultColumn[] | undefined, dialect?: SortDialect) {
    const scopeChanged = this.scope !== scope;
    if (!scopeChanged && this.source === source && this.execution === execution) return;
    if (scopeChanged) {
      this.configurations = new WeakMap();
      this.findSettings = new WeakMap();
    }
    this.scope = scope;
    this.source = source;
    this.execution = execution;
    this.revision++;
    if (!source || !visible) return;
    const saved = this.configurations.get(source);
    if (!saved) return;
    // 新执行即使复用同一个结果对象，也要从原视图开始。固定结果没有执行编号。
    if (saved.execution !== execution) {
      this.configurations.delete(source);
      return;
    }
    try {
      return prepareQueryResultOrganization(source, context, visible, saved.configuration, dialect);
    } catch {
      // 原结果的元数据若已失效，丢弃整份配置，避免只恢复部分规则。
      this.configurations.delete(source);
    }
  }

  remember(source: QueryResult | undefined, scope: string, execution: string | undefined, configuration: QueryResultOrganization | undefined): void {
    if (!source || this.source !== source || this.scope !== scope || this.execution !== execution || !configuration) return;
    // 控制器已冻结规则及表达式。只保留配置，缓存不持有投影、行索引或网格状态。
    if (configuration.expression.children.length || configuration.sort.length) this.configurations.set(source, { execution, configuration });
    else this.configurations.delete(source);
  }

  /** 批量导出只读同一执行已经提交的规则，不必把后台结果切成当前组。 */
  readConfiguration(source: QueryResult, scope: string, execution: string | undefined): QueryResultOrganization | undefined {
    const saved = this.configurations.get(source);
    if (this.scope === scope && saved && saved.execution === execution) return saved.configuration;
  }

  /** 只保存查找条件，不持有查找任务、命中或勾选坐标。 */
  findMemory(source: QueryResult | undefined, scope: string, execution: string | undefined): QueryResultFindMemory | undefined {
    if (!source) return;
    const revision = this.revision;
    const current = () => this.revision === revision && this.source === source && this.scope === scope && this.execution === execution;
    return {
      read: () => {
        if (!current()) return;
        const saved = this.findSettings.get(source);
        if (saved && saved.execution === execution) return saved.settings;
      },
      remember: settings => {
        if (!current()) return;
        if (settings.query.length <= queryResultFindLimits.queryUnits) this.findSettings.set(source, { execution, settings });
        else this.findSettings.delete(source);
      },
      clear: () => {
        if (current()) this.findSettings.delete(source);
      },
    };
  }
}
