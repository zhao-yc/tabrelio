import { gridRangeCopyZh as text } from './locales/gridRangeCopy.zh-CN';

export function gridRangeCopyActions(copy: (headers: boolean) => void) {
  return [
    { label: text.copy, run: () => copy(false) },
    { label: text.withHeaders, run: () => copy(true) },
  ];
}
