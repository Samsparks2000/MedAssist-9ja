import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { email as emailSender, sms } from '../../adapters/messaging.js';
import { config } from '../../config.js';
import { one, query } from '../../db/pool.js';
import { requireAuth, signToken, type Role } from '../../lib/auth.js';
import { normalisePhone, numericCode, sha256 } from '../../lib/codes.js';
import { badRequest, conflict, notFound, parse, unauthorized } from '../../lib/errors.js';
import { findOwnFacility } from '../facilities/service.js';
import { consumeOtp } from './otp.js';

export const authRouter = Router();

// NFR-04: rate limiting on OTP. Codes are limited per phone number; a looser per-IP ceiling
// stops scripted abuse without locking out people who share a carrier-grade NAT address.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'test' ? 1000 : 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts from this network. Try again in a few minutes.' },
});
const perPhoneLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'test' ? 1000 : 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `phone:${normalisePhone(String(req.body?.phone ?? '')) ?? 'invalid'}`,
  message: { error: 'Too many codes sent to this number. Try again in a few minutes.' },
});

const phoneSchema = z.string().transform((v, ctx) => {
  const p = normalisePhone(v);
  if (!p) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid Nigerian phone number' });
    return z.NEVER;
  }
  return p;
});

const userFields = 'id, name, phone, email, role, created_at';

authRouter.post('/otp/request', otpLimiter, perPhoneLimiter, async (req, res) => {
  const { phone } = parse(z.object({ phone: phoneSchema }), req.body);
  const code = numericCode(6);
  await query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))
     ON CONFLICT (phone) DO UPDATE SET code_hash = $2, expires_at = now() + make_interval(mins => $3), attempts = 0, created_at = now()`,
    [phone, sha256(phone + code), config.otp.ttlMinutes],
  );
  await sms.send(phone, `Your MedAssist-9ja code is ${code}. It expires in ${config.otp.ttlMinutes} minutes.`);
  const existing = await one('SELECT 1 FROM users WHERE phone = $1', [phone]);
  // The dev code is only echoed back when no real SMS provider is configured.
  res.json({
    sent: true,
    isNewUser: !existing,
    ...(!config.isProd && config.sms.provider === 'console' ? { devCode: code } : {}),
  });
});

authRouter.post('/otp/verify', otpLimiter, async (req, res) => {
  const body = parse(
    z.object({
      phone: phoneSchema,
      code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
      name: z.string().trim().min(2).max(80).optional(),
      consent: z.boolean().optional(),
      // "I run a pharmacy or hospital": never create a patient account from the provider tab.
      intent: z.enum(['patient', 'provider']).default('patient'),
    }),
    req.body,
  );
  const existing = await one(`SELECT ${userFields}, suspended FROM users WHERE phone = $1`, [body.phone]);
  if (!existing && body.intent === 'provider') {
    throw notFound('No pharmacy, hospital or doctor account uses this number. Register your facility first.');
  }
  // NFR-06: consent captured at sign-up. Checked before the code is used up.
  if (!existing && !body.consent) throw badRequest('Please accept the privacy notice to create an account');
  await consumeOtp(body.phone, body.code);

  let user = existing;
  if (user?.suspended) throw unauthorized('This account is suspended');
  if (!user) {
    user = await one(
      `INSERT INTO users (phone, name, role, consent_at) VALUES ($1, $2, 'patient', now()) RETURNING ${userFields}`,
      [body.phone, body.name ?? null],
    );
  }
  res.json({ token: signToken(user), user });
});

// Email sign-in / sign-up: the same one-time-code flow as the phone, with the code sent by email.
// Codes share the otp_codes table; the key is the email address, which can never look like a phone number.
const emailSchema = z.email('Enter a valid email address').transform((e) => e.trim().toLowerCase());
const perEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'test' ? 1000 : 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `email:${String(req.body?.email ?? '').trim().toLowerCase()}`,
  message: { error: 'Too many codes sent to this email. Try again in a few minutes.' },
});

authRouter.post('/email/request', otpLimiter, perEmailLimiter, async (req, res) => {
  const { email } = parse(z.object({ email: emailSchema }), req.body);
  const code = numericCode(6);
  await query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))
     ON CONFLICT (phone) DO UPDATE SET code_hash = $2, expires_at = now() + make_interval(mins => $3), attempts = 0, created_at = now()`,
    [email, sha256(email + code), config.otp.ttlMinutes],
  );
  await emailSender.send(
    email,
    'Your MedAssist-9ja sign-in code',
    `Your MedAssist-9ja code is ${code}. It expires in ${config.otp.ttlMinutes} minutes.`,
  );
  const existing = await one('SELECT 1 FROM users WHERE email = $1', [email]);
  // No real email provider is wired up yet, so outside production the code is shown on screen.
  res.json({ sent: true, isNewUser: !existing, ...(!config.isProd ? { devCode: code } : {}) });
});

authRouter.post('/email/verify', otpLimiter, async (req, res) => {
  const body = parse(
    z.object({
      email: emailSchema,
      code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
      name: z.string().trim().min(2).max(80).optional(),
      consent: z.boolean().optional(),
      intent: z.enum(['patient', 'provider']).default('patient'),
    }),
    req.body,
  );
  const existing = await one(`SELECT ${userFields}, suspended FROM users WHERE email = $1`, [body.email]);
  if (!existing && body.intent === 'provider') {
    throw notFound('No pharmacy, hospital or doctor account uses this email. Register your facility first.');
  }
  // Checked before the code is used up, so forgetting the tick box doesn't cost a new code.
  if (!existing && !body.consent) throw badRequest('Please accept the privacy notice to create an account');
  await consumeOtp(body.email, body.code);

  let user = existing;
  if (user?.suspended) throw unauthorized('This account is suspended');
  if (!user) {
    user = await one(
      `INSERT INTO users (email, name, role, consent_at) VALUES ($1, $2, 'patient', now()) RETURNING ${userFields}`,
      [body.email, body.name ?? null],
    );
  }
  const { suspended: _s, ...safe } = user;
  res.json({ token: signToken(user), user: safe });
});

authRouter.post('/register', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(80),
      email: z.email().transform((e) => e.toLowerCase()),
      phone: phoneSchema,
      password: z.string().min(8, 'Use at least 8 characters').max(128),
      role: z.enum(['pharmacy', 'hospital', 'specialist']),
      consent: z.literal(true, { message: 'Please accept the privacy notice' }),
    }),
    req.body,
  );
  const exists = await one('SELECT 1 FROM users WHERE email = $1 OR phone = $2', [body.email, body.phone]);
  if (exists) throw conflict('An account with that email or phone already exists');
  const hash = await bcrypt.hash(body.password, 10);
  const user = await one(
    `INSERT INTO users (name, email, phone, password_hash, role, consent_at)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING ${userFields}`,
    [body.name, body.email, body.phone, hash, body.role],
  );
  res.status(201).json({ token: signToken(user), user });
});

authRouter.post('/login', otpLimiter, async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string() }), req.body);
  const user = await one<{ id: string; role: Role; password_hash: string | null; suspended: boolean }>(
    `SELECT ${userFields}, password_hash, suspended FROM users WHERE email = $1`,
    [body.email],
  );
  if (!user?.password_hash || !(await bcrypt.compare(body.password, user.password_hash))) {
    throw unauthorized('Wrong email or password');
  }
  if (user.suspended) throw unauthorized('This account is suspended');
  const { password_hash: _h, suspended: _s, ...safe } = user;
  res.json({ token: signToken(user), user: safe });
});

authRouter.get('/me', requireAuth(), async (req, res) => {
  const user = await one(`SELECT ${userFields} FROM users WHERE id = $1`, [req.user!.id]);
  const f = await findOwnFacility(req.user!.id);
  const facility = f
    ? { id: f.id, name: f.name, type: f.type, verification_status: f.verification_status, verification_note: f.verification_note, area: f.area, isOwner: f.owner_id === req.user!.id }
    : null;
  const specialist = await one(
    'SELECT id, specialty, verification_status, verification_note FROM specialists WHERE user_id = $1',
    [req.user!.id],
  );
  const locations = await query(
    'SELECT id, label, address, lat, lng FROM saved_locations WHERE user_id = $1 ORDER BY created_at',
    [req.user!.id],
  );
  res.json({ user, facility, specialist, locations });
});

authRouter.patch('/me', requireAuth(), async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      email: z.email().transform((e) => e.toLowerCase()).optional(),
    }),
    req.body,
  );
  const user = await one(
    `UPDATE users SET name = coalesce($2, name), email = coalesce($3, email) WHERE id = $1 RETURNING ${userFields}`,
    [req.user!.id, body.name ?? null, body.email ?? null],
  );
  res.json({ user });
});

authRouter.post('/me/locations', requireAuth(), async (req, res) => {
  const body = parse(
    z.object({
      label: z.string().trim().min(1).max(40),
      address: z.string().max(200).optional(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    req.body,
  );
  const loc = await one(
    'INSERT INTO saved_locations (user_id, label, address, lat, lng) VALUES ($1, $2, $3, $4, $5) RETURNING id, label, address, lat, lng',
    [req.user!.id, body.label, body.address ?? null, body.lat, body.lng],
  );
  res.status(201).json(loc);
});

authRouter.delete('/me/locations/:id', requireAuth(), async (req, res) => {
  await query('DELETE FROM saved_locations WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
  res.status(204).end();
});
