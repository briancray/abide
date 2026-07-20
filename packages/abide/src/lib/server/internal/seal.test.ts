import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seal, unseal } from "./seal.ts";
import type { Principal } from "./scope.ts";

const originalSecret = Bun.env.ABIDE_IDENTITY_SECRET;
const originalTtl = Bun.env.ABIDE_IDENTITY_TTL;

beforeAll(() => {
  Bun.env.ABIDE_IDENTITY_SECRET = "seal-test-secret-value";
});

afterAll(() => {
  if (originalSecret === undefined) delete Bun.env.ABIDE_IDENTITY_SECRET;
  else Bun.env.ABIDE_IDENTITY_SECRET = originalSecret;
  if (originalTtl === undefined) delete Bun.env.ABIDE_IDENTITY_TTL;
  else Bun.env.ABIDE_IDENTITY_TTL = originalTtl;
});

describe("seal / unseal", () => {
  test("round-trips a principal", async () => {
    const principal: Principal = { id: "user-1", authenticated: true, name: "Ada", roles: ["admin"] };
    const token = await seal(principal);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const restored = await unseal(token);
    expect(restored).toEqual(principal);
  });

  test("two seals of the same principal differ (random IV)", async () => {
    const principal: Principal = { id: "user-2", authenticated: false };
    const a = await seal(principal);
    const b = await seal(principal);
    expect(a).not.toBe(b);
    expect(await unseal(a)).toEqual(principal);
    expect(await unseal(b)).toEqual(principal);
  });

  test("rejects a tampered token", async () => {
    const token = await seal({ id: "user-3", authenticated: true });
    // Flip a character near the end (inside the ciphertext / GCM tag region).
    const flipped = token.slice(0, -2) + (token.at(-2) === "A" ? "B" : "A") + token.at(-1);
    expect(await unseal(flipped)).toBeUndefined();
  });

  test("rejects garbage / non-token input", async () => {
    expect(await unseal("")).toBeUndefined();
    expect(await unseal("not-a-real-token!!!")).toBeUndefined();
    expect(await unseal("AAAA")).toBeUndefined();
  });

  test("rejects an expired token", async () => {
    Bun.env.ABIDE_IDENTITY_TTL = "10"; // 10ms TTL
    const token = await seal({ id: "user-4", authenticated: true });
    await Bun.sleep(40);
    expect(await unseal(token)).toBeUndefined();
    delete Bun.env.ABIDE_IDENTITY_TTL;
  });

  test("rejects a token sealed under a different secret", async () => {
    const token = await seal({ id: "user-5", authenticated: true });
    Bun.env.ABIDE_IDENTITY_SECRET = "a-completely-different-secret";
    expect(await unseal(token)).toBeUndefined();
    Bun.env.ABIDE_IDENTITY_SECRET = "seal-test-secret-value";
  });

  test("throws when the sealed blob exceeds ~4KB", async () => {
    const huge: Principal = { id: "user-6", authenticated: true, blob: "a".repeat(4000) };
    await expect(seal(huge)).rejects.toThrow(/exceed/i);
  });
});
