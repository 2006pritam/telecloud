import { useState } from 'react';
import { Cloud, KeyRound, Loader2 } from 'lucide-react';
import { api } from '../api';

export default function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark">
          <Cloud size={30} strokeWidth={2.2} />
        </div>
        <h1>Telecloud</h1>
        <p>A little space for everything</p>
        <label className="field">
          <KeyRound size={16} />
          <input
            type="password"
            value={password}
            placeholder="Password"
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="btn primary block" type="submit" disabled={busy || !password}>
          {busy && <Loader2 size={16} className="spin" />}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <footer className="app-footer">
        <span>© 2026 All rights reserved by Pritam Kumar Modak</span>
      </footer>
    </div>
  );
}
