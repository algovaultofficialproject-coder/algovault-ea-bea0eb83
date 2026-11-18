import { describe, it, expect } from 'vitest';
import { appAccessDecision, isAlwaysOpen, mustSignOut, signOutRound } from './app-access';

describe('App entry access', () => {
  it('sends an email that was never activated to the WhatsApp admin', () => {
    expect(appAccessDecision('buyer@example.com', null)).toEqual({
      ok: false,
      code: 'contact_admin',
      error: 'This email is not activated yet — contact the admin on WhatsApp to activate it.',
    });
  });

  it('sends an email whose single use is spent to the WhatsApp admin', () => {
    expect(appAccessDecision('buyer@example.com', { email: 'buyer@example.com', approved: false })).toEqual({
      ok: false,
      code: 'contact_admin',
      error: 'This email has already been used — contact the admin on WhatsApp to reactivate it.',
    });
  });

  it('opens the app once for an activated email and consumes the approval', () => {
    expect(appAccessDecision('buyer@example.com', { email: 'buyer@example.com', approved: true })).toEqual({ ok: true, consume: true });
  });

  it('always opens t16t85hql9f@gmail.com without consuming anything', () => {
    expect(appAccessDecision('t16t85hql9f@gmail.com', null)).toEqual({ ok: true, consume: false });
  });

  it('makes mtwentwabantwana@gmail.com reactivate like everyone else', () => {
    expect(isAlwaysOpen('mtwentwabantwana@gmail.com')).toBe(false);
    expect(appAccessDecision('MTWENTWABANTWANA@GMAIL.COM', null).ok).toBe(false);
    expect(appAccessDecision('mtwentwabantwana@gmail.com', { email: 'mtwentwabantwana@gmail.com', approved: false }).ok).toBe(false);
  });

  it('signs mtwentwabantwana@gmail.com out of an already-open phone exactly once', () => {
    expect(mustSignOut('mtwentwabantwana@gmail.com', null)).toBe(true);
    const round = signOutRound('mtwentwabantwana@gmail.com');
    expect(mustSignOut('mtwentwabantwana@gmail.com', round)).toBe(false);
    expect(mustSignOut('buyer@example.com', null)).toBe(false);
  });

  it('does not open the app for any other email', () => {
    expect(isAlwaysOpen('stranger@example.com')).toBe(false);
    expect(appAccessDecision('stranger@example.com', null).ok).toBe(false);
  });
});
