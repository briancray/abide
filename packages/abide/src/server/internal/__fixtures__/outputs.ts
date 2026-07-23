// Fixtures for deriveSchema.test.ts — the §11.4 output-wrapper unwrapping cases. Output derivation
// must see THROUGH the response helpers to the success payload, and drop redirect/error members.

import { error } from "abide/server/error";
import { GET } from "abide/server/GET";
import { json } from "abide/server/json";
import { jsonl } from "abide/server/jsonl";
import { redirect } from "abide/server/redirect";

// json(T) → T
export const jsonReturn = GET(() => json({ id: 1, name: "x" }));

// jsonl(C) → the element/chunk C
export const streamReturn = GET(() =>
  jsonl(
    (async function* () {
      yield { seq: 1, kind: "tick" };
    })(),
  ),
);

// value | Response(error) → value (the error member is dropped). The success branch returns a PLAIN
// object, not `json(...)`: `TypedResponse<T> | Response` collapses to `Response` at the type level (a
// TypedResponse IS a Response), erasing T — so a typed success+error union must return the bare value.
export const valueOrError = GET(({ ok = true }) =>
  ok ? { value: 42 } : error(400, "no"),
);

// redirect() → bare Response → NO success payload (output stays undefined)
export const redirectOnly = GET(() => redirect("/home"));
