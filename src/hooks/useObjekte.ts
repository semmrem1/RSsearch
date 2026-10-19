import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ObjektUebersicht } from '../lib/types';

export function useObjekte() {
  const [objekte, setObjekte] = useState<ObjektUebersicht[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('v_objekte_uebersicht')
      .select('*')
      .order('erstmals_gesehen', { ascending: false })
      .order('created_at', { ascending: false });
    if (err) { setError(err.message); } else if (data) { setObjekte(data as ObjektUebersicht[]); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { objekte, loading, error, reload };
}
