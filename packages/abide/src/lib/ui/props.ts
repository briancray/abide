// Public reactive prop reader for `.abide` components (M3a).
//
// In a component `<script>` an author writes `const { title = "…" } = props()` to read the instance's
// props reactively. The emitted `mount`/`render` setup (internal/emitSetup.ts) binds `props` to the
// REAL per-instance reader behind this import's local name, so the actual values never come from this
// file — this module exists so the documented `abide/ui/props` specifier RESOLVES for the type-checker
// (`tsc` / `abide check`) and so a page that must `import { props }` (no ambient identifiers) type-checks.
//
// Called directly outside a `.abide` instance scope (e.g. the module script, where there is no
// instance) it yields an empty object — mirroring the emitted module-scope `props: () => ({})`.

export function props<T = Record<string, unknown>>(): T {
  return {} as T;
}
