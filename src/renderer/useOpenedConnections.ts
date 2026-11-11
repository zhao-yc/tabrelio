import { useEffect, useState } from 'react';
import { invoke } from './lib';

/** 先订阅再读快照；读取过程中收到新状态时，旧响应不能恢复已断开的连接。 */
export function useOpenedConnections(enabled: boolean) {
  const [state, setState] = useState<{ ids?: string[]; failed?: boolean }>({});
  useEffect(() => {
    if (!enabled) {
      setState(previous => previous.ids || previous.failed ? {} : previous);
      return;
    }
    let current = true, received = false;
    const stop = window.dbark.onOpenedConnections(ids => {
      if (!current) return;
      received = true;
      setState({ ids });
    });
    void invoke('connections.opened', {}).then(ids => {
      if (current && !received) setState({ ids });
    }).catch(() => {
      if (current && !received) setState({ failed: true });
    });
    return () => { current = false; stop(); };
  }, [enabled]);
  return state;
}
