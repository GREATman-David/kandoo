import { useCallback, useEffect, useState } from 'react';

import { isEntitled } from '@/services/purchases';

/**
 * The one place the client reads the `kandoo_pro` entitlement. It drives what
 * the UI shows — the Free/Pro badge and the account sheet — never what access is
 * granted; the backend enforces memory depth server-side. `refresh` is called
 * after a purchase so the badge flips immediately.
 */
export function useEntitlement() {
  const [isPro, setIsPro] = useState(false);

  const refresh = useCallback(async () => {
    setIsPro(await isEntitled());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { isPro, refresh };
}
