---
"@abide/abide": patch
---

Route the rpc method + `outbox` build transforms through the warm server program (ADR-0025 phase 2)

Phase 1 warmed one per-root `ts.Program` over the server module graph and used it only for streaming detection (gated on a build-cost budget). Phase 2 lifts that budget — the ~0.5 s cold cost is paid once per root, amortized, and always fail-open — and routes the two remaining text-scanners through the same warm program:

- **HTTP method** now resolves off the export helper's *symbol* (following import aliases and re-exports), so `export const x = read(fn)` where `import { GET as read }` correctly types as `GET` in the generated `rpc.d.ts`, where the `RPC_EXPORT` regex read nothing.
- **`outbox`** now resolves off the opts object's property *type*, lifting "must be an inline literal" to "must be statically known" — an imported const (`outbox: OUTBOX_ENABLED`) resolves to its literal `true` instead of erroring, and an `outbox:` mention inside the handler body is ignored.

Every query fails open to today's regex/char-scan (no warm program, an unresolvable node, or a checker throw → byte-identical to before), so this can only harden, never break, a build. The hand-rolled scanners remain as that fallback and as the residual span-finder for splicing.

Also adds a one-line build-start log (`[abide] building client bundle…`, one-shot builds only) so the program-warming pause at the start of `abide build`/`compile` isn't mistaken for a hang.
