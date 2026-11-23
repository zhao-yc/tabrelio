import { analyzeSqliteCompletion, sqliteReferenceContext } from './sqliteCompletionAnalysis';
import { analyzeSqliteLocalReferences } from './sqliteLocalReferences';
import { planLocalRename, planSqliteParameterRename } from './localRename';

/** SQLite重命名只用自己的语句、引号和绑定证明，不借用MySQL模式或大小写规则。 */
export function analyzeSqliteLocalRename(source: string, offset: number, newName?: string) {
  const context = sqliteReferenceContext(source, offset);
  if (context.status !== 'ready') return context;
  if (context.parameter) return planSqliteParameterRename(context, newName);
  const references = analyzeSqliteLocalReferences(source, offset);
  return planLocalRename(context, references, 'sqlite', reference => {
    let kind: 'alias' | 'cte' | 'window' | 'physical' | undefined;
    const proof = analyzeSqliteCompletion(source, reference.end, 'definition', value => { kind = value; });
    return proof.status === 'ready' && references.status === 'ready' && references.declaration && proof.definition?.start === references.declaration.start ? kind : undefined;
  }, newName);
}
