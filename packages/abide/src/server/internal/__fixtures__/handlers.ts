// Fixtures for deriveSchema.test.ts — a spread of shapes the deriver must handle.

import { GET } from "abide/server/GET";

// Minimal wrapper standing in for abide's GET/POST helpers: the deriver must look THROUGH it to the
// inner function passed as the argument.
const wrap = <F>(fn: F): { handler: F } => ({ handler: fn });

type Role = "admin" | "user" | "guest";

// Object input with an optional prop, a literal union, an array, a Date, a nested object, and a
// function-typed field (which must produce a warning). Promise return that must be unwrapped.
export const create = wrap(
  async (input: {
    id: number;
    name?: string;
    role: Role;
    tags: string[];
    createdAt: Date;
    profile: { bio: string; age?: number };
    onEvent: (value: number) => void;
  }): Promise<{ ok: boolean; id: number }> => {
    return { ok: true, id: input.id };
  },
);

// Direct (unwrapped) arrow function with a plain object parameter.
export const echo = (message: { text: string }) => message;

// Number-literal union field + tuple + nullable field.
export const configure = (input: {
  level: 1 | 2 | 3;
  pair: [number, string];
  nickname: string | null;
}): { applied: boolean } => ({ applied: true });

// Not callable — used to assert the not-callable warning path.
export const notAFunction = { just: "data" };

// These three use the REAL `GET` (not the toy `wrap`) so they exercise the actual verb overloads —
// in particular that the plain overload contextually types the param, so an untyped field becomes
// `any` SILENTLY (no `noImplicitAny` error), which is exactly the gap the deriver's `any` warning
// closes.

// Option 5: an UNANNOTATED destructuring-default param. The deriver reads the arrow's own signature,
// where each default drives its field's type — so the input schema comes out fully typed with no
// annotation and no schema, and each defaulted field is optional.
export const defaulted = GET(
  ({ message = "hello", count = 0, flag = false }) => ({
    echoed: message,
    length: message.length,
    count,
    flag,
  }),
);

// A field with NEITHER a default NOR an annotation is `any` — the deriver must WARN (loud, not silent)
// while `count` (defaulted) still derives cleanly.
export const partlyUntyped = GET(({ id, count = 0 }) => ({ id, count }));

// Zero-arg handler: no declared parameter → no input schema, and NO `any` warning (distinct from the
// untyped-param case above).
export const zeroArg = GET(() => ({ ok: true }));
