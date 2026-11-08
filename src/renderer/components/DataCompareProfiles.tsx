import { useCallback } from 'react';
import type { DataCompareBatchConfiguration } from '../../shared/dataCompareBatch';
import { dataCompareProfileLimits, type DataCompareConfiguration, type DataCompareProfileFamily } from '../../shared/dataCompareProfiles';
import { invoke } from '../lib';
import { dataCompareProfilesZh as text, dataCompareBatchProfilesZh as batchText } from '../locales/dataCompareProfiles.zh-CN';
import { NamedProfiles } from './NamedProfiles';

type Props = { family: DataCompareProfileFamily; disabled: boolean } & (
  { area?: undefined; options?: DataCompareConfiguration; onApply(configuration: DataCompareConfiguration): boolean } |
  { area: 'batch'; options?: DataCompareBatchConfiguration; onApply(configuration: DataCompareBatchConfiguration): Promise<boolean> }
);

export function DataCompareProfiles(props: Props) {
  const { family, area, options, disabled } = props;
  const scope = { family, area };
  const list = useCallback(() => invoke('dataCompareProfiles.list', { family, area }), [family, area]);
  return <NamedProfiles key={family + '/' + (area ?? '')} limits={dataCompareProfileLimits} options={options} disabled={disabled}
    text={area === 'batch' ? batchText : text} list={list}
    mutate={input => {
      if (input.kind === 'delete') return invoke('dataCompareProfiles.mutate', { ...scope, ...input });
      const { profile: { name, options: configuration }, ...change } = input;
      return invoke('dataCompareProfiles.mutate', { ...scope, ...change, profile: { name, configuration } });
    }}
    onApply={async selected => {
      const configuration = await invoke('dataCompareProfiles.read', { ...scope, selected });
      if ('pairs' in configuration) return props.area === 'batch' && props.onApply(configuration);
      return !props.area && props.onApply(configuration);
    }}/>;
}
