import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile, Stufe } from '../lib/types';

interface AppState {
  session: Session;
  me: Profile | null;
  profiles: Profile[];
  stufen: Stufe[];
  profileById: (id: string | null) => Profile | null;
  stufeByCode: (code: string) => Stufe | null;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stufen, setStufen] = useState<Stufe[]>([]);

  useEffect(() => {
    supabase.from('profiles').select('*').order('created_at').then(({ data }) => { if (data) { setProfiles(data as Profile[]); } });
    supabase.from('pipeline_stufen').select('*').order('sort').then(({ data }) => { if (data) { setStufen(data as Stufe[]); } });
  }, []);

  const me = profiles.find((p) => p.id === session.user.id) || null;
  const value: AppState = {
    session,
    me,
    profiles,
    stufen,
    profileById: (id) => { if (id === null) { return null; } return profiles.find((p) => p.id === id) || null; },
    stufeByCode: (code) => stufen.find((s) => s.code === code) || null,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (v === null) { throw new Error('useApp ausserhalb AppProvider'); }
  return v;
}
