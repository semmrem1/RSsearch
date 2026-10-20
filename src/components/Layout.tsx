import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppContext';
import { dateTime } from '../lib/format';
import type { LaufProtokoll } from '../lib/types';

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <rect x="1" y="1" width="24" height="24" rx="6" fill="#1D5B84" />
      <path d="M7 18V11l6-4 6 4v7" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" />
      <path d="M11 18v-4h4v4" fill="none" stroke="#FFFFFF" strokeWidth="2" />
    </svg>
  );
}

export function Avatar({ id, size }: { id: string | null; size?: 'sm' }) {
  const { profileById } = useApp();
  const p = profileById(id);
  const cls = 'avatar' + (size === 'sm' ? ' sm' : '');
  if (p === null) {
    return <span className={cls} style={{ background: '#EFEFEC', color: '#3E454C' }} title="System">⚙</span>;
  }
  return <span className={cls} style={{ background: p.farbe }} title={p.name}>{p.kuerzel}</span>;
}

export default function Layout() {
  const { me, profiles, leser } = useApp();
  const [lastRun, setLastRun] = useState<LaufProtokoll[] | null>(null);

  useEffect(() => {
    supabase.from('lauf_protokoll').select('*').order('gestartet_am', { ascending: false }).limit(20)
      .then(({ data }) => { if (data) { setLastRun(data as LaufProtokoll[]); } });
  }, []);

  let runText = 'Noch kein Lauf protokolliert';
  let runOk = false;
  if (lastRun !== null && lastRun.length > 0) {
    const latestDay = lastRun[0].gestartet_am.slice(0, 10);
    const sameDay = lastRun.filter((r) => r.gestartet_am.slice(0, 10) === latestDay);
    const checked = sameDay.filter((r) => r.geprueft).length;
    runOk = sameDay.every((r) => r.fehler === null);
    runText = 'Letzter Lauf ' + dateTime(lastRun[0].gestartet_am) + ' · ' + checked + ' von ' + sameDay.length + ' Maklern geprüft';
  }

  return (
    <>
      <header className="app-header">
        <div className="inner">
          <Link to="/" className="brand"><Logo />PRimmo</Link>
          <nav className="nav" aria-label="Hauptnavigation">
            <NavLink to="/" end>Übersicht</NavLink>
            <NavLink to="/pipeline">Pipeline</NavLink>
            <NavLink to="/inserate">Inserate</NavLink>
            <NavLink to="/karte">Karte</NavLink>
            <NavLink to="/dokumente">Dokumente</NavLink>
          </nav>
          <div className="header-right">
            <Link to="/lauf" className="run-status" style={{ textDecoration: 'none' }} title="Lauf-Protokoll">
              <span className="dot" style={{ background: runOk ? 'var(--green)' : 'var(--amber)' }} />
              <span>{runText}</span>
            </Link>
            {!leser ? <NavLink to="/einstellungen" className="btn sm" aria-label="Einstellungen" title="Einstellungen">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
            </NavLink> : <span className="chip neutral" title="Dieses Konto darf nur lesen">Nur Lesen</span>}
            <div className="avatars">
              {profiles.map((p) => <Avatar key={p.id} id={p.id} />)}
            </div>
            <button type="button" className="btn sm" onClick={() => supabase.auth.signOut()} title={me !== null ? 'Abmelden (' + me.name + ')' : 'Abmelden'} aria-label="Abmelden">
              <span className="btn-text">Abmelden</span>
              <svg className="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></svg>
            </button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <nav className="mobile-tabs" aria-label="Tabs">
        <NavLink to="/" end>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12h16M4 6h16M4 18h10" /></svg>Feed
        </NavLink>
        <NavLink to="/pipeline">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" /><rect x="17" y="4" width="4" height="13" rx="1" /></svg>Pipeline
        </NavLink>
        <NavLink to="/inserate">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>Inserate
        </NavLink>
        <NavLink to="/karte">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></svg>Karte
        </NavLink>
        <NavLink to="/dokumente">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 2h8l6 6v14H6z" /><path d="M14 2v6h6" /></svg>Dokumente
        </NavLink>
      </nav>
    </>
  );
}
