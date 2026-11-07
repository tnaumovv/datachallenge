import { useEffect, useState } from 'react';
import type { ChecklistProfile } from '../../shared/checklist-profiles.js';
import { api } from './api';
export function useProfiles() {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error';
    profiles: ChecklistProfile[];
  }>({ status: 'loading', profiles: [] });
  const [loadKey, setLoadKey] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    api.profiles(c.signal).then(
      (profiles) => {
        if (!c.signal.aborted) setState({ status: 'ready', profiles });
      },
      () => {
        if (!c.signal.aborted) setState({ status: 'error', profiles: [] });
      },
    );
    return () => c.abort();
  }, [loadKey]);
  return {
    ...state,
    reload: () => {
      setState({ status: 'loading', profiles: [] });
      setLoadKey((key) => key + 1);
    },
  };
}
