import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorBox, Field } from '../components/common';
import { CheckIcon } from '../components/Icons';
import { Page } from '../components/Layout';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Six single-digit boxes that behave like one input (paste, backspace, auto-advance). */
export function CodeBoxes({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  return (
    <div className="code-boxes" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1}`}
          className={d.trim() ? 'filled' : ''}
          value={d.trim()}
          maxLength={6}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '');
            if (!typed) return;
            const next = (value.slice(0, i) + typed + value.slice(i + typed.length)).slice(0, 6);
            onChange(next);
            refs.current[Math.min(i + typed.length, 5)]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              const pos = d.trim() ? i : Math.max(0, i - 1);
              onChange(value.slice(0, pos) + value.slice(pos + 1));
              refs.current[pos]?.focus();
            }
          }}
        />
      ))}
    </div>
  );
}

export function Login() {
  const [params] = useSearchParams();
  const next = params.get('next') || '';
  const context = params.get('context');
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [as, setAs] = useState<'patient' | 'provider'>(params.get('as') === 'provider' ? 'provider' : 'patient');
  const [usePassword, setUsePassword] = useState(false);
  // Where the one-time code goes: a text message or an email.
  const [via, setVia] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const finish = async (token: string, role: string) => {
    await signIn(token);
    navigate(next || (role === 'admin' ? '/admin' : role === 'patient' ? '/' : '/dashboard'), { replace: true });
  };

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = via === 'email'
        ? await api<{ isNewUser: boolean; devCode?: string }>('/auth/email/request', { body: { email: email.trim() } })
        : await api<{ isNewUser: boolean; devCode?: string }>('/auth/otp/request', { body: { phone } });
      if (r.isNewUser && as === 'provider') {
        setError(`No pharmacy, hospital or doctor account uses this ${via === 'email' ? 'email' : 'number'}. Register your facility first.`);
        return;
      }
      setIsNew(r.isNewUser);
      setDevCode(r.devCode ?? null);
      setStep('code');
      setCode('');
      setResendIn(45);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const extra = { code, intent: as, ...(isNew ? { name: name || undefined, consent } : {}) };
      const r = await api<{ token: string; user: { role: string } }>(
        via === 'email' ? '/auth/email/verify' : '/auth/otp/verify',
        { body: via === 'email' ? { email: email.trim(), ...extra } : { phone, ...extra } },
      );
      await finish(r.token, r.user.role);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const passwordLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: { role: string } }>('/auth/login', { body: { email, password } });
      await finish(r.token, r.user.role);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <div className="layout-side" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="card raised stack" style={{ padding: '1.5rem' }}>
          <h1 style={{ margin: 0 }}>{next.startsWith('/reserve') ? 'Sign in to reserve' : 'Sign in'}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {context ? `${context}. ` : ''}No password needed: we send a code to your phone or email. New here? The same steps create your account.
          </p>
          <div className="segmented" role="group" aria-label="Who are you?">
            <button className={as === 'patient' ? 'on' : ''} onClick={() => { setAs('patient'); setUsePassword(false); setError(null); }}>I need medical help</button>
            <button className={as === 'provider' ? 'on' : ''} onClick={() => { setAs('provider'); setError(null); }}>I run a pharmacy or hospital</button>
          </div>
          {!usePassword && step === 'phone' && (
            <div className="segmented" role="group" aria-label="Send my code by">
              <button type="button" className={via === 'phone' ? 'on' : ''} onClick={() => { setVia('phone'); setError(null); }}>Use phone number</button>
              <button type="button" className={via === 'email' ? 'on' : ''} onClick={() => { setVia('email'); setError(null); }}>Use email address</button>
            </div>
          )}

          {usePassword ? (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); passwordLogin(); }}>
              <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
              <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
              <ErrorBox error={error} />
              <button className="btn primary big block" disabled={busy}>Sign in</button>
              <button type="button" className="btn link" onClick={() => setUsePassword(false)}>Use a one-time code instead</button>
            </form>
          ) : step === 'phone' ? (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); requestCode(); }}>
              {via === 'email' ? (
                <Field label="Step 1 · Email address">
                  <input type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </Field>
              ) : (
                <Field label="Step 1 · Phone number">
                  <input type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 456 7890" value={phone} onChange={(e) => setPhone(e.target.value)} required className="mono" />
                </Field>
              )}
              <ErrorBox error={error} />
              <button className="btn primary big block" disabled={busy || (via === 'email' ? !/^\S+@\S+\.\S+$/.test(email.trim()) : phone.replace(/\D/g, '').length < 10)}>Send code</button>
            </form>
          ) : (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); verify(); }}>
              <div className="card soft tight spread">
                <span className="row">
                  <span className="num" style={{ width: 28, height: 28 }}><CheckIcon width={14} /></span>
                  <span>
                    <span className="tiny muted">Step 1 · {via === 'email' ? 'Email address' : 'Phone number'}</span>
                    <br />
                    <span className="mono">{via === 'email' ? email.trim() : phone}</span>
                  </span>
                </span>
                <button type="button" className="btn link" onClick={() => setStep('phone')}>Change</button>
              </div>
              <div>
                <div className="small ok-text">Step 2 · Enter the code</div>
                <div className="muted small">{via === 'email' ? `We sent a 6-digit code to ${email.trim()}. Check your inbox and spam folder.` : `We sent a 6-digit code by SMS to ${phone}.`}</div>
              </div>
              {devCode && <p className="devnote" style={{ margin: 0 }}>Development mode: your code is <strong className="mono">{devCode}</strong> (also printed in the server log).</p>}
              <CodeBoxes value={code} onChange={setCode} autoFocus />
              {isNew && (
                <>
                  <Field label="Your name" optional>
                    <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <label className="check">
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
                    <span className="small">I agree that MedAssist-9ja stores my {via === 'email' ? 'email address' : 'phone number'} and orders and uses my location only to find nearby facilities (Nigeria Data Protection Act 2023).</span>
                  </label>
                </>
              )}
              <ErrorBox error={error} />
              <button className="btn primary big block" disabled={busy || code.length !== 6 || (isNew && !consent)}>Continue</button>
              <p className="small muted center" style={{ margin: 0 }}>
                Didn’t get it?{' '}
                {resendIn > 0 ? <>You can resend in <span className="mono">0:{String(resendIn).padStart(2, '0')}</span></> : <button type="button" className="btn link" onClick={requestCode}>Send a new code</button>}
              </p>
            </form>
          )}

          {as === 'provider' && !usePassword && (
            <div className="small center">
              <button className="btn link" onClick={() => setUsePassword(true)}>Sign in with email and password</button> · <Link to="/register">Register your facility</Link>
            </div>
          )}
          <hr className="divider" />
          <p className="tiny muted" style={{ margin: 0 }}>By continuing you agree to our terms and privacy policy. We use your phone number or email only for sign-in and order messages.</p>
        </div>

        <aside className="stack" style={{ paddingTop: '1rem' }}>
          <h2>Why sign in?</h2>
          <ul className="stack" style={{ paddingLeft: '1.1rem', margin: 0 }}>
            <li>The pharmacy knows who is collecting the reservation.</li>
            <li>You get your pickup code and receipt by SMS.</li>
            <li>You can see past orders and set refill reminders.</li>
          </ul>
          <div className="card danger">
            <strong className="danger-text">In an emergency you never need to sign in.</strong>
            <p style={{ margin: 0 }}>Use the <Link to="/emergency" className="danger-text">Emergency</Link> button to see hospitals and call 112.</p>
          </div>
        </aside>
      </div>
    </Page>
  );
}
