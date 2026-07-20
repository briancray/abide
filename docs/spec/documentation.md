# abide — Framework Documentation (Spec, Slice 12)

Status: draft, derived from design interview 2026-07-17.
Scope: how **abide itself** is documented for developers (and coding agents) — sources, sync,
structure. Not a runtime "app self-documents" feature (that's OpenAPI + MCP, machine-surfaces.md).
Builds on MS1.2 (TSDoc→generation), CL4 (`init-agent`), C10 (`abide check`).

Through-line: **generate from the source of truth so docs can't drift; hand-write only what
generation can't produce.**

---

## DOC1. Documentation model

1. **Generated reference (TSDoc → docs).** The framework's API reference is **generated from the
   public API's TSDoc + types** (TS7), the same source that feeds OpenAPI/MCP (MS1.2). Each
   public import (`abide/server/GET`, `abide/ui/state`, …) documents itself; the reference cannot
   drift from the real signatures. Not a hand-maintained parallel API list.
2. **Two-tier docs:** **generated reference** + **hand-written conceptual guides.** The guides
   cover what generation can't — the isomorphism model, cache scope (§2–3), the async-read seam
   (C3), auth (AU), the reactivity substrate (§7). One docs site, two tiers.
3. **`docs/spec/*` (these twelve specs) are the *design* record, distinct from user docs.** They
   are internally-facing "why/how-decided"; user docs are externally-facing "how-to-use." Specs
   **seed** the conceptual guides but do **not** become the public docs.
4. **The AI-agent pointer (`CLAUDE.md` via `abide init-agent`, CL4) is a first-class doc
   surface** — machine-readable orientation for coding agents (conventions, file layout, the
   public API table). **Generated/refreshed from the same reference source** so it stays current;
   not hand-edited — drift is corrected by regenerating against the current design, never by
   hand-patching.
5. **Examples are tested code** — recipes/examples are real, compiled, `bun test`-verified
   projects (or snippets checked by `abide check`, C10), so they can't rot.
6. **Docs are versioned** to track framework releases (versioned docs site).

## DOC2. Docs as a self-testing abide site

The documentation **is itself an abide app** (dogfooded), structured as a living, e2e-tested
capability index. This elevates DOC1.5 from "some tested snippets" to "the whole docs site is
the e2e suite."

1. **The docs site is a real abide app** — built with abide, proving the framework on itself. If
   a capability can't be documented cleanly in abide, that's a design smell surfaced immediately.
2. **Index = every unique capability, one page each.** Each public capability (each RPC helper,
   each template directive/block, each cache verb, streaming, sockets, auth mechanism, agent, …)
   maps to exactly **one** page; the index is the complete enumeration. **A capability with no
   page = a coverage gap** — the capability list derives from the public surface and each must
   resolve to a page (enforced). Each page's demonstration is verified by whichever test lane fits
   the capability (§3) — the completeness rule counts either lane as covered.
3. **Each page is verified by one of two test lanes.**
   - **Browser lane (Playwright, internal to abide)** — for drivable UI capabilities. The capability
     page is a real working demonstration loaded in a real browser, driven (events, nav, reactive
     updates), and asserted. **This un-parks `testing.md`'s client-side interaction testing** — but
     the driver (Playwright) is for **testing abide itself**, **not** a shipped app-facing capability
     (shipping an app e2e capability is parked; adopt only if it later just makes sense).
   - **Runtime-property lane (non-Playwright)** — for **abstract runtime-property capabilities that
     are not drivable UI pages**: cross-user cache isolation/scope, the rich-value **hydration codec**
     (`Date`/`Map`/`Set`/`BigInt`/`RegExp`/`TypedArray`/circular — hydration of server values only,
     never the RPC wire), and hydration correctness (pending-seed handoff, SSR input record/replay,
     output-shaping). These have no UI to drive, so a page still documents them but the assertion
     runs at runtime via `bun test` + `createTestApp` (in-process request/response, cache, and
     hydration checks) rather than browser-driven. This keeps the one-page-per-capability
     completeness rule (§2) from self-reporting failure on capabilities Playwright can't exercise.
4. **Roles collapse into one artifact per capability:** generated reference (DOC1.1) + the page's
   prose (conceptual guide) + the page's live code (canonical example) + its e2e test. **Any
   documentation containing a code snippet is both `abide check`-ed (C10, type-checked) and
   tested (runtime)** — docs code cannot have type errors or be wrong.
5. **Full CI gate:** unit (`bun test`, `createTestApp` — including the runtime-property lane, §3),
   **e2e** (the Playwright docs-capability suite), and **linting**. A failing capability page = a
   broken framework capability or broken docs — they can't diverge.

---

## Deferred / parked (rule before implementation)

- **Docs-site tooling/generator choice** (how the TSDoc + guides + versioning render) — the model
  is fixed (generated reference + hand guides + tested examples), the toolchain is not.
- **Search, interactive playground, API-diff/changelog generation** between versions.
- **Localization** of guides.
