import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface UserCapacity {
  used: number;
  max: number;
  over: boolean;
}

export function useUserCapacity(enabled: boolean, refreshKey: number): UserCapacity | null {
  const [capacity, setCapacity] = useState<UserCapacity | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_my_plan');
      if (cancelled) return;
      const plan = data as { max_users?: unknown; active_users?: unknown; over_user_limit?: unknown } | null;
      if (error || !plan || typeof plan.max_users !== 'number' || typeof plan.active_users !== 'number') {
        setCapacity(null);
        return;
      }
      setCapacity({
        used: plan.active_users,
        max: plan.max_users,
        over: plan.over_user_limit === true || plan.active_users > plan.max_users,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);

  return capacity;
}
