import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ObjektBudgetDaten } from '../lib/types';

/** Überschreibungen pro Objekt (Pensum, Posten, effektiver Zins), gespeichert in objekt_budget.daten. */
export function useObjektBudget(objektId: string | undefined) {
  const [daten, setDaten] = useState<ObjektBudgetDaten | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!objektId) { return; }
    setDaten(null);
    supabase.from('objekt_budget').select('daten').eq('objekt_id', objektId).maybeSingle()
      .then(({ data }) => { setDaten(data !== null ? (data as { daten: ObjektBudgetDaten }).daten : {}); });
  }, [objektId]);

  const speichern = useCallback((neu: ObjektBudgetDaten) => {
    if (!objektId) { return; }
    setDaten(neu);
    if (timer.current !== null) { window.clearTimeout(timer.current); }
    timer.current = window.setTimeout(() => {
      supabase.from('objekt_budget').upsert({ objekt_id: objektId, daten: neu, updated_at: new Date().toISOString() }).then(() => undefined);
    }, 400);
  }, [objektId]);

  return { daten, speichern };
}
