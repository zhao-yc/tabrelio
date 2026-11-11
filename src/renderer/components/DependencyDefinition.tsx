import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import type { editor } from 'monaco-editor';
import type { ConnectionProfile } from '../../shared/contracts';
import { invoke, errorMessage } from '../lib';
import { readDependencyDefinition, type DependencyDefinitionTarget } from '../objectDependencies';
import { objectInformationZh as text } from '../locales/objectInformation.zh-CN';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Spinner } from './ui';

/** 单次预览只属于原依赖列表和目录项。退出时取消该定义读取，不更改选中的对象。 */
export function DependencyDefinition({ profile, target, identity, current, onBack }: {
  profile: ConnectionProfile; target: DependencyDefinitionTarget; identity: string;
  current(): boolean; onBack(): void;
}) {
  const [result, setResult] = useState<{ sql: string } | { error: string }>();
  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor>();
  const back = useRef<HTMLButtonElement>(null), mounted = useRef(false), latest = useRef(current);
  latest.current = current;
  useLayoutEffect(() => {
    mounted.current = true;
    back.current?.focus({ preventScroll: true });
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true, taskId: string | undefined;
    const live = () => active && mounted.current && latest.current();
    if (live()) void readDependencyDefinition(profile, target, id => { taskId = id; }).then(sql => {
      if (live()) setResult({ sql });
    }, error => {
      if (live()) setResult({ error: errorMessage(error) });
    }).finally(() => { taskId = undefined; });
    return () => {
      active = false;
      if (taskId) void invoke('query.cancel', { taskId }).catch(() => {});
    };
  }, [profile, target]);

  function find() {
    if (!editorInstance || !current() || editorInstance.getModel()?.isDisposed() !== false) return;
    editorInstance.focus();
    void editorInstance.getAction('actions.find')?.run().catch(() => {});
  }

  return <section className="object-info-dependency-definition" aria-label={text.dependencyDefinition}>
    <div className="object-info-dependency-definition-actions">
      <button type="button" ref={back} onClick={onBack}><ArrowLeft size={14}/>{text.backToDependencies}</button>
      <span className="grow"/>
      <button type="button" className="icon-button" aria-label={text.find} title={text.find} disabled={!editorInstance} onClick={find}><Search size={14}/></button>
    </div>
    <strong className="object-info-dependency-definition-name">{identity}</strong>
    {!result ? <Spinner text={text.loadingDependencyDefinition}/> : 'error' in result ? <ErrorBox message={result.error}/> :
      result.sql ? <div className="object-info-dependency-editor"><SqlEditor value={result.sql} dialect={profile.dialect} readOnly
        onReady={instance => { if (mounted.current && latest.current()) setEditorInstance(instance); }}/></div> :
        <p role="status">{text.noDefinition}</p>}
  </section>;
}
