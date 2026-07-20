import { describe, expect, test } from "bun:test";
import { canonicalKey, decode, encode } from "./codec.ts";

function roundtrip(value: unknown): unknown {
  return decode(encode(value));
}

describe("canonicalKey", () => {
  test("is deterministic for the same input", () => {
    const value = { a: 1, b: [2, 3], c: { d: true } };
    expect(canonicalKey(value)).toBe(canonicalKey(value));
  });

  test("is independent of object key order", () => {
    expect(canonicalKey({ a: 1, b: 2 })).toBe(canonicalKey({ b: 2, a: 1 }));
    expect(canonicalKey({ x: { m: 1, n: 2 }, y: 3 })).toBe(canonicalKey({ y: 3, x: { n: 2, m: 1 } }));
  });

  test("is sensitive to array order", () => {
    expect(canonicalKey([1, 2, 3])).not.toBe(canonicalKey([3, 2, 1]));
    expect(canonicalKey([1, 2])).not.toBe(canonicalKey([2, 1]));
  });

  test("distinguishes values that differ by type", () => {
    const keys = [
      canonicalKey(1),
      canonicalKey("1"),
      canonicalKey(1n),
      canonicalKey(true),
      canonicalKey(null),
      canonicalKey(undefined),
      canonicalKey([1]),
      canonicalKey({ 0: 1 }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("distinguishes nested-structure differences", () => {
    expect(canonicalKey({ a: { b: 1 } })).not.toBe(canonicalKey({ a: { b: 2 } }));
    expect(canonicalKey({ a: 1 })).not.toBe(canonicalKey({ b: 1 }));
    expect(canonicalKey([[1], 2])).not.toBe(canonicalKey([1, [2]]));
  });

  test("distinguishes number edge cases", () => {
    expect(canonicalKey(-0)).not.toBe(canonicalKey(0));
    expect(canonicalKey(NaN)).toBe(canonicalKey(NaN));
    expect(canonicalKey(Infinity)).not.toBe(canonicalKey(-Infinity));
  });

  test("gives stable, order-independent keys for Map and Set", () => {
    const first = new Map<string, number>([
      ["a", 1],
      ["b", 2],
    ]);
    const second = new Map<string, number>([
      ["b", 2],
      ["a", 1],
    ]);
    expect(canonicalKey(first)).toBe(canonicalKey(second));
    expect(canonicalKey(new Set([1, 2, 3]))).toBe(canonicalKey(new Set([3, 2, 1])));
  });

  test("gives stable keys for Date, RegExp, URL", () => {
    const now = Date.now();
    expect(canonicalKey(new Date(now))).toBe(canonicalKey(new Date(now)));
    expect(canonicalKey(/ab+c/gi)).toBe(canonicalKey(/ab+c/gi));
    expect(canonicalKey(/ab+c/gi)).not.toBe(canonicalKey(/ab+c/g));
    expect(canonicalKey(new URL("https://x.test/p"))).toBe(canonicalKey(new URL("https://x.test/p")));
  });

  test("handles circular structures without throwing", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(typeof canonicalKey(a)).toBe("string");
    expect(canonicalKey(a)).toBe(canonicalKey(a));
  });

  test("throws on functions and symbols", () => {
    expect(() => canonicalKey(() => {})).toThrow();
    expect(() => canonicalKey(Symbol("x"))).toThrow();
  });
});

describe("encode / decode round-trip", () => {
  test("JSON primitives", () => {
    expect(roundtrip(null)).toBe(null);
    expect(roundtrip(true)).toBe(true);
    expect(roundtrip(false)).toBe(false);
    expect(roundtrip(42)).toBe(42);
    expect(roundtrip(-3.14)).toBe(-3.14);
    expect(roundtrip("hello \"world\"\n")).toBe("hello \"world\"\n");
    expect(roundtrip("")).toBe("");
  });

  test("undefined at top level and nested", () => {
    expect(roundtrip(undefined)).toBe(undefined);
    expect(roundtrip({ a: undefined })).toEqual({ a: undefined });
    const decoded = roundtrip({ a: undefined }) as Record<string, unknown>;
    expect("a" in decoded).toBe(true);
    expect(roundtrip([undefined, 1])).toEqual([undefined, 1]);
  });

  test("number edge cases", () => {
    expect(roundtrip(NaN)).toBeNaN();
    expect(roundtrip(Infinity)).toBe(Infinity);
    expect(roundtrip(-Infinity)).toBe(-Infinity);
    expect(Object.is(roundtrip(-0), -0)).toBe(true);
    expect(roundtrip(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("BigInt", () => {
    expect(roundtrip(123n)).toBe(123n);
    expect(roundtrip(-9007199254740993n)).toBe(-9007199254740993n);
    expect(roundtrip({ big: 10n })).toEqual({ big: 10n });
  });

  test("Date, including invalid date", () => {
    const date = new Date("2026-07-17T12:34:56.789Z");
    const decoded = roundtrip(date) as Date;
    expect(decoded).toBeInstanceOf(Date);
    expect(decoded.getTime()).toBe(date.getTime());

    const invalid = roundtrip(new Date(NaN)) as Date;
    expect(invalid).toBeInstanceOf(Date);
    expect(Number.isNaN(invalid.getTime())).toBe(true);
  });

  test("RegExp with flags", () => {
    const decoded = roundtrip(/ab+c/gi) as RegExp;
    expect(decoded).toBeInstanceOf(RegExp);
    expect(decoded.source).toBe("ab+c");
    expect(decoded.flags).toBe("gi");
  });

  test("URL", () => {
    const url = new URL("https://user@host.test:8080/a/b?q=1#frag");
    const decoded = roundtrip(url) as URL;
    expect(decoded).toBeInstanceOf(URL);
    expect(decoded.href).toBe(url.href);
  });

  test("ArrayBuffer", () => {
    const buffer = new Uint8Array([1, 2, 3, 250, 0, 255]).buffer;
    const decoded = roundtrip(buffer) as ArrayBuffer;
    expect(decoded).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(decoded))).toEqual([1, 2, 3, 250, 0, 255]);
  });

  test("every TypedArray flavor", () => {
    const arrays = [
      new Int8Array([-1, 2, -3]),
      new Uint8Array([1, 2, 255]),
      new Uint8ClampedArray([0, 128, 255]),
      new Int16Array([-1000, 1000]),
      new Uint16Array([0, 65535]),
      new Int32Array([-70000, 70000]),
      new Uint32Array([0, 4000000000]),
      new Float32Array([1.5, -2.25]),
      new Float64Array([Math.PI, -0.5]),
      new BigInt64Array([-5n, 5n]),
      new BigUint64Array([0n, 18446744073709551615n]),
    ];
    for (const array of arrays) {
      const decoded = roundtrip(array);
      expect(decoded).toBeInstanceOf(array.constructor as new () => object);
      expect(Array.from(decoded as Iterable<unknown>)).toEqual(Array.from(array as Iterable<unknown>));
    }
  });

  test("TypedArray sharing an underlying buffer serializes only its own view", () => {
    const buffer = new Uint8Array([10, 20, 30, 40]).buffer;
    const view = new Uint8Array(buffer, 1, 2); // [20, 30]
    const decoded = roundtrip(view) as Uint8Array;
    expect(Array.from(decoded)).toEqual([20, 30]);
    expect(decoded.byteOffset).toBe(0);
  });

  test("nested Map with mixed key/value types", () => {
    const map = new Map<unknown, unknown>([
      ["a", 1],
      [2, new Date(0)],
      [{ k: "obj-key" }, new Set([1, 2])],
    ]);
    const decoded = roundtrip(map) as Map<unknown, unknown>;
    expect(decoded).toBeInstanceOf(Map);
    expect(decoded.get("a")).toBe(1);
    expect((decoded.get(2) as Date).getTime()).toBe(0);
    const objKey = [...decoded.keys()].find((k) => typeof k === "object") as Record<string, unknown>;
    expect(objKey).toEqual({ k: "obj-key" });
    expect(decoded.get(objKey)).toEqual(new Set([1, 2]));
  });

  test("nested Set of complex values", () => {
    const set = new Set<unknown>([1, "two", { three: 3 }, new Map([["x", 1]])]);
    const decoded = roundtrip(set) as Set<unknown>;
    expect(decoded).toBeInstanceOf(Set);
    expect(decoded.size).toBe(4);
    expect(decoded.has(1)).toBe(true);
    expect(decoded.has("two")).toBe(true);
    expect([...decoded].some((v) => v instanceof Map)).toBe(true);
  });

  test("deeply nested plain structure deep-equals", () => {
    const value = {
      user: { id: 1n, name: "abide", tags: new Set(["x", "y"]) },
      when: new Date("2020-01-01T00:00:00Z"),
      pattern: /a.c/i,
      site: new URL("https://abide.test/"),
      meta: new Map<string, unknown>([["k", [1, 2, { nested: undefined }]]]),
      bytes: new Uint8Array([9, 8, 7]),
      list: [null, true, "s", 3.5],
    };
    expect(roundtrip(value)).toEqual(value);
  });

  test("empty containers", () => {
    expect(roundtrip({})).toEqual({});
    expect(roundtrip([])).toEqual([]);
    expect(roundtrip(new Map())).toEqual(new Map());
    expect(roundtrip(new Set())).toEqual(new Set());
  });
});

describe("encode / decode references", () => {
  test("preserves a shared reference as shared", () => {
    const shared = { id: 1 };
    const value = { a: shared, b: shared };
    const decoded = roundtrip(value) as { a: object; b: object };
    expect(decoded.a).toEqual({ id: 1 });
    expect(decoded.a).toBe(decoded.b);
  });

  test("preserves shared reference inside arrays", () => {
    const shared = [1, 2, 3];
    const decoded = roundtrip([shared, shared, shared]) as unknown[][];
    expect(decoded[0]).toBe(decoded[1]);
    expect(decoded[1]).toBe(decoded[2]);
    expect(decoded[0]).toEqual([1, 2, 3]);
  });

  test("does not merge structurally-equal but distinct objects", () => {
    const decoded = roundtrip([{ id: 1 }, { id: 1 }]) as object[];
    expect(decoded[0]).toEqual(decoded[1]);
    expect(decoded[0]).not.toBe(decoded[1]);
  });

  test("preserves a shared reference across Map and object", () => {
    const shared = { tag: "s" };
    const map = new Map<string, unknown>([["m", shared]]);
    const decoded = roundtrip({ obj: shared, map }) as { obj: object; map: Map<string, unknown> };
    expect(decoded.obj).toBe(decoded.map.get("m") as object);
  });

  test("round-trips a direct self reference", () => {
    const value: Record<string, unknown> = { name: "root" };
    value.self = value;
    const decoded = roundtrip(value) as Record<string, unknown>;
    expect(decoded.name).toBe("root");
    expect(decoded.self).toBe(decoded);
  });

  test("round-trips a self-referential array", () => {
    const array: unknown[] = [1, 2];
    array.push(array);
    const decoded = roundtrip(array) as unknown[];
    expect(decoded[0]).toBe(1);
    expect(decoded[2]).toBe(decoded);
  });

  test("round-trips indirect cycles across containers", () => {
    const a: Record<string, unknown> = { name: "a" };
    const b: Record<string, unknown> = { name: "b" };
    a.next = b;
    b.prev = a;
    const decoded = roundtrip(a) as Record<string, unknown>;
    expect((decoded.next as Record<string, unknown>).prev).toBe(decoded);
  });

  test("round-trips a cycle through a Map and Set", () => {
    const map = new Map<string, unknown>();
    const set = new Set<unknown>();
    map.set("set", set);
    set.add(map);
    const decoded = roundtrip(map) as Map<string, unknown>;
    const decodedSet = decoded.get("set") as Set<unknown>;
    expect(decodedSet).toBeInstanceOf(Set);
    expect(decodedSet.has(decoded)).toBe(true);
  });
});

describe("encode rejects unsupported values", () => {
  class Point {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }

  test("throws on a class instance", () => {
    expect(() => encode(new Point(1, 2))).toThrow();
  });

  test("throws on a class instance nested in a supported container", () => {
    expect(() => encode({ p: new Point(1, 2) })).toThrow();
    expect(() => encode([new Point(1, 2)])).toThrow();
    expect(() => encode(new Set([new Point(1, 2)]))).toThrow();
  });

  test("throws on functions", () => {
    expect(() => encode(() => {})).toThrow();
    expect(() => encode({ fn: function named() {} })).toThrow();
  });

  test("throws on symbols", () => {
    expect(() => encode(Symbol("x"))).toThrow();
    expect(() => encode({ s: Symbol.iterator })).toThrow();
  });
});
