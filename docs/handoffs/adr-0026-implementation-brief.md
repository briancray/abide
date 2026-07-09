# Handoff brief — implement ADR-0026

**Spec (read first, it is the contract):** `docs/adr/0026-opt-in-client-side-validation.md`
**Also read:** `CLAUDE.md`, ADR-0022 D2 (why `schemas` now reaches the client stub), ADR-0020 (endpoint-declared opts + the `clients` namespace).

> **Note (2026-07-09):** this brief describes the original *opt-in* (`clients: { validate: true }`) implementation. The accepted decision is now **always-on** validation with a throw→fall-through safety — see the revised `docs/adr/0026-opt-in-client-side-validation.md`. Kept for history.

## Goal

Let a caller opt an endpoint into client-side pre-flight input validation: `remoteProxy` validates the typed args against `schemas.input` before the fetch and, on failure, throws the *same* error shape the server's 422 produces — saving a round-trip. Server validation stays authoritative and unconditional; this is UX only.

## Hard rules
- **NEVER run git.** The orchestrator owns all git.
- biome ignores `src/lib` — hand-style there; `bun run format` outside `src/lib`.
- Public-API change → **regenerate docs** is the orchestrator's job, but you must run `bun run packages/abide/scripts/readmeSurfaces.ts` to confirm no untagged export, and add the `// @documentation` slug if a new export appears.
- **Never remove or weaken server validation.** Client validation is additive; `defineRpc.ts:148` stays the trust boundary. Say so in the code comment.

## Sequencing
1. **Settle the opt-in surface FIRST (D1) — it is the public-API decision, do not guess.** The ADR leans `clients: { validate: true }`. Confirm with the orchestrator/owner before writing the type. This blocks everything else because it shapes `defineRpc`'s opts type and what rides to the stub.
2. **Extract the isomorphic error mapping** (blocks D2) — see below.
3. **D2 + D3** — the `remoteProxy` pre-flight.

---

## D1 — the opt-in flag

- `packages/abide/src/lib/server/rpc/defineRpc.ts` (and `RpcHelper.ts` opts types) — add the opt-in to the chosen surface (leaning `clients: { validate?: boolean }`). It rides the live `opts` to the client stub already (ADR-0022 D2), so no new shipping mechanism — just the type + it being read client-side. Default **off**.
- `packages/abide/src/lib/ui/remoteProxy.ts` — the flag arrives inside `durable` (the forwarded `opts`); read it there (like `outbox`/`cache`/`stream`).

## Isomorphic error mapping (blocks D2)

- `validationError.ts` returns a `Response` (server-only). Only the **issue → field-errors** mapping (`fieldErrorsFromIssues.ts`) is isomorphic. Confirm `fieldErrorsFromIssues` carries no server-only imports; if it does (or by virtue of living under `server/rpc/`), extract the mapping to `shared/` (or the isomorphic subset) so the client can build the same error *data* without importing a `Response` builder. The server 422 path keeps wrapping that data in a `Response`; the client wraps it in an `HttpError` with the identical `data` shape.

## D2 + D3 — `remoteProxy` pre-flight

- `packages/abide/src/lib/ui/remoteProxy.ts`
  - When the opt-in is set **and** `schemas?.input` is present: before the fetch, run `await schemas.input['~standard'].validate(args)` on the **typed args** (pre-serialization — do NOT validate the string-shaped serialized form; this sidesteps `parseArgs`'s query-coercion gap).
  - On a failure result, throw an `HttpError` carrying the same `data` the server 422 carries (via the extracted mapping), so `error instanceof HttpError` + the field-error shape are identical to a server rejection. No fetch is made.
  - D3: the validate may return a `Promise` (`StandardSchemaV1.ts`); await it. The bare call is already async.
  - Widen the `DurableOptions.schemas` type (`remoteProxy.ts:45`) from `unknown` to the schema-group shape so `.input` is typed.

## Done criteria
- `bun run typecheck` → 0; `bun run test` → green; `readmeSurfaces.ts` clean (no untagged export).
- **New tests** (extend `remoteProxyPolicy.test.ts`):
  - Opt-in set + invalid args → `remoteProxy` throws before any fetch (assert the fetch stub is never called) with the **same** error shape as the server 422 for the same schema + input.
  - Opt-in set + valid args → fetches normally.
  - Opt-in **not** set → sends unvalidated (today's behavior), even with a schema present — proving fail-closed default.
  - Async schema (validate returns a Promise) → awaited correctly.
  - Imported schema (a `schemas.input` referencing a shared/imported validator) validates client-side — proving the ADR-0022 D2 "live opts" reach works end to end.
- **Verify by driving it:** in kitchen-sink, opt one rpc in, submit invalid input from the client, confirm no network request is made (devtools/network) and the error renders identically to the server-rejected case; confirm server validation still rejects a hand-crafted bad request that bypasses the client.
