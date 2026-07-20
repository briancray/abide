import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { clearIdentityCookieHeader, identityCookieHeader, isProd, requireSecretForAuthedSet, resolveIdentity } from "./auth.ts";
import { seal } from "./seal.ts";
import type { Principal } from "./scope.ts";

const originalSecret = Bun.env.ABIDE_IDENTITY_SECRET;
const originalAppToken = Bun.env.ABIDE_APP_TOKEN;
const originalNodeEnv = Bun.env.NODE_ENV;

beforeAll(() => {
  Bun.env.ABIDE_IDENTITY_SECRET = "auth-test-secret-value";
});

afterEach(() => {
  delete Bun.env.ABIDE_APP_TOKEN;
});

afterAll(() => {
  if (originalSecret === undefined) delete Bun.env.ABIDE_IDENTITY_SECRET;
  else Bun.env.ABIDE_IDENTITY_SECRET = originalSecret;
  if (originalAppToken === undefined) delete Bun.env.ABIDE_APP_TOKEN;
  else Bun.env.ABIDE_APP_TOKEN = originalAppToken;
  if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV;
  else Bun.env.NODE_ENV = originalNodeEnv;
});

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/rpc/test", { headers });
}

describe("resolveIdentity — bearer ladder", () => {
  test("app-token bearer resolves to the app-owner principal", async () => {
    Bun.env.ABIDE_APP_TOKEN = "super-secret-app-token";
    const identity = await resolveIdentity(requestWith({ authorization: "Bearer super-secret-app-token" }));
    expect(identity.id).toBe("app-owner");
    expect(identity.authenticated).toBe(true);
    expect(identity.appOwner).toBe(true);
  });

  test("a non-matching bearer that is not a sealed identity falls through to anonymous", async () => {
    Bun.env.ABIDE_APP_TOKEN = "super-secret-app-token";
    const identity = await resolveIdentity(requestWith({ authorization: "Bearer wrong-token" }));
    expect(identity.id).not.toBe("app-owner");
    expect(identity.authenticated).toBe(false);
  });

  test("a sealed bearer resolves to that user's principal", async () => {
    const principal: Principal = { id: "user-42", authenticated: true, name: "Grace" };
    const token = await seal(principal);
    const identity = await resolveIdentity(requestWith({ authorization: `Bearer ${token}` }));
    expect(identity).toEqual(principal);
  });

  test("app-token takes precedence over unsealing when the bearer matches", async () => {
    Bun.env.ABIDE_APP_TOKEN = "super-secret-app-token";
    const identity = await resolveIdentity(requestWith({ authorization: "Bearer super-secret-app-token" }));
    expect(identity.appOwner).toBe(true);
  });
});

describe("resolveIdentity — cookie and anonymous rungs", () => {
  test("the abide-identity cookie resolves to that principal", async () => {
    const principal: Principal = { id: "cookie-user", authenticated: true, tier: "pro" };
    const token = await seal(principal);
    const identity = await resolveIdentity(requestWith({ cookie: `abide-identity=${token}; other=x` }));
    expect(identity).toEqual(principal);
  });

  test("a tampered cookie falls through to a fresh anonymous principal", async () => {
    const identity = await resolveIdentity(requestWith({ cookie: "abide-identity=garbage-value" }));
    expect(identity.authenticated).toBe(false);
    expect(typeof identity.id).toBe("string");
  });

  test("no bearer and no cookie yields a fresh anonymous principal", async () => {
    const a = await resolveIdentity(requestWith({}));
    const b = await resolveIdentity(requestWith({}));
    expect(a.authenticated).toBe(false);
    expect(b.authenticated).toBe(false);
    expect(a.id).not.toBe(b.id); // fresh, untracked each time
  });
});

describe("identity cookie headers", () => {
  test("identityCookieHeader carries the sealed value plus security attributes", async () => {
    const header = await identityCookieHeader({ id: "cookie-writer", authenticated: true });
    expect(header).toStartWith("abide-identity=");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toMatch(/Max-Age=\d+/);
  });

  test("clearIdentityCookieHeader expires the cookie", () => {
    const header = clearIdentityCookieHeader();
    expect(header).toContain("abide-identity=");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
  });

  test("Secure is added only in production", async () => {
    Bun.env.NODE_ENV = "development";
    expect(await identityCookieHeader({ id: "x", authenticated: false })).not.toContain("Secure");
    Bun.env.NODE_ENV = "production";
    expect(await identityCookieHeader({ id: "x", authenticated: false })).toContain("Secure");
    if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV;
    else Bun.env.NODE_ENV = originalNodeEnv;
  });
});

describe("isProd / requireSecretForAuthedSet", () => {
  test("isProd tracks NODE_ENV", () => {
    Bun.env.NODE_ENV = "production";
    expect(isProd()).toBe(true);
    Bun.env.NODE_ENV = "development";
    expect(isProd()).toBe(false);
    if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV;
    else Bun.env.NODE_ENV = originalNodeEnv;
  });

  test("does not throw for an anonymous set", () => {
    Bun.env.NODE_ENV = "production";
    const secret = Bun.env.ABIDE_IDENTITY_SECRET;
    delete Bun.env.ABIDE_IDENTITY_SECRET;
    expect(() => requireSecretForAuthedSet(false)).not.toThrow();
    Bun.env.ABIDE_IDENTITY_SECRET = secret!;
    if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV;
    else Bun.env.NODE_ENV = originalNodeEnv;
  });

  test("throws for an authenticated set in prod without a secret", () => {
    Bun.env.NODE_ENV = "production";
    const secret = Bun.env.ABIDE_IDENTITY_SECRET;
    delete Bun.env.ABIDE_IDENTITY_SECRET;
    expect(() => requireSecretForAuthedSet(true)).toThrow(/ABIDE_IDENTITY_SECRET/);
    Bun.env.ABIDE_IDENTITY_SECRET = secret!;
    if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV;
    else Bun.env.NODE_ENV = originalNodeEnv;
  });

  test("allows an authenticated set in prod when the secret is present", () => {
    Bun.env.NODE_ENV = "production";
    Bun.env.ABIDE_IDENTITY_SECRET = "auth-test-secret-value";
    expect(() => requireSecretForAuthedSet(true)).not.toThrow();
    if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV;
    else Bun.env.NODE_ENV = originalNodeEnv;
  });

  test("does not throw for an authenticated set outside prod", () => {
    Bun.env.NODE_ENV = "development";
    const secret = Bun.env.ABIDE_IDENTITY_SECRET;
    delete Bun.env.ABIDE_IDENTITY_SECRET;
    expect(() => requireSecretForAuthedSet(true)).not.toThrow();
    Bun.env.ABIDE_IDENTITY_SECRET = secret!;
    if (originalNodeEnv === undefined) delete Bun.env.NODE_ENV;
    else Bun.env.NODE_ENV = originalNodeEnv;
  });
});
