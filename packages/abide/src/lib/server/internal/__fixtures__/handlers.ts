// Fixtures for deriveSchema.test.ts — a spread of shapes the deriver must handle.

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
