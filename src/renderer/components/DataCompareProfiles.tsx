import { useCallback } from 'react';
import { dataCompareProfileLimits, type DataCompareConfiguration, type DataCompareProfileFamily } from '../../shared/dataCompareProfiles';
import { invoke } from '../lib';
import { dataCompareProfilesZh as text } from '../locales/dataCompareProfiles.zh-CN';
import { NamedProfiles } from './NamedProfiles';

export function DataCompareProfiles({ family, options, disabled, onApply }: {
  family: DataCompareProfileFamily;
  options?: DataCompareConfiguration;
  disabled: boolean;
  onApply(configuration: DataCompareConfiguration): boolean;
}) {
  const list = useCallback(() => invoke('dataCompareProfiles.list', { family }), [family]);
  return <NamedProfiles key={family} limits={dataCompareProfileLimits} options={options} disabled={disabled} text={text} list={list}
    mutate={input => {
      if (input.kind === 'delete') return invoke('dataCompareProfiles.mutate', { family, ...input });
      const { profile: { name, options: configuration }, ...change } = input;
      return invoke('dataCompareProfiles.mutate', { family, ...change, profile: { name, configuration } });
    }}
    onApply={async selected => onApply(await invoke('dataCompareProfiles.read', { family, selected }))}/>;
}
