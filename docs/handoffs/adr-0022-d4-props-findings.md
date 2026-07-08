# ADR-0022 D4 — props type resolution: discovery findings

**Task:** trace how a `.abide` component's props type is built, locate the
"inline-only" limitation D4 targets, and produce an implementation brief.

**Scope:** read-only discovery. No code changed. All claims below were verified by
running `compileShadow` and the full `createShadowProgram` + `collectAbideDiagnostics`
check pipeline in-memory against throwaway projects (mirroring
`packages/abide/tests/abideCheck.test.ts`).

---

## TL;DR — the headline finding

**D4's premise is already largely satisfied.** An imported/aliased props type passed
as the generic argument — `props<MyProps>()` where `MyProps` (or `Foo as Props`) is
imported — **already flows through the shadow's real TypeScript program today**, both
for the child's own template checks and for a parent's `<Child .../>` prop checks.
Verified end-to-end: a parent passing `label={42}` to a child whose props are declared
via an imported `type MyProps = { label: string }` is caught with
`Type 'number' is not assignable to type 'string'`.

The reason it works: the harvest re-emits the type argument's **verbatim text** (an
identifier like `MyProps`) into the shadow module, which also carries the author's
`import type { MyProps }` verbatim. The parent reads the child's props via
`Parameters<typeof Child>[0]` → `__Props` → `MyProps`, and TS resolves it natively
through the module graph. This is *not* the broken "lift a value fragment out of scope"
anti-pattern D1 warns about (that was `extractObjectProperty`); a type *reference* stays
in a module that has its import, so it resolves.

So the genuine remaining gap is **narrower than the ADR text implies**. It is not
"imported types don't flow." It is: **the harvest reads only the `props<T>()` generic
argument, and ignores a props type declared in any other authoring form** — most
concretely the destructure binding annotation `const {…}: MyProps = props()`, which
silently collapses the parent-facing shape to `Record<string, any>` (a false-negative:
parents pass anything and nothing is checked).

The maintainer should decide whether D4 is "add tests + docs locking in the already-
working `props<ImportedType>()` path, and close the annotation-form false negative" (low
effort, recommended) or a larger authoring-ergonomics change (declare props once without
threading the generic). This brief covers both.

---

## 1. How the `Props` type is built today

### 1a. The single harvest site

`packages/abide/src/lib/ui/compile/compileShadow.ts`, `scopeLineFor`, the `props` branch
(lines 484–490):

```ts
if (callee === 'props') {
    /* `const {…} = props<Shape>()`: the type arg (default `Record<string, any>`)
       IS the parent-facing prop shape, and the destructure projects verbatim against
       the declared typed `props()` so each binding inherits its value type. */
    const shape = call.typeArguments?.[0]
    propsShapes.push(shape === undefined ? 'Record<string, any>' : verbatim(shape))
    return { text: `const ${verbatim(declaration)};`, segments: [span(declaration, 6)] }
}
```

`verbatim(shape)` is `scriptBody.slice(node.getStart(file), node.getEnd())` — raw source
text of the type node, whatever it is (object literal `{…}`, bare identifier `MyProps`,
alias, union, etc.). This is the **only** place `propsShapes` is populated (confirmed:
`grep propsShapes` shows population only at `scopeLineFor`, consumption only at the
`type __Props = …` emit).

### 1b. From `propsShapes` to the parent-facing `__Props`

`compileShadow.ts` lines 130–134:

```ts
builder.raw(
    propsShapes.length > 0
        ? `type __Props = ${propsShapes.join(' & ')}\n`
        : `interface __Props {}\n`,
)
```

Multiple `props<…>()` destructures intersect (`A & B`); a component that reads no props
gets `interface __Props {}`. The render fn is `export default async function (__props:
__Props): Promise<void>` (line 138), so a parent's `Parameters<typeof Child>[0]` is
exactly `__Props` (see the `component` case, `compileShadow.ts` lines 631–736, which
builds the completeness/excess checks off `Parameters<typeof ${node.name}>[0]`).

### 1c. The `props()` reader's own return type (the child-side view)

`compileShadow.ts` lines 92–94 — emitted only when `props` is imported (alias-safe via
`propsLocalName`):

```ts
if (propsLocalName !== undefined) {
    builder.raw(`declare function ${propsLocalName}<T = {}>(): (${propsType}) & T\n`)
}
```

`propsType` is the **file-contextual** shape threaded in from the caller:

- **Page/layout (route params):** `createShadowProgram.ts` line 51 and
  `createShadowLanguageService.ts` line 85 call `compileShadow(source, pagePropsType(abidePath))`.
  `pagePropsType` (`pagePropsType.ts`) returns the route-param object literal via
  `routeParamsShape(pageUrlForFile(relPath))` — e.g. `{ "id": string }` — for a
  `page.abide`/`layout.abide` under `src/ui/pages/`, else `undefined`.
- **Plain component:** `pagePropsType` returns `undefined`, so `compileShadow`'s default
  parameter `propsType = 'Record<string, any>'` (line 73) applies.

So inside the child, `const { id } = props<MyProps>()` reads its bindings against
`(routeShape) & MyProps`. Route params never need re-spelling; the author's `T` is
additive. This is the child-side typing; it is **separate** from the parent-facing
`__Props` (which is `propsShapes.join(' & ')` = just the author's `T`, no route shape —
correct, since a page is never mounted as a child).

### 1d. Runtime is type-agnostic

The runtime lowering (`desugarSignals.ts`, `propsStatements` etc.) destructures
`props()` and **ignores the type argument entirely** — each binding becomes a
`scope().derive("name", () => $props["key"]?.() ?? default)` computed. `props.ts` throws
if called directly. So the props type is a pure type-check concern; nothing at runtime
constrains its form, and there is **no validation anywhere that rejects a non-inline /
non-object-literal props type**.

---

## 2. Where the "inline-only" limitation actually is

**It is not where the ADR text suggests.** Empirically:

| Authoring form | `__Props` result | Parent check works? |
|---|---|---|
| `props<{ a: string }>()` (inline literal) | `{ a: string }` | yes |
| `props<MyProps>()`, `import type { MyProps }` | `MyProps` | **yes** (verified) |
| `props<Props>()`, `import type { Foo as Props }` | `Props` | **yes** (verified) |
| `const { a }: MyProps = props()` (binding annotation, no generic) | **`Record<string, any>`** | **no — false negative** (verified) |
| no `props()` call at all | `interface __Props {}` | n/a (no props) |

The limitation is precisely: **`scopeLineFor` reads only `call.typeArguments?.[0]`.** When
the author annotates the destructure pattern instead of passing the generic
(`const { a }: MyProps = props()`), `call.typeArguments` is `undefined`, so `propsShapes`
gets the `Record<string, any>` fallback and the parent-facing shape is lost — a silent
false negative.

**Notable inconsistency:** the sibling reactive branches in the *same function* already
fall back to the binding annotation. `state` (line 506) and `computed`/`linked`
(line 540) both do `call.typeArguments?.[0] ?? declaration.type`. Only the `props` branch
(line 488) omits the `?? declaration.type` fallback. So the fix for the annotation gap is
symmetric with code already present two branches away.

### Why the generic-arg form already resolves imports (the mechanism)

Per ADR-0010 the shadow is a **virtual `.ts` at the source file's own path**, so every
`import` resolves exactly as the real module's would. `analyzeScript` emits *all* import
declarations verbatim (`compileShadow.ts` lines 401–408), including `import type`. The
harvested type text (`MyProps`) is re-emitted into that same module as
`type __Props = MyProps`, so it resolves against the verbatim import. This is confirmed
by the check pipeline catching a parent's wrong-typed prop against an imported-type child.
`createShadowProgram` / `createShadowLanguageService` share `resolveAbideImports` and the
project tsconfig (`paths`/`baseUrl`), so `./types`-style relative and aliased imports
resolve identically in CLI and LSP.

---

## 3. Current vs. target authoring syntax

**Current (only supported harvest path):**
```svelte
<script>
import { props } from 'abide/ui/props'
import type { MyProps } from './types'
const { title } = props<MyProps>()   // imported type — ALREADY WORKS
</script>
```

Note: ADR-0010/ADR-0022 both mention a singular `prop<T>('key')` reader. **That form is
removed** — `desugarSignals.ts` line ~19 throws "`prop(...)` has been removed — read props
by destructuring `props()`". The only current form is the `props()` destructure. The ADR's
`prop<T>()` reference is stale.

**Target forms to support (proposed, pick per maintainer intent):**

- **Option A (close the false negative — recommended, minimal):** honor the destructure
  binding annotation as an equal props-type source:
  ```svelte
  const { title }: MyProps = props()
  ```
  Symmetric with `state`/`computed` (which already do `?? declaration.type`).

- **Option B (already works — just formalize):** keep `props<MyProps>()` as the canonical
  way to reference an imported/aliased type. Zero code change; add tests + docs so it's a
  guaranteed surface, not an accident.

- **Option C (larger ergonomics, optional):** allow declaring the props type once at
  module scope and picking it up without threading a generic — e.g. a conventional
  `type Props = …` / `import type { Props }` that the shadow treats as `__Props` when no
  `props<T>()` generic is supplied. This is the biggest change and the only one that
  "resolves a type through the program" in a new way; weigh against the fact that B already
  gives one-declaration reuse via `props<Props>()`.

Recommendation: **A + B** satisfy the ADR's intent ("removes the inline-only limitation;
the shadow harvest becomes a fallback, not the only path") with minimal surface churn.
Treat C as a separate ergonomics ADR if desired.

---

## 4. Concrete implementation approach

### Change 1 — honor the binding annotation (closes the false negative)

**File:** `packages/abide/src/lib/ui/compile/compileShadow.ts`, `scopeLineFor`, `props`
branch (lines 484–490).

Replace:
```ts
const shape = call.typeArguments?.[0]
propsShapes.push(shape === undefined ? 'Record<string, any>' : verbatim(shape))
```
with a fallback to the destructure's declared type (mirroring the `state`/`computed`
branches at lines 506 and 540):
```ts
const shape = call.typeArguments?.[0] ?? declaration.type
propsShapes.push(shape === undefined ? 'Record<string, any>' : verbatim(shape))
```
`declaration.type` is the annotation on `const {…}: T`. `verbatim(T)` re-emits it into the
shadow module, resolving through the same imports — no new mechanism, same graph-resolution
that already works for the generic-arg form.

Edge case to keep intact: the returned scope line is `const ${verbatim(declaration)};` —
`verbatim(declaration)` includes the `: T` annotation and the `= props()` initializer, so
the destructure still type-checks its bindings against `(routeShape) & T` via the declared
`props()` function. No change needed there; just confirm the annotation doesn't
double-constrain awkwardly (it constrains the destructure to `T`, which is intended).

### Change 2 — (only if pursuing Option C) props type without a generic

Would need a convention for "the component's props type." Cleanest that stays within the
existing text-harvest-then-resolve model: if no `props<T>()` generic and no annotation, look
for a module-scope `type Props`/`interface Props` (or an imported `Props`) and use it as
`__Props`. This touches `analyzeScript` (it already collects `types` and `imports`) and the
`__Props` emit in `compileShadow`. Higher risk (naming convention, collision with a user's
own `Props`); recommend a dedicated decision before building.

### Change 3 — tests locking in the (already-working) imported-type path

**File:** `packages/abide/tests/abideCheck.test.ts` (and/or
`packages/abide/tests/uiCompileShadow.test.ts`). Add cases:
- child declares props via `import type { MyProps }` + `props<MyProps>()`; parent passing a
  wrong-typed prop is caught (this passes today — regression lock).
- aliased `import type { Foo as Props }` + `props<Props>()` resolves (passes today).
- **the fix:** `const { label }: MyProps = props()` in a child; parent passing `label={42}`
  is caught (fails today, passes after Change 1).
- `__Props` unit assertion in `uiCompileShadow.test.ts`: annotation form emits
  `type __Props = MyProps`, not `Record<string, any>`.

### Change 4 — docs

`props<ImportedType>()` and the annotation form are user-facing. Update the `props`
`// @documentation reactive-state` surface / AGENTS.md note and any ADR-0010-derived docs
that still reference the removed `prop<T>()` singular form. Run
`bun run packages/abide/scripts/readmeSurfaces.ts` if the export surface annotation changes.

---

## 5. Risks / interactions

- **Auto-deref value typing:** unaffected. Change 1 only feeds the parent-facing `__Props`;
  the child-side destructure still reads against `(routeShape) & T` via the declared
  `props()` function. The `const ${verbatim(declaration)}` line is untouched.
- **Page route-param props:** `pagePropsType` → `propsType` threading is orthogonal and
  stays. For pages, `__Props` is `T` only (no route shape) — correct, pages aren't mounted
  as children. Confirm Change 1 doesn't accidentally intersect the route shape into the
  parent-facing `__Props` (it doesn't — `propsType` is only in the `declare function props`
  return, not in `propsShapes`).
- **`abide check` (CLI) vs LSP parity:** both go through `compileShadow` + shared
  `resolveAbideImports`/tsconfig (`createShadowProgram.ts`, `createShadowLanguageService.ts`),
  so a single `compileShadow` change lands in both identically. The LSP memoizes on shadow
  version (`compiledAt`) and route props (`propsTypes`); neither cache keys on props-type
  form, so no cache-invalidation change is needed.
- **Diagnostic mapping:** `verbatim(declaration.type)` carries no `span` today in the
  `props` branch (only `span(declaration, 6)` on the destructure). A type error *inside*
  the annotation's referenced type resolves at the import site, not the annotation — same
  as the generic-arg form today. Acceptable; not a regression.
- **Multiple `props()` destructures / rest bindings:** intersection logic
  (`propsShapes.join(' & ')`) and `const {…, ...rest} = props()` handling
  (`desugarSignals.propsDestructure`) are unaffected by reading an extra type source.
- **`$$`-reserved-name and top-level-await diagnostics:** independent passes; no interaction.
- **Downside of relying on text re-emit (not a new risk, but worth stating):** because the
  type is harvested as text and re-emitted, a props type that references a *value* in scope
  via `typeof`/`keyof typeof` must have that value hoisted above `__Props` — which
  `compileShadow` already does (types at lines 113–115, scope at 124–126 are emitted before
  `__Props`; `abideCheck.test.ts` has explicit `keyof typeof sizes` and hoist regression
  tests). Change 1 stays within that ordering, so it inherits the existing guarantee.

---

## 6. Done criteria

- [ ] `const {…}: MyProps = props()` (imported/aliased/local `MyProps`) produces
      `type __Props = MyProps` in the shadow, not `Record<string, any>`.
- [ ] A parent passing a wrong-typed prop to a child that declared props via the annotation
      form is caught by `abide check` (and the LSP).
- [ ] Existing `props<{…}>()` inline-literal and `props<ImportedType>()` generic-arg cases
      remain green (regression tests added).
- [ ] Aliased `import type { Foo as Props }` + `props<Props>()` has an explicit test.
- [ ] Child-side auto-deref and page route-param typing unchanged (existing shadow/scope
      tests stay green).
- [ ] Docs updated: remove stale `prop<T>()` singular references; state that an
      imported/aliased props type is supported via `props<T>()` or the destructure
      annotation.
- [ ] `bun format` + `bun test` clean.

---

## 7. Open questions for the maintainer

1. **Is D4 already satisfied for your intent?** `props<ImportedType>()` and
   `props<Foo as Props>()` resolve through the module graph today (verified end-to-end). If
   your real complaint was the annotation-form false negative, Change 1 + tests is the whole
   job. Confirm before scoping larger.
2. **Do you want Option C** (declare `type Props`/imported `Props` once and have it picked
   up with no `props<T>()` generic at all)? That's the only part needing genuinely new
   shadow synthesis and a naming convention; it warrants its own decision. If not, `props<T>()`
   with an imported `T` already gives one-declaration reuse.
3. **Precedence when both a generic arg and an annotation are present**
   (`const {…}: A = props<B>()`)? Proposed: generic wins (current `?? declaration.type`
   ordering), matching `state`/`computed`. Confirm.
4. **ADR text cleanup:** the ADR (and ADR-0010) reference a `prop<T>()` singular reader that
   no longer exists. Should the D4 landing PR also correct the ADR prose to
   `props<T>()`/annotation?
5. **Should the parent-facing `__Props` ever intersect route params for a page?** Currently
   no (pages aren't children). Assuming that stays; flag if any layout-as-component pattern
   needs it.

---

### Key files

- `packages/abide/src/lib/ui/compile/compileShadow.ts` — the harvest (`scopeLineFor` props
  branch, lines 484–490), `__Props` emit (lines 130–134), `props()` reader declare
  (lines 92–94).
- `packages/abide/src/lib/ui/compile/pagePropsType.ts` — page/layout route-param props type.
- `packages/abide/src/lib/shared/routeParamsShape.ts` — route param object-literal builder.
- `packages/abide/src/lib/ui/compile/createShadowProgram.ts` /
  `createShadowLanguageService.ts` — thread `pagePropsType` into `compileShadow`; shared
  resolver + tsconfig (CLI/LSP parity).
- `packages/abide/src/lib/ui/compile/desugarSignals.ts` — runtime lowering (type-agnostic).
- `packages/abide/src/lib/ui/props.ts` — the reader export + its documentation slug.
- `packages/abide/tests/abideCheck.test.ts` / `uiCompileShadow.test.ts` — where to add
  coverage.
