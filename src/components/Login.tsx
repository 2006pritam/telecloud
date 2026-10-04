import { useCallback, useState } from 'react';
import { Cloud, KeyRound, Loader2 } from 'lucide-react';
import { api } from '../api';
import Turnstile from './Turnstile';

export default function Login({ onDone, turnstileSiteKey }: { onDone: () => void; turnstileSiteKey?: string | null }) {
  const [password, setPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      await api.login(password, turnstileToken);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const turnstileError = useCallback(() => {
    setTurnstileToken('');
    setError('The security check could not be completed. Please try again.');
  }, []);

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
            autoFocus
            placeholder="Site password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {turnstileSiteKey && (
          <Turnstile siteKey={turnstileSiteKey} onToken={setTurnstileToken} onError={turnstileError} />
        )}
        {error && <div className="form-error">{error}</div>}
        <button
          className="btn primary block"
          type="submit"
          disabled={busy || !password || (!!turnstileSiteKey && !turnstileToken)}
        >
          {busy && <Loader2 size={16} className="spin" />}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
