// JSON response helper (rpc-core §4). Serializes `data` and tags it application/json.
//
// Carries a phantom <T> so callers/tooling can recover the response payload type; at
// runtime it is a plain Response, which is all the wire needs.

import { tagResponseSource, type TypedResponse } from "../shared/internal/responseSource.ts";

export function json<T>(data: T, init?: ResponseInit): TypedResponse<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  // Tag with the pre-encoding value so a cell-backed read caches/seeds `data` exactly like a handler
  // that returned `data` raw (replayable-streams.md §4). `fn.raw` still gets this real Response. The
  // `TypedResponse<T>` brand carries `T` so a read/mutation infers the value type, not `Response`.
  return tagResponseSource(new Response(JSON.stringify(data), { ...init, headers }), { kind: "value", value: data }) as TypedResponse<T>;
}
