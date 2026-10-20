import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setError('Anmeldung fehlgeschlagen: ' + err.message); }
    setBusy(false);
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="6" fill="#1D5B84" /><path d="M7 18V11l6-4 6 4v7" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" /><path d="M11 18v-4h4v4" fill="none" stroke="#FFFFFF" strokeWidth="2" /></svg>
          <span style={{ fontWeight: 700, fontSize: 17 }}>PRimmo</span>
        </div>
        <p className="muted">Anmelden mit deinem Konto.</p>
        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="pw">Passwort</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error !== null ? <div className="notice">{error}</div> : null}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Bitte warten …' : 'Anmelden'}</button>
      </form>
    </div>
  );
}
