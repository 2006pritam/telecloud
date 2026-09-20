import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2, Phone, QrCode, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from '../api';
import type { Status } from '../types';

const STEPS = ['phone', 'code', 'password'] as const;
type Step = (typeof STEPS)[number] | 'qr';
type QrResult = { token: string; expiresAt: number };

function Steps({ current }: { current: (typeof STEPS)[number] }) {
  const index = STEPS.indexOf(current);
  return (
    <ol className="steps" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
      {STEPS.map((step, i) => (
        <li key={step} className={`step${i === index ? ' on' : ''}${i < index ? ' done' : ''}`}>
          <span className="step-dot" />
        </li>
      ))}
    </ol>
  );
}

/**
 * Three-step Telegram account link: phone → login code → optional 2FA password.
 * Each step posts to the server, which holds the half-finished auth key in
 * memory for this browser only; the Telegram session stays on the server.
 */
export default function LinkTelegram({ onLinked }: { onLinked: (telegram: Status['telegram']) => void }) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<QrResult | null>(null);
  const [qrImage, setQrImage] = useState('');

  const restart = () => {
    setStep('phone');
    setCode('');
    setPassword('');
    setHint('');
    setError('');
    setQr(null);
    setQrImage('');
  };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setPassword('');
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const submitPhone = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.telegram.sendCode(phone);
      setStep('code');
    });
  };

  const startQr = () => {
    void run(async () => {
      const result = await api.telegram.qrStart();
      setQr(result);
      setStep('qr');
    });
  };

  useEffect(() => {
    if (step !== 'qr' || !qr) return;
    let cancelled = false;
    void QRCode.toDataURL(`tg://login?token=${qr.token}`, { margin: 2, width: 240 })
      .then((image) => { if (!cancelled) setQrImage(image); })
      .catch(() => { if (!cancelled) setError('Could not render the QR code.'); });
    const poll = async () => {
      try {
        const result = await api.telegram.qrPoll();
        if (cancelled) return;
        if (result.step === 'done') onLinked(result.telegram);
        else setQr(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'QR login failed.');
      }
    };
    const timer = window.setInterval(() => void poll(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [step, qr, onLinked]);

  const submitCode = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await api.telegram.signIn(code);
      if (result.step === 'password') {
        setHint(result.hint ?? '');
        setStep('password');
      } else {
        onLinked(result.telegram);
      }
    });
  };

  const submitPassword = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await api.telegram.password(password);
      onLinked(result.telegram);
    });
  };

  return (
    <div className="login-screen">
      {step === 'phone' && (
        <form className="login-card" onSubmit={submitPhone}>
          <div className="login-mark">
            <Smartphone size={30} strokeWidth={2.2} />
          </div>
          <h1>Sign in with Telegram</h1>
          <p>Your files are stored in your own Telegram account.</p>
          <Steps current={step} />
          <label className="field">
            <Phone size={16} />
            <input
              type="tel"
              aria-label="Phone number"
              autoComplete="tel"
              value={phone}
              placeholder="+15551234567"
              autoFocus
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary block" type="submit" disabled={busy || !phone}>
            {busy && <Loader2 size={16} className="spin" />}
            {busy ? 'Sending code…' : 'Send login code'}
          </button>
          <button className="btn ghost block" type="button" disabled={busy} onClick={startQr}>
            <QrCode size={16} /> Use QR code instead
          </button>
          <p className="login-note">
            Use your own Telegram number. Your files and folders are kept separate from other users.
            Telegram will send your login code to an existing Telegram session or by SMS.
          </p>
        </form>
      )}

      {step === 'qr' && qr && (
        <div className="login-card">
          <div className="login-mark">
            <QrCode size={30} strokeWidth={2.2} />
          </div>
          <h1>Scan to sign in</h1>
          <p>Open Telegram on your phone, then scan this code from Settings.</p>
          <div className="qr-frame">
            {qrImage ? <img src={qrImage} alt="Telegram sign-in QR code" /> : <Loader2 size={24} className="spin" />}
          </div>
          <p className="login-note">The code refreshes automatically and expires shortly.</p>
          {error && <div className="form-error">{error}</div>}
          <button className="btn ghost block" type="button" disabled={busy} onClick={restart}>
            Use phone number instead
          </button>
        </div>
      )}

      {step === 'code' && (
        <form className="login-card" onSubmit={submitCode}>
          <div className="login-mark">
            <ShieldCheck size={30} strokeWidth={2.2} />
          </div>
          <h1>Enter your code</h1>
          <p>Check Telegram on your other devices for the login code.</p>
          <Steps current={step} />
          <label className="field">
            <input
              inputMode="numeric"
              aria-label="Login code"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              placeholder="12345"
              autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary block" type="submit" disabled={busy || code.length < 4}>
            {busy && <Loader2 size={16} className="spin" />}
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <button className="btn ghost block" type="button" disabled={busy} onClick={restart}>
            Start again / use a different number
          </button>
        </form>
      )}

      {step === 'password' && (
        <form className="login-card" onSubmit={submitPassword}>
          <div className="login-mark">
            <ShieldCheck size={30} strokeWidth={2.2} />
          </div>
          <h1>Two-step verification</h1>
          <p>{hint ? `Password hint: ${hint}` : 'Enter your Telegram cloud password.'}</p>
          <Steps current={step} />
          <label className="field">
            <input
              type="password"
              aria-label="Two-step verification password"
              autoComplete="current-password"
              value={password}
              placeholder="Cloud password"
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary block" type="submit" disabled={busy || !password}>
            {busy && <Loader2 size={16} className="spin" />}
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button className="btn ghost block" type="button" disabled={busy} onClick={restart}>
            Start again / use a different number
          </button>
        </form>
      )}

      <footer className="app-footer">
        <span>© 2026 All rights reserved by Pritam Kumar Modak</span>
      </footer>
    </div>
  );
}
