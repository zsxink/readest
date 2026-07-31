import { describe, test, expect, vi } from 'vitest';

// getSubscriptionPlan / getUserProfilePlan only depend on jwtDecode.
// Mock the supabase side (used by access.ts's other helpers) so importing
// access.ts never touches the network.
vi.mock('@/utils/supabase', () => ({
  supabase: { auth: { getUser: vi.fn(), getSession: vi.fn() } },
  createSupabaseAdminClient: () => ({}),
}));

import { getSubscriptionPlan, getUserProfilePlan } from '@/utils/access';

/** Build a real HS256 JWT (mirrors GoTrue's signing) with the given payload. */
const sign = (payload: Record<string, unknown>, secret = 'test-secret'): string => {
  const b64url = (s: string) =>
    Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const crypto = require('node:crypto');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${body}.${sig}`;
};

describe('getSubscriptionPlan', () => {
  test('reads top-level plan claim', () => {
    const token = sign({ plan: 'pro', sub: 'u1' });
    expect(getSubscriptionPlan(token)).toBe('pro');
  });

  test('falls back to app_metadata.plan when top-level plan is absent', () => {
    // GoTrue v2 never promotes app_metadata keys to top-level JWT claims —
    // the plan lives in app_metadata, so this is the real-world shape.
    const token = sign({
      sub: 'u1',
      app_metadata: { plan: 'pro', provider: 'email', providers: ['email'] },
    });
    expect(getSubscriptionPlan(token)).toBe('pro');
  });

  test('returns free when neither top-level nor app_metadata has a plan', () => {
    const token = sign({ sub: 'u1', app_metadata: { provider: 'email' } });
    expect(getSubscriptionPlan(token)).toBe('free');
  });

  test('prefers top-level plan over app_metadata.plan', () => {
    const token = sign({
      plan: 'plus',
      app_metadata: { plan: 'pro' },
    });
    expect(getSubscriptionPlan(token)).toBe('plus');
  });
});

describe('getUserProfilePlan', () => {
  test('reads top-level plan claim', () => {
    const token = sign({ plan: 'pro', sub: 'u1' });
    expect(getUserProfilePlan(token)).toBe('pro');
  });

  test('falls back to app_metadata.plan', () => {
    const token = sign({ sub: 'u1', app_metadata: { plan: 'pro' } });
    expect(getUserProfilePlan(token)).toBe('pro');
  });

  test('reports purchase when storage_purchased_bytes > 0 (top-level)', () => {
    const token = sign({ sub: 'u1', storage_purchased_bytes: 5 * 1024 ** 3 });
    expect(getUserProfilePlan(token)).toBe('purchase');
  });

  test('reports purchase when storage_purchased_bytes > 0 lives in app_metadata', () => {
    const token = sign({ sub: 'u1', app_metadata: { storage_purchased_bytes: 5 * 1024 ** 3 } });
    expect(getUserProfilePlan(token)).toBe('purchase');
  });

  test('returns free when no plan or purchase data present', () => {
    const token = sign({ sub: 'u1' });
    expect(getUserProfilePlan(token)).toBe('free');
  });
});
