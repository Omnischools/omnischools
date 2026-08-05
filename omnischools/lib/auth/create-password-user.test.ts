import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * fix/onboarding-auth-confirm — createPasswordUser must provision an ALREADY-CONFIRMED phone account.
 *
 * The live bug: signUp({phone,password}) mints an UNCONFIRMED account; SMS is stubbed so its OTP can
 * never arrive, and signInWithPassword rejects an unconfirmed phone → every onboarded admin is locked
 * out. Fix: the service-role admin API with `phone_confirm: true`. These prove the seam at the boundary
 * (env + supabase clients mocked so `authIsLive()` is true and no real Supabase is touched).
 */
const h = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createUser: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: { AUTH_DEV_BYPASS: false, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { signUp: h.signUp } })),
}));

import { createPasswordUser } from "@/lib/auth";

const fakeAdmin = { auth: { admin: { createUser: h.createUser } } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createPasswordUser · confirmed admin-provisioned account", () => {
  it("creates the account CONFIRMED via the admin API (phone_confirm: true), normalising the phone", async () => {
    h.createAdminClient.mockReturnValue(fakeAdmin);
    h.createUser.mockResolvedValue({ data: {}, error: null });

    const res = await createPasswordUser("024 000 0000", "supersecret");

    expect(res).toEqual({ ok: true });
    expect(h.createUser).toHaveBeenCalledWith({
      phone: "+233240000000",
      password: "supersecret",
      phone_confirm: true,
    });
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("is idempotent on a duplicate-phone error (a re-onboard leaves the existing account untouched)", async () => {
    h.createAdminClient.mockReturnValue(fakeAdmin);
    h.createUser.mockResolvedValue({
      data: {},
      error: { message: "Phone number has already been registered" },
    });

    expect(await createPasswordUser("+233240000000", "supersecret")).toEqual({ ok: true });
  });

  it("surfaces a NON-duplicate admin error", async () => {
    h.createAdminClient.mockReturnValue(fakeAdmin);
    h.createUser.mockResolvedValue({ data: {}, error: { message: "Password too weak" } });

    expect(await createPasswordUser("+233240000000", "x")).toEqual({
      ok: false,
      error: "Password too weak",
    });
  });

  it("falls back to signUp (UNCONFIRMED) with a warning when no service-role client is configured", async () => {
    h.createAdminClient.mockReturnValue(null);
    h.signUp.mockResolvedValue({ error: null });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await createPasswordUser("+233240000000", "supersecret");

    expect(res).toEqual({ ok: true });
    expect(h.signUp).toHaveBeenCalledWith({ phone: "+233240000000", password: "supersecret" });
    expect(h.createUser).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
