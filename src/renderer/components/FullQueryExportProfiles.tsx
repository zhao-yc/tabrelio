import { useCallback } from 'react';
import { fullQueryExportProfileLimits, type FullQueryExportDialect, type FullQueryExportOptions } from '../../shared/fullQueryExportProfiles';
import { invoke } from '../lib';
import { fullQueryExportProfilesZh as text } from '../locales/fullQueryExportProfiles.zh-CN';
import { NamedProfiles } from './NamedProfiles';

export function FullQueryExportProfiles({ dialect, area, options, disabled, onApply }: {
  dialect: FullQueryExportDialect;
  area?: 'table';
  options?: FullQueryExportOptions;
  disabled: boolean;
  onApply(options: FullQueryExportOptions): boolean;
}) {
  const scope = { dialect, ...(area ? { area } : {}) };
  const list = useCallback(() => invoke('queryExportProfiles.list', { dialect, ...(area ? { area } : {}) }), [dialect, area]);
  return <NamedProfiles key={dialect + '/' + (area ?? '')} limits={fullQueryExportProfileLimits} options={options} disabled={disabled}
    text={{ ...text, hint: area === 'table' ? text.tableHint : text.hint }} list={list}
    mutate={input => invoke('queryExportProfiles.mutate', { ...scope, ...input })} onApply={entry => onApply(entry.options)}/>;
}
