import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { queryPinsZh as text } from '../locales/queryPins.zh-CN';
import { zh } from '../locales/zh-CN';
import { appModalSelector } from '../modalSelectors';
import { pinnedResultName, type PinnedQueryResult } from '../queryPins';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal } from './ui';

interface Props {
  tabId: string;
  pin: PinnedQueryResult;
  disabled: boolean;
  isCurrent(): boolean;
  onRename(pin: PinnedQueryResult, name: string): boolean;
}

/** 对话框只持有打开时的固定项，名称提交前再次核对标签、作业及结果身份。 */
export function PinnedResultRename(props: Props) {
  const { tabId, pin, disabled } = props;
  const latest = useRef(props);
  latest.current = props;
  const [owner, setOwner] = useState<{ pin: PinnedQueryResult; current(): boolean; invalidate(): void }>();
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null), composing = useRef(false);
  const opened = owner?.pin === pin && !disabled;
  useLayoutEffect(() => {
    if (!opened) {
      if (owner) setOwner(undefined);
      return;
    }
    return useWorkspace.subscribe(() => {
      if (!owner.current()) {
        owner.invalidate();
        setOwner(undefined);
      }
    });
  }, [owner, opened]);

  function open() {
    if (disabled || !props.isCurrent() || document.querySelector(appModalSelector)) return;
    const workspace = useWorkspace.getState(), tab = workspace.settings.tabs.find(item => item.id === tabId);
    if (!tab || workspace.settings.activeTabId !== tabId || workspace.activeJobs[tabId]) return;
    const version = workspace.connectionVersions[tab.connectionId];
    let valid = true;
    composing.current = false;
    setValue(pin.label);
    setOwner({ pin, invalidate() { valid = false; }, current() {
      const state = useWorkspace.getState();
      return valid && state.settings.activeTabId === tabId && state.settings.tabs.find(item => item.id === tabId) === tab &&
        state.connectionVersions[tab.connectionId] === version && !state.activeJobs[tabId];
    } });
  }

  const name = opened ? pinnedResultName(value) : undefined;
  return <>
    <button type="button" disabled={disabled} aria-haspopup="dialog" onClick={open}>{text.rename}</button>
    {opened && createPortal(<Modal title={text.rename} initialFocus={input} onClose={() => setOwner(undefined)}>
      <form data-pinned-result-rename={tabId} onSubmit={event => {
        event.preventDefault();
        const dialog = input.current?.closest(appModalSelector), surfaces = document.querySelectorAll(appModalSelector);
        if (composing.current || !name || name === pin.label || !owner.current() || !dialog || dialog !== surfaces[surfaces.length - 1]) return;
        flushSync(() => setOwner(undefined));
        const current = latest.current;
        if (!owner.current() || current.pin !== owner.pin || current.disabled || !current.isCurrent() || !current.onRename(owner.pin, name))
          useWorkspace.getState().notify(text.stale, true);
      }}>
        <div className="modal-content">
          <Field label={text.name}><input ref={input} value={value} maxLength={256}
            onFocus={event => event.currentTarget.select()} onChange={event => setValue(event.target.value)}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}/></Field>
          <ErrorBox message={name || value === pin.label ? undefined : text.invalid}/>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={() => setOwner(undefined)}>{zh.common.cancel}</button>
          <span className="grow"/>
          <button type="submit" className="primary" disabled={!name || name === pin.label}>{zh.common.save}</button>
        </footer>
      </form>
    </Modal>, document.body)}
  </>;
}
