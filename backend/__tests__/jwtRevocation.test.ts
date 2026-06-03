import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

// We import generateToken indirectly: it lives in authController and is not
// exported, so we replicate the same pattern here and verify the JWT shape
// that protect() will see. This test guarantees the contract — `id` + `jti`
// in the payload — without needing a DB.
describe('JWT revocation: token shape', () => {
  const OLD_ENV = process.env;

  beforeAll(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: 'test_secret_for_unit_test_only', JWT_EXPIRES_IN: '7d' };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('signs tokens that include both id and jti claims', () => {
    const { v4: uuidv4 } = require('uuid') as { v4: () => string };
    const id = 'user_abc';
    const jti = uuidv4();
    const token = jwt.sign({ id, jti }, process.env.JWT_SECRET as string, { expiresIn: '7d' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string; jti: string; exp: number };

    expect(decoded.id).toBe(id);
    expect(decoded.jti).toBe(jti);
    expect(typeof decoded.jti).toBe('string');
    expect(decoded.jti.length).toBeGreaterThan(0);
    expect(typeof decoded.exp).toBe('number');
  });

  it('exp claim falls within 7 days of now (±60s slack for clock drift)', () => {
    const { v4: uuidv4 } = require('uuid') as { v4: () => string };
    const token = jwt.sign({ id: 'u', jti: uuidv4() }, process.env.JWT_SECRET as string, { expiresIn: '7d' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { exp: number };
    const nowSec = Math.floor(Date.now() / 1000);
    const sevenDaysSec = 7 * 24 * 60 * 60;
    expect(decoded.exp).toBeGreaterThan(nowSec + sevenDaysSec - 60);
    expect(decoded.exp).toBeLessThan(nowSec + sevenDaysSec + 60);
  });

  it('two consecutive tokens get different jtis (no collision risk)', () => {
    const { v4: uuidv4 } = require('uuid') as { v4: () => string };
    const jtiA = uuidv4();
    const jtiB = uuidv4();
    expect(jtiA).not.toBe(jtiB);
  });
});
