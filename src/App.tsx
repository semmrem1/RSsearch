import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { AppProvider } from './state/AppContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Uebersicht from './pages/Uebersicht';
import Pipeline from './pages/Pipeline';
import Inserate from './pages/Inserate';
import Detail from './pages/Detail';
import Dokumente from './pages/Dokumente';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) { return null; }
  if (session === null) { return <Login />; }

  return (
    <AppProvider session={session}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Uebersicht />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/inserate" element={<Inserate />} />
          <Route path="/inserate/:id" element={<Detail />} />
          <Route path="/dokumente" element={<Dokumente />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
