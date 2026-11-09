import { describe, expect, it } from 'vitest';
import { auth, http, useDb } from './helpers.js';

useDb();

describe('email sign-in and sign-up', () => {
  it('creates a patient account from an email code and signs them back in', async () => {
    const email = `Patient.${Date.now()}@Example.com`;
    const req = await http().post('/api/auth/email/request').send({ email });
    expect(req.status).toBe(200);
    expect(req.body.isNewUser).toBe(true);
    expect(req.body.devCode).toMatch(/^\d{6}$/);

    const noConsent = await http().post('/api/auth/email/verify').send({ email, code: req.body.devCode });
    expect(noConsent.status).toBe(400);

    // The failed attempt above consumed nothing, so the same code still works.
    const res = await http().post('/api/auth/email/verify').send({ email, code: req.body.devCode, name: 'Email Patient', consent: true });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: email.toLowerCase(), role: 'patient', phone: null });

    const me = await http().get('/api/auth/me').set(auth(res.body.token));
    expect(me.body.user.email).toBe(email.toLowerCase());

    const again = await http().post('/api/auth/email/request').send({ email });
    expect(again.body.isNewUser).toBe(false);
    const back = await http().post('/api/auth/email/verify').send({ email, code: again.body.devCode });
    expect(back.status).toBe(200);
    expect(back.body.user.id).toBe(res.body.user.id);
  });

  it('rejects a wrong code', async () => {
    const email = `wrong.${Date.now()}@example.com`;
    const req = await http().post('/api/auth/email/request').send({ email });
    const wrong = req.body.devCode === '000000' ? '111111' : '000000';
    const res = await http().post('/api/auth/email/verify').send({ email, code: wrong, consent: true });
    expect(res.status).toBe(400);
  });

  it('lets a provider sign in with the email on their account but never creates one', async () => {
    const req = await http().post('/api/auth/email/request').send({ email: 'tunde@medassist.test' });
    expect(req.body.isNewUser).toBe(false);
    const ok = await http().post('/api/auth/email/verify').send({ email: 'tunde@medassist.test', code: req.body.devCode, intent: 'provider' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).not.toBe('patient');

    const stranger = `nobody.${Date.now()}@example.com`;
    const r2 = await http().post('/api/auth/email/request').send({ email: stranger });
    const no = await http().post('/api/auth/email/verify').send({ email: stranger, code: r2.body.devCode, intent: 'provider', consent: true });
    expect(no.status).toBe(404);
  });

  it('rejects an invalid email', async () => {
    const res = await http().post('/api/auth/email/request').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});
