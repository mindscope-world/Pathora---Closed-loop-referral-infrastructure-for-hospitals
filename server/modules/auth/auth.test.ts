import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../audit/append';
import { cookieFrom, makeApp, prisma, rawSetCookie, signupBody, uniqueEmail } from '../../test/helpers';
import { ACCESS_TOKEN_TTL_SECONDS, hashToken } from './tokens';

const app = makeApp();
afterAll(() => prisma.$disconnect());

const signup = (over: Record<string, unknown> = {}) => request(app).post('/api/auth/signup').send(signupBody(over));
const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });
const refresh = (token: string) => request(app).post('/api/auth/refresh').set('Cookie', `pathora_rt=${token}`);

describe('signup', () => {
  it('creates the org, a Programme Manager, default rule packs and an audit event, and signs the user in', async () => {
    const body = signupBody();
    const res = await request(app).post('/api/auth/signup').send(body);
    expect(res.status).toBe(201);
    expect(res.body.expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(res.body.user).toMatchObject({ name: body.fullName, email: body.email, role: 'PROGRAMME_MANAGER' });
    expect(res.body.user.organization.name).toBe(body.organization);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    expect(res.headers['cache-control']).toBe('no-store');

    const orgId = res.body.user.organization.id;
    expect(await prisma.user.count({ where: { orgId } })).toBe(1);
    expect(await prisma.rulePack.count({ where: { orgId } })).toBe(4);
    const events = await prisma.auditEvent.findMany({ where: { orgId } });
    expect(events.map((e) => e.action)).toEqual(['ORGANIZATION_CREATED']);
    expect(await verifyAuditChain(prisma, orgId)).toMatchObject({ ok: true });

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(body.email);
  });

  it('stores an argon2id hash, never the password', async () => {
    const body = signupBody();
    await request(app).post('/api/auth/signup').send(body).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(body.password);
  });

  it('ignores a client-supplied role: self-signup is always Programme Manager', async () => {
    const res = await signup({ role: 'CLINICAL_LEAD', orgId: 'someone-elses-org' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('PROGRAMME_MANAGER');
    expect(res.body.user.organization.id).not.toBe('someone-elses-org');
  });

  it('normalises email case/whitespace and rejects duplicates regardless of case', async () => {
    const email = uniqueEmail('Case');
    const first = await signup({ email: `  ${email.toUpperCase()}  ` });
    expect(first.status).toBe(201);
    expect(first.body.user.email).toBe(email.toLowerCase());
    const dup = await signup({ email });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_IN_USE');
  });

  it.each([
    ['short password', { password: 'short1!' }],
    ['repetitive password', { password: 'aaaaaaaaaaaaaaaa' }],
    ['overlong password', { password: 'x'.repeat(200) + 'ab12' }],
    ['bad email', { email: 'not-an-email' }],
    ['missing name', { fullName: '' }],
    ['missing org', { organization: '' }],
  ])('rejects %s with a field-level validation error', async (_label, over) => {
    const res = await signup(over);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('sets the refresh token as an httpOnly, SameSite=Strict cookie scoped to /api/auth', async () => {
    const res = await signup();
    const cookie = rawSetCookie(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/Expires=/);
    expect(res.body.refreshToken).toBeUndefined(); // never in the JSON body
  });
});

describe('login', () => {
  it('signs in with correct credentials (email is case-insensitive)', async () => {
    const body = signupBody();
    await request(app).post('/api/auth/signup').send(body).expect(201);
    const res = await login(body.email.toUpperCase(), body.password);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(body.email);
    expect(cookieFrom(res)).toBeTruthy();
    expect((await prisma.user.findUniqueOrThrow({ where: { email: body.email } })).lastLoginAt).toBeTruthy();
  });

  it('gives the identical response for a wrong password and an unknown account', async () => {
    const body = signupBody();
    await request(app).post('/api/auth/signup').send(body).expect(201);
    const wrongPw = await login(body.email, 'definitely the wrong password');
    const unknown = await login(uniqueEmail('ghost'), 'definitely the wrong password');
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPw.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error).toEqual({ ...wrongPw.body.error, requestId: unknown.body.error.requestId });
  });

  it('rejects deactivated users with the same generic error', async () => {
    const body = signupBody();
    await request(app).post('/api/auth/signup').send(body).expect(201);
    await prisma.user.update({ where: { email: body.email }, data: { active: false } });
    const res = await login(body.email, body.password);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('throttles after 5 failures — even the right password is refused — with Retry-After', async () => {
    const body = signupBody();
    await request(app).post('/api/auth/signup').send(body).expect(201);
    for (let i = 0; i < 5; i++) expect((await login(body.email, 'wrong password ' + i)).status).toBe(401);
    const locked = await login(body.email, body.password);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(locked.headers['retry-after'])).toBeLessThanOrEqual(900);
  });

  it('throttles unknown emails the same way, so lockout does not reveal which accounts exist', async () => {
    const ghost = uniqueEmail('ghost');
    for (let i = 0; i < 5; i++) expect((await login(ghost, 'nope nope nope ' + i)).status).toBe(401);
    expect((await login(ghost, 'nope nope nope')).status).toBe(429);
  });

  it('a successful sign-in clears the failure count', async () => {
    const body = signupBody();
    await request(app).post('/api/auth/signup').send(body).expect(201);
    for (let i = 0; i < 4; i++) await login(body.email, 'wrong password ' + i);
    expect((await login(body.email, body.password)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login(body.email, 'wrong again ' + i)).status).toBe(401);
    expect((await login(body.email, body.password)).status).toBe(200);
  });

  it('validates the payload', async () => {
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: 'x', password: 'y' })).status).toBe(400);
  });
});

describe('access tokens', () => {
  async function session() {
    const body = signupBody();
    const res = await request(app).post('/api/auth/signup').send(body).expect(201);
    return { body, accessToken: res.body.accessToken as string, userId: res.body.user.id as string, orgId: res.body.user.organization.id as string };
  }
  const me = (authz?: string) => {
    const r = request(app).get('/api/auth/me');
    return authz ? r.set('Authorization', authz) : r;
  };

  it('rejects missing, malformed and non-Bearer credentials', async () => {
    expect((await me()).status).toBe(401);
    expect((await me('Bearer')).status).toBe(401);
    expect((await me('Bearer not.a.jwt')).status).toBe(401);
    expect((await me('Basic dXNlcjpwYXNz')).status).toBe(401);
  });

  it('rejects tokens signed with another secret, an unsigned (alg=none) token, wrong audience/issuer, and expired tokens', async () => {
    const { userId, orgId } = await session();
    const claims = { org: orgId };
    const good = { algorithm: 'HS256' as const, subject: userId, issuer: 'pathora', audience: 'pathora-api', expiresIn: 60 };

    const wrongSecret = jwt.sign(claims, 'x'.repeat(40), good);
    const wrongAud = jwt.sign(claims, process.env.JWT_SECRET!, { ...good, audience: 'other' });
    const wrongIss = jwt.sign(claims, process.env.JWT_SECRET!, { ...good, issuer: 'other' });
    const expired = jwt.sign(claims, process.env.JWT_SECRET!, { ...good, expiresIn: -10 });
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: userId, org: orgId, iss: 'pathora', aud: 'pathora-api', exp: Math.floor(Date.now() / 1000) + 60 })}.`;
    // The same payload signed with HS512: valid signature, but not the pinned algorithm.
    const hs512 = jwt.sign(claims, process.env.JWT_SECRET!, { ...good, algorithm: 'HS512' });

    for (const [name, token] of Object.entries({ wrongSecret, wrongAud, wrongIss, expired, none, hs512 })) {
      const res = await me(`Bearer ${token}`);
      expect(res.status, name).toBe(401);
    }
    // sanity: a correctly-formed token is accepted
    expect((await me(`Bearer ${jwt.sign(claims, process.env.JWT_SECRET!, good)}`)).status).toBe(200);
  });

  it('rejects a token whose org claim does not match the user’s organisation', async () => {
    const { userId } = await session();
    const other = await session();
    const forged = jwt.sign({ org: other.orgId }, process.env.JWT_SECRET!, {
      algorithm: 'HS256', subject: userId, issuer: 'pathora', audience: 'pathora-api', expiresIn: 60,
    });
    expect((await me(`Bearer ${forged}`)).status).toBe(401);
  });

  it('takes effect immediately when a user is deactivated (no waiting for token expiry)', async () => {
    const { accessToken, userId } = await session();
    expect((await me(`Bearer ${accessToken}`)).status).toBe(200);
    await prisma.user.update({ where: { id: userId }, data: { active: false } });
    expect((await me(`Bearer ${accessToken}`)).status).toBe(401);
  });
});

describe('refresh tokens', () => {
  async function signedIn() {
    const res = await signup();
    return { first: cookieFrom(res)!, userId: res.body.user.id as string, orgId: res.body.user.organization.id as string };
  }

  it('issues a new access token and rotates the refresh token', async () => {
    const { first } = await signedIn();
    const res = await refresh(first);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const second = cookieFrom(res)!;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('stores only a hash of the refresh token', async () => {
    const { first, userId } = await signedIn();
    const rows = await prisma.refreshToken.findMany({ where: { userId } });
    expect(rows.some((r) => r.tokenHash === first)).toBe(false);
    expect(JSON.stringify(rows)).not.toContain(first);
  });

  it('requires the cookie', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
    expect((await refresh('not-a-real-token')).status).toBe(401);
  });

  it('detects reuse of a rotated token: revokes the whole family and audits it', async () => {
    const { first, orgId } = await signedIn();
    const rotated = await refresh(first).expect(200);
    const second = cookieFrom(rotated)!;
    // Move the rotation out of the benign-race leeway window.
    await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(first) }, data: { revokedAt: new Date(Date.now() - 60_000) } });

    const replay = await refresh(first);
    expect(replay.status).toBe(401);
    // the legitimately-rotated token is now dead too: the owner must sign in again
    expect((await refresh(second)).status).toBe(401);

    const events = await prisma.auditEvent.findMany({ where: { orgId, action: 'REFRESH_TOKEN_REUSE_DETECTED' } });
    expect(events).toHaveLength(1);
    expect(await verifyAuditChain(prisma, orgId)).toMatchObject({ ok: true });
  });

  it('does not raise a theft alarm when a stale token is presented after logout', async () => {
    const { first, orgId } = await signedIn();
    await request(app).post('/api/auth/logout').set('Cookie', `pathora_rt=${first}`).expect(204);
    expect((await refresh(first)).status).toBe(401);
    expect(await prisma.auditEvent.count({ where: { orgId, action: 'REFRESH_TOKEN_REUSE_DETECTED' } })).toBe(0);
  });

  it('lets exactly one of two concurrent refreshes with the same token succeed', async () => {
    const { first, userId } = await signedIn();
    const results = await Promise.all([refresh(first), refresh(first), refresh(first)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(2);
    // The losers must not have killed the winner's new session or raised a theft alarm.
    const winner = results.find((r) => r.status === 200)!;
    expect((await refresh(cookieFrom(winner)!)).status).toBe(200);
    expect(await prisma.auditEvent.count({ where: { action: 'REFRESH_TOKEN_REUSE_DETECTED', actorId: userId } })).toBe(0);
  });

  it('rejects an expired refresh token', async () => {
    const { first, userId } = await signedIn();
    await prisma.refreshToken.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await refresh(first)).status).toBe(401);
  });

  it('refuses to refresh for a deactivated user', async () => {
    const { first, userId } = await signedIn();
    await prisma.user.update({ where: { id: userId }, data: { active: false } });
    expect((await refresh(first)).status).toBe(401);
  });

  it('caps a rotating session at 30 days from the original sign-in', async () => {
    const { first, userId } = await signedIn();
    // Pretend this login began 29.5 days ago.
    await prisma.refreshToken.updateMany({ where: { userId }, data: { createdAt: new Date(Date.now() - 29.5 * 86_400_000) } });
    const res = await refresh(first).expect(200);
    const newest = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(cookieFrom(res)!) },
    });
    const remainingDays = (newest.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(remainingDays).toBeLessThan(0.6);
    expect(remainingDays).toBeGreaterThan(0);
  });

  it('a failed refresh clears the cookie', async () => {
    const res = await refresh('garbage');
    expect(rawSetCookie(res)).toMatch(/pathora_rt=;/);
  });
});

describe('logout', () => {
  it('revokes the session family and clears the cookie; the old token no longer works', async () => {
    const res = await signup();
    const token = cookieFrom(res)!;
    const out = await request(app).post('/api/auth/logout').set('Cookie', `pathora_rt=${token}`);
    expect(out.status).toBe(204);
    expect(rawSetCookie(out)).toMatch(/pathora_rt=;/);
    expect((await refresh(token)).status).toBe(401);
  });

  it('is idempotent and safe without a cookie', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
    expect((await request(app).post('/api/auth/logout').set('Cookie', 'pathora_rt=whatever')).status).toBe(204);
  });
});

describe('cross-site requests', () => {
  it('refuses cookie-authenticated calls that carry a foreign Origin (CSRF)', async () => {
    const res = await signup();
    const token = cookieFrom(res)!;
    for (const path of ['/api/auth/refresh', '/api/auth/logout']) {
      const r = await request(app).post(path).set('Origin', 'https://evil.example').set('Cookie', `pathora_rt=${token}`);
      expect(r.status).toBe(403);
    }
    // and the token was not consumed by the blocked attempts
    expect((await refresh(token)).status).toBe(200);
  });
});

describe('per-IP rate limits', () => {
  it('429s after the configured number of attempts', async () => {
    const strict = (await import('../../app')).createApp({ auth: { loginMaxPerIp: 3, signupMaxPerIp: 2 } });
    for (let i = 0; i < 3; i++) {
      expect((await request(strict).post('/api/auth/login').send({ email: uniqueEmail(), password: 'x' })).status).toBe(401);
    }
    const blocked = await request(strict).post('/api/auth/login').send({ email: uniqueEmail(), password: 'x' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    for (let i = 0; i < 2; i++) expect((await request(strict).post('/api/auth/signup').send(signupBody())).status).toBe(201);
    expect((await request(strict).post('/api/auth/signup').send(signupBody())).status).toBe(429);
  });
});

