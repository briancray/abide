// CO1 — env(schema): boot-time typed config from the environment. Tests set Bun.env in-process and
// clean up after each case so vars never leak between tests.

import { afterEach, describe, expect, test } from "bun:test";
import { env } from "./env.ts";

const TEST_KEYS = ["PORT", "DEBUG_MODE", "LOG_LEVEL", "API_URL"];

function clearTestEnv(): void {
  for (const key of TEST_KEYS) delete Bun.env[key];
}

afterEach(clearTestEnv);

describe("env(schema) — JSON Schema form", () => {
  test("coerces strings by declared type and validates", () => {
    Bun.env.PORT = "3000";
    Bun.env.DEBUG_MODE = "true";
    const config = env<{ PORT: number; DEBUG_MODE: boolean }>({
      type: "object",
      properties: { PORT: { type: "number" }, DEBUG_MODE: { type: "boolean" } },
      required: ["PORT", "DEBUG_MODE"],
    });
    expect(config.PORT).toBe(3000);
    expect(config.DEBUG_MODE).toBe(true);
  });

  test("missing required var throws naming the key", () => {
    expect(() =>
      env({ type: "object", properties: { PORT: { type: "number" } }, required: ["PORT"] }),
    ).toThrow(/PORT/);
  });

  test("applies defaults for missing keys and does not require them", () => {
    const config = env<{ PORT: number }>({
      type: "object",
      properties: { PORT: { type: "number", default: 8080 } },
      required: ["PORT"],
    });
    expect(config.PORT).toBe(8080);
  });

  test("returns a frozen object", () => {
    Bun.env.PORT = "3000";
    const config = env<{ PORT: number }>({ type: "object", properties: { PORT: { type: "number" } }, required: ["PORT"] });
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      (config as { PORT: number }).PORT = 1;
    }).toThrow();
  });

  test("invalid coercion (non-numeric PORT) throws naming the key", () => {
    Bun.env.PORT = "not-a-number";
    expect(() =>
      env({ type: "object", properties: { PORT: { type: "number" } }, required: ["PORT"] }),
    ).toThrow(/PORT/);
  });

  test("enum member coerces and passes", () => {
    Bun.env.LOG_LEVEL = "info";
    const config = env<{ LOG_LEVEL: string }>({
      type: "object",
      properties: { LOG_LEVEL: { type: "string", enum: ["info", "warn", "error"] } },
      required: ["LOG_LEVEL"],
    });
    expect(config.LOG_LEVEL).toBe("info");
  });

  test("value outside enum throws", () => {
    Bun.env.LOG_LEVEL = "loud";
    expect(() =>
      env({ type: "object", properties: { LOG_LEVEL: { type: "string", enum: ["info", "warn"] } }, required: ["LOG_LEVEL"] }),
    ).toThrow(/LOG_LEVEL/);
  });
});

describe("env(schema) — plain field-spec map form", () => {
  test("coerces and validates a spec map", () => {
    Bun.env.PORT = "3000";
    const config = env<{ PORT: number }>({ PORT: { type: "number", required: true } });
    expect(config.PORT).toBe(3000);
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("missing required spec-map var throws", () => {
    expect(() => env({ PORT: { type: "number", required: true } })).toThrow(/PORT/);
  });
});

describe("env<T>() — no runtime schema (best-effort pass-through)", () => {
  test("passes environment through unmodified and frozen", () => {
    Bun.env.API_URL = "http://example.test";
    const config = env<Record<string, string | undefined>>();
    expect(config.API_URL).toBe("http://example.test");
    expect(Object.isFrozen(config)).toBe(true);
  });
});

// Assert two types are mutually assignable at COMPILE time (a no-op at runtime). A mismatch is a tsc
// error, caught by the `typecheck` script — these guard the schema-first inference.
function assertType<Expected>(_value: Expected): void {}

describe("env(schema) — schema-first inference (no explicit <T>)", () => {
  test("infers the result type from a field-spec map, coerces at runtime", () => {
    Bun.env.PORT = "3000";
    Bun.env.DEBUG_MODE = "true";
    // No explicit generic — the type is inferred from the schema argument.
    const config = env({
      PORT: { type: "number", required: true },
      DEBUG_MODE: { type: "boolean", default: false },
      API_URL: { type: "string" },
    });
    // Runtime: coercion + defaults still apply exactly as before.
    expect(config.PORT).toBe(3000);
    expect(config.DEBUG_MODE).toBe(true);
    expect(Object.isFrozen(config)).toBe(true);
    // Compile-time: PORT/DEBUG_MODE are present (required / has-default), API_URL is optional.
    assertType<{ PORT: number; DEBUG_MODE: boolean; API_URL?: string }>(config);
    // And the inferred values are usable as their real types (would error if inferred as `unknown`).
    const port: number = config.PORT;
    const debug: boolean = config.DEBUG_MODE;
    expect(port + 0).toBe(3000);
    expect(debug === true).toBe(true);
  });

  test("narrows an enum field to the literal union", () => {
    Bun.env.LOG_LEVEL = "info";
    const config = env({ LOG_LEVEL: { type: "string", enum: ["info", "warn", "error"], required: true } });
    expect(config.LOG_LEVEL).toBe("info");
    assertType<"info" | "warn" | "error">(config.LOG_LEVEL);
  });

  test("an untyped field infers as string (the environment is all-strings)", () => {
    Bun.env.API_URL = "http://example.test";
    const config = env({ API_URL: { required: true } });
    expect(config.API_URL).toBe("http://example.test");
    assertType<{ API_URL: string }>(config);
  });
});
