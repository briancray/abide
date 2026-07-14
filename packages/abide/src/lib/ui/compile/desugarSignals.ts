import ts from 'typescript'
import { assignmentTargetNames } from './assignmentTargetNames.ts'
import { hasTopLevelAwait } from './hasTopLevelAwait.ts'
import { type ReactiveImportBindings, reactiveImportBindings } from './resolveReactiveExport.ts'
import { signalCallee } from './signalCallee.ts'
import type { InterpolationKind } from './types/InterpolationKind.ts'
import type { SeedTypeClassifier } from './types/SeedTypeClassifier.ts'

/* The routing decision for a no-marker `computed(seed)`: `true` routes to the eager
   `trackedComputed` stream cell (read via `$$readCell`, the `cellReadNames` bucket), `false`
   to the lazy `derive` doc slot (read as `name()`, the `computedNames` bucket). Shared by the
   name-collection pass and the lowering so both land the binding in the identical bucket. */
type EagerStreamPredicate = (declaration: ts.VariableDeclaration) => boolean

const factory = ts.factory

/* Normalises a `computed`/`linked` argument into a seed THUNK: a literal `() => …` /
   `function` argument passes through unchanged (the author already wrote the thunk), any
   other expression is wrapped as `() => arg`. The wrapper arrow is made ASYNC when the
   expression contains a top-level `await` (`computed(await load())` → `async () => await
   load()`), which is exactly the marker the runtime primitive uses to route to an async cell. */
function wrapSeed(argument: ts.Expression): ts.Expression {
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
        return argument
    }
    const modifiers = hasTopLevelAwait(argument)
        ? [factory.createModifier(ts.SyntaxKind.AsyncKeyword)]
        : undefined
    return factory.createArrowFunction(
        modifiers,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        argument,
    )
}

/* Wraps a seed expression as an async unwrapping thunk `async () => await (arg)` — for a
   type-directed PROMISE seed (ADR-0023/0043) the author wrote WITHOUT `await`
   (`state.computed(getFoo())`). The `async`+`await` makes createAsyncCell unwrap the resolved
   value; a plain `() => getFoo()` thunk would fall to trackedComputed's lazy opaque path (its
   probe self-identifies only a stream, never a promise). The parens keep a comma/ternary seed
   a single await operand. Distinct from `wrapSeed`, which only makes the arrow async when the
   arg already carries a top-level `await`. */
function wrapAwaitSeed(argument: ts.Expression): ts.Expression {
    return factory.createArrowFunction(
        [factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        factory.createAwaitExpression(factory.createParenthesizedExpression(argument)),
    )
}

/* True for an async seed thunk — an arrow/function carrying the `async` modifier, whether
   from `wrapSeed`'s `await` lowering or a passthrough `async () => …` literal the author
   wrote. The routing signal: an async seed becomes an async cell (read via `$$readCell`),
   a sync seed stays the lazy `derive` computed. */
function isAsyncSeed(node: ts.Expression): boolean {
    if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
        return false
    }
    const modifiers = ts.getModifiers(node)
    return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false
}

/* The seed argument of a `computed`/`linked` declaration (undefined for the arg-less
   `computed()` edge). Reused by both the name-collection pass and the lowering. */
function seedArgument(declaration: ts.VariableDeclaration): ts.Expression | undefined {
    return (declaration.initializer as ts.CallExpression).arguments[0]
}

/* True when a `computed(...)` declaration's wrapped seed is async — its await-lowered or
   passthrough-async thunk routes to `scope().computed(...)` (an async cell) instead of the
   lazy `scope().derive(...)`. The one predicate the collection pass and the lowering share. */
function isAsyncComputed(declaration: ts.VariableDeclaration): boolean {
    const argument = seedArgument(declaration)
    if (argument === undefined) {
        return false
    }
    return isAsyncSeed(wrapSeed(argument))
}

/* True for a SYNC `computed(...)` seed that is a bare CALL or IDENTIFIER — `computed(getStream())`
   / `computed(ref)`, the shape that may produce a stream/promise source. These route to the
   eager `scope().trackedComputed(...)` (which probes its seed and auto-tracks a
   `NamedAsyncIterable`), read via `$$readCell`; an arithmetic/member/literal seed stays on the
   lazy `derive` path (read as `name()`). Excludes the async case (`isAsyncComputed` owns it) and
   a literal `() => …` thunk (a direct thunk the author wrote — left lazy on `derive`). */
function isBareCallComputed(declaration: ts.VariableDeclaration): boolean {
    const argument = seedArgument(declaration)
    if (argument === undefined || isAsyncSeed(wrapSeed(argument))) {
        return false
    }
    return ts.isCallExpression(argument) || ts.isIdentifier(argument)
}

/* True when a `computed`/`linked` seed is a BLOCKING async cell (ADR-0042 D6): its wrapped seed
   is an async thunk whose BODY has a top-level `await` — `computed(await X)` (wrapSeed makes it
   `async () => await X`) or `computed(async () => await X)`. An async thunk with NO await
   (`computed(async () => getFoo())`) is STREAMING — `await` is the sole blocking marker. A
   sync/stream seed is not blocking. The read of a blocking cell suspends its render region until
   the value resolves; a streaming cell reads `undefined`-while-pending. Reuses `hasTopLevelAwait`
   applied to the thunk BODY (not the arrow), so the walk descends exactly one function level. */
function isBlockingSeed(argument: ts.Expression): boolean {
    const wrapped = wrapSeed(argument)
    if (!isAsyncSeed(wrapped)) {
        return false
    }
    const body =
        ts.isArrowFunction(wrapped) || ts.isFunctionExpression(wrapped) ? wrapped.body : wrapped
    return hasTopLevelAwait(body)
}

/* Emits a compile WARNING (best-effort, never fatal) when a signal read appears AFTER the
   first top-level `await` in an async seed — a value read there is no longer tracked, so the
   cell won't reseed when it changes. Detection only: reads before the await (or with no
   await) are fine. */
function warnPostAwaitReads(seed: ts.Expression, signalNames: ReadonlySet<string>): void {
    if (signalNames.size === 0) {
        return
    }
    /* Walk the seed's BODY — the arrow/function itself is the seed, not a nested scope, so
       descend into it; the guard below then skips any FURTHER nested function. */
    const body = ts.isArrowFunction(seed) || ts.isFunctionExpression(seed) ? seed.body : seed
    let awaited = false
    const flagged = new Set<string>()
    const visit = (child: ts.Node): void => {
        /* Nested functions have their own tracking; the await that matters is at the seed's
           own top level, so don't descend into them (mirrors `hasTopLevelAwait`). */
        if (
            ts.isFunctionDeclaration(child) ||
            ts.isFunctionExpression(child) ||
            ts.isArrowFunction(child)
        ) {
            return
        }
        if (ts.isAwaitExpression(child)) {
            awaited = true
            ts.forEachChild(child, visit)
            return
        }
        if (awaited && ts.isIdentifier(child) && signalNames.has(child.text)) {
            flagged.add(child.text)
        }
        ts.forEachChild(child, visit)
    }
    visit(body)
    for (const name of flagged) {
        console.warn(
            `[abide] \`${name}\` is read after an \`await\` in an async computed/linked seed — reads after the first await are not tracked, so the cell will not reseed when \`${name}\` changes. Read it before the await (capture it into a local) to keep it tracked.`,
        )
    }
}

/* Throws on the removed `prop(...)` reader — props are now read by destructuring `props()`.
   Walks all calls, so a stray one nested in a function is caught too. Bare reactive
   primitives (`state(0)`) are the SURFACE now (recognised by import binding + lowered), so
   they no longer throw — only the withdrawn `prop` reader does. */
function assertNoRemovedReaders(source: ts.SourceFile): void {
    const visit = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'prop'
        ) {
            throw new Error(
                'abide: `prop(...)` has been removed — read props by destructuring `props()`, e.g. `const { name } = props()` (with a default: `const { name = fallback } = props()`).',
            )
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
}

/*
Desugars the signal surface into the document form. A component's `<script>`
declares reactive state as signals:

  let count = scope().state(0)
  let items = scope().state([])
  const total = scope().computed(() => count() + items.length)

This walks the already-parsed script once to collect the binding names, then returns
a `ts.TransformerFactory` that rewrites the declarations onto a shared `model`
document: each plain `state(initial)` becomes an initialising assignment (`model.x =
initial`, in source order so a later state can read an earlier one), each `computed`
and destructured prop becomes a `scope().derive` slot, and `linked` /
`state(initial, transform)` stay `.value` cells routed onto the scope. Returning a
TRANSFORMER (not rebuilt source text) lets the caller (`lowerScript`) chain it with
reference renaming and doc-access lowering over ONE parsed tree — no print-then-reparse
between passes. Plain `state` becomes `model.x` access that `lowerDocAccess` lowers to
patches/reads. No reactive declarations → an identity transformer (the explicit
`const model = doc(...)` form still works).
*/
export function desugarSignals(
    source: ts.SourceFile,
    /* Synthetic `const __cN = computed(...)` cells `analyzeComponent` injected for asyncIterable
       interpolations (ADR-0019 Stage D). Their `computed` callee is UNIMPORTED, so import
       resolution (`signalCallee`) can't recognize them — instead a declaration whose name is in
       this set is treated as a bare-call computed slot: routed to an eager `trackedComputed`
       stream cell and read via `$$readCell`, exactly as an explicit `state.computed(getStream())`
       would be. Gated on the exact injected name (never a naming heuristic), so it can never
       reclassify author code — an author's own `computed(...)` still needs its import. */
    injectedCellNames: ReadonlySet<string> = new Set(),
    /* The subset of `injectedCellNames` whose seed the author wrote `await` on (ADR-0032): a
       BLOCKING peek-cell (`scope().trackedComputed(async …, false)` — an `AsyncComputed` that
       joins the SSR barrier), vs a streaming one (`trackedComputed(async …, true)` — ships
       pending, resolves on the client). Names not in this set are streaming. */
    blockingCellNames: ReadonlySet<string> = new Set(),
    /* Names the TEMPLATE writes (assigned in an event expression, or forwarded as a `bind:`
       target) — see `writtenTemplateNames`. Unioned with the script's own write scan; a `props()`
       binding whose name lands in the union is a WRITABLE prop (a `.value` cell via `bindableProp`)
       rather than a read-only derive, so a two-way `bind:prop` on the parent can flow back. */
    templateWrittenNames: ReadonlySet<string> = new Set(),
    /* Type-directed seed classifier (ADR-0023): resolves a no-marker `computed(seed)`'s
       async-ness from the seed's checker type via the warm shadow program. Absent (no warm
       program, or any call site outside the shadow-warmed path) ⇒ every seed classifies
       `undefined` ⇒ fail-open to the `isBareCallComputed` syntax heuristic — exactly today's
       routing. The `await`-marker path (`isAsyncComputed`) is decided first and never consults it. */
    seedClassify?: SeedTypeClassifier,
    /* Absolute `.abide` source offset where this script's (trimmed) body begins — the base that
       relocates a seed node's body-relative `getStart()` back to an ORIGINAL source location the
       shadow's source→shadow `mappings` resolve. Unused when `seedClassify` is absent. */
    scriptBase = 0,
): {
    transformer: ts.TransformerFactory<ts.SourceFile>
    stateNames: Set<string>
    derivedNames: Set<string>
    computedNames: Set<string>
    cellReadNames: Set<string>
    /* The full BLOCKING cell set (ADR-0042): the template-injected `await` cells passed in, unioned
       with the script-level `await` computeds/linked collected here. The client template lowering
       reads these via `$$readCellBlocking` (suspend-on-pending). */
    blockingCellNames: Set<string>
} {
    assertNoRemovedReaders(source)
    /* The full set of names written anywhere (this script + the template). A prop in this set
       is upgraded to a writable cell; a prop only read stays a cheap read-only derive. */
    const writtenNames = new Set<string>(templateWrittenNames)
    assignmentTargetNames(source, writtenNames)
    /* The file's reactive import bindings — each local (alias-safe) mapped to its
       canonical primitive. The single recognition authority: every callee below resolves
       against these import bindings and nothing else. */
    const bindings = reactiveImportBindings(source)
    const stateNames = new Set<string>()
    const derivedNames = new Set<string>()
    const computedNames = new Set<string>()
    /* Names read through `$$readCell(name)`: every `linked` (a plain `State` or, when its seed
       tracks an async source, an `AsyncState`) and every async `computed` (an `AsyncComputed`).
       One read shape covers both — `$$readCell` peeks an async cell and reads `.value` off a
       sync one — so `linked(getStream())` auto-tracks with no read-site branching. */
    const cellReadNames = new Set<string>()
    /* Script-level BLOCKING cell names (ADR-0042 D6): a `computed`/`linked` whose seed carries a
       top-level `await`. Unioned with the template-injected `blockingCellNames` and returned so the
       CLIENT template lowering reads them via `$$readCellBlocking` (suspend-on-pending). */
    const scriptBlockingNames = new Set<string>()
    /* A `props()` destructure must be lowered even when it declares no reactive binding
       (a rest-only `const { ...rest } = props()`), so track its presence on its own. */
    let hasPropsDestructure = false
    /* Resolves a computed seed's async-ness through the warm shadow classifier (ADR-0023):
       maps the seed's absolute source location to its checker-type kind. `undefined` when no
       classifier is threaded OR on any resolution failure (a throw / an unmapped seed), so the
       caller degrades to `isBareCallComputed` — never mistakes a failure for a `sync` type. */
    const seedKind = (seed: ts.Expression): InterpolationKind | undefined => {
        if (seedClassify === undefined) {
            return undefined
        }
        try {
            const start = seed.getStart(source)
            return seedClassify(scriptBase + start, source.text.slice(start, seed.getEnd()))
        } catch {
            return undefined
        }
    }
    /* The single routing authority for a no-marker `computed(seed)` — shared by the
       name-collection pass below and `computedStatements` so both land the binding in the same
       read-name bucket (a divergence would lower a reference to the wrong read form). Type-
       directed when the seed classifier resolves the seed (`asyncIterable` → the eager stream
       cell; `promise`/`sync` → the lazy `derive` slot), fail-open to today's `isBareCallComputed`
       syntax heuristic otherwise. The `await`-marker seed (`isAsyncComputed`) is decided first by
       each caller and excluded here (its wrapped thunk is async → returns false). */
    const isEagerStreamComputed: EagerStreamPredicate = (declaration) => {
        const argument = seedArgument(declaration)
        if (argument === undefined || isAsyncSeed(wrapSeed(argument))) {
            return false
        }
        const kind = seedKind(argument)
        if (kind !== undefined) {
            return kind === 'asyncIterable'
        }
        return isBareCallComputed(declaration)
    }
    /* A type-directed PROMISE seed (ADR-0023/0043): a no-`await` `state.computed(getFoo())` whose
       seed's checker type resolves to a promise. Routed to an eager STREAMING async cell that
       unwraps the resolved value and reactively re-resolves when its tracked deps change — the
       script-level twin of a bare async interpolation (ADR-0032). Only fires with a warm classifier
       ('promise'); fail-open (no program) leaves it to `isEagerStreamComputed`'s bare-call probe,
       and the `await`-marker seed is excluded (its wrapped thunk is already async). Kept separate
       from `isEagerStreamComputed` so `computedStatements` can wrap it as `async () => await (seed)`
       (a stream seed stays a bare probe thunk). */
    const isPromiseComputed: EagerStreamPredicate = (declaration) => {
        const argument = seedArgument(declaration)
        if (argument === undefined || isAsyncSeed(wrapSeed(argument))) {
            return false
        }
        return seedKind(argument) === 'promise'
    }
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) {
            continue
        }
        for (const declaration of statement.declarationList.declarations) {
            const callee = signalCallee(declaration, bindings)
            if (callee === 'props') {
                /* `const {…, ...rest} = props()` — each named binding is a read-only computed
                   over the parent thunk (read as `name()`); a `...rest` binding stays a plain
                   const (a `restProps` bag), so it joins no reactive set. */
                if (!ts.isObjectBindingPattern(declaration.name)) {
                    throw new Error(
                        'abide: `props()` must be destructured — `const { a, b } = props()`',
                    )
                }
                hasPropsDestructure = true
                for (const binding of propsDestructure(declaration).bindings) {
                    /* A prop the component writes/forwards becomes a `.value` cell (`bindableProp`,
                       read/written like `state(x, transform)` → `derivedNames`); one only read stays
                       a read-only derive read as `name()` (`computedNames`). */
                    if (writtenNames.has(binding.local)) {
                        derivedNames.add(binding.local)
                    } else {
                        computedNames.add(binding.local)
                    }
                }
                continue
            }
            if (!ts.isIdentifier(declaration.name)) {
                continue
            }
            if (injectedCellNames.has(declaration.name.text)) {
                /* Injected asyncIterable-interpolation cell (`const __cN = computed(expr)`): an
                   eager `trackedComputed` stream cell, read via `$$readCell` — recognized by its
                   injected name since `computed` is unimported here. */
                cellReadNames.add(declaration.name.text)
                continue
            }
            if (isPlainStateSlot(declaration, bindings)) {
                /* Plain `state(initial)` → a serializable `model` doc slot. */
                stateNames.add(declaration.name.text)
            } else if (isComputedSlot(declaration, bindings)) {
                /* `computed(compute)` → either a lazy `scope().derive` doc slot referenced as
                   `name()` (a sync/promise seed), or an eager cell read via `$$readCell(name)`
                   when the wrapped seed is async (an `await`-lowered / passthrough-`async` thunk)
                   or its seed type resolves to a stream (`isEagerStreamComputed`, ADR-0023). */
                if (
                    isAsyncComputed(declaration) ||
                    isEagerStreamComputed(declaration) ||
                    isPromiseComputed(declaration)
                ) {
                    cellReadNames.add(declaration.name.text)
                    /* A blocking async computed (author `await`) reads suspend-on-pending; a bare
                       promise (isPromiseComputed) carries no `await` → streaming, so isBlockingSeed
                       is false and it never joins this set. */
                    const argument = seedArgument(declaration)
                    if (argument !== undefined && isBlockingSeed(argument)) {
                        scriptBlockingNames.add(declaration.name.text)
                    }
                } else {
                    computedNames.add(declaration.name.text)
                }
            } else if (callee === 'linked') {
                /* `linked` → a cell read via `$$readCell(name)`: a plain `State` when the seed
                   is synchronous, an `AsyncState` when it tracks a promise/stream — one read
                   shape auto-tracks whichever source the runtime primitive resolved to. */
                cellReadNames.add(declaration.name.text)
                /* A blocking async linked (author `await`) reads suspend-on-pending, like computed. */
                const argument = seedArgument(declaration)
                if (argument !== undefined && isBlockingSeed(argument)) {
                    scriptBlockingNames.add(declaration.name.text)
                }
            } else if (callee === 'state') {
                /* `state(initial, transform)` → a `.value` cell (its write-coercion transform
                   forces a local store); referenced as `name.value`, unchanged. */
                derivedNames.add(declaration.name.text)
            }
        }
    }

    const hasReactive =
        stateNames.size > 0 ||
        derivedNames.size > 0 ||
        computedNames.size > 0 ||
        cellReadNames.size > 0 ||
        hasPropsDestructure

    const transformer: ts.TransformerFactory<ts.SourceFile> = () => (root) => {
        if (!hasReactive) {
            return root
        }
        const statements: ts.Statement[] = []
        /* A shared `$$model = scope()` host for the state slots, prepended once. The doc
           base is `$$`-reserved so a user variable named `model` can never collide. */
        if (stateNames.size > 0) {
            statements.push(
                constDeclaration(
                    '$$model',
                    factory.createCallExpression(factory.createIdentifier('scope'), undefined, []),
                ),
            )
        }
        /* Every component signal name — the read set the post-`await` tracking lint checks
           an async seed's body against. */
        const signalNames = new Set<string>([
            ...stateNames,
            ...derivedNames,
            ...computedNames,
            ...cellReadNames,
        ])
        for (const statement of root.statements) {
            statements.push(
                ...loweredStatement(
                    statement,
                    bindings,
                    signalNames,
                    injectedCellNames,
                    blockingCellNames,
                    writtenNames,
                    isEagerStreamComputed,
                    isPromiseComputed,
                ),
            )
        }
        return factory.updateSourceFile(root, statements)
    }

    return {
        transformer,
        stateNames,
        derivedNames,
        computedNames,
        cellReadNames,
        blockingCellNames: new Set([...blockingCellNames, ...scriptBlockingNames]),
    }
}

/* The lowered form of a top-level statement: state slots → `model.x = init`
   assignments, computed → `scope().derive` consts, props → derive consts (+ restProps),
   cells → `scope().<callee>(...)` consts; anything else passes through verbatim. The
   per-statement dispatch mirrors the name-collection pass. */
function loweredStatement(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
    signalNames: ReadonlySet<string>,
    injectedCellNames: ReadonlySet<string>,
    blockingCellNames: ReadonlySet<string>,
    writtenNames: ReadonlySet<string>,
    isEagerStreamComputed: EagerStreamPredicate,
    isPromiseComputed: EagerStreamPredicate,
): ts.Statement[] {
    rejectMixedDeclaration(statement, bindings)
    return (
        injectedComputedStatements(statement, injectedCellNames, blockingCellNames) ??
        stateAssignmentStatements(statement, bindings) ??
        computedStatements(
            statement,
            bindings,
            signalNames,
            isEagerStreamComputed,
            isPromiseComputed,
        ) ??
        propsStatements(statement, bindings, writtenNames) ??
        cellStatements(statement, bindings, signalNames) ?? [statement]
    )
}

/* Lowers a synthetic `const __vN = computed(<seed>)` (an async (sub)expression peek-cell
   `analyzeComponent` injected, ADR-0032) to a `scope().trackedComputed(...)` cell read via
   `$$readCell`. Two shapes, by the seed:
     - a PROMISE seed (`computed(await X)` → an async `() => await X` thunk) → `trackedComputed(
       thunk, <streaming>)`, where `streaming = !blockingCellNames.has(name)`: a blocking cell
       (author `await`) joins the SSR barrier and resolves inline; a streaming one ships pending.
     - an `AsyncIterable` seed (`computed(getStream())` → a bare `() => getStream()` thunk) →
       `trackedComputed(thunk)`, byte-identical to an explicit `state.computed(getStream())`.
   Recognized by the injected name (`computed` is unimported here); returns undefined for any
   statement that is not one of these injected cells (each is its own single-declaration statement). */
function injectedComputedStatements(
    statement: ts.Statement,
    injectedCellNames: ReadonlySet<string>,
    blockingCellNames: ReadonlySet<string>,
): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !injectedCellNames.has(declaration.name.text)) {
            return undefined
        }
        const name = declaration.name.text
        const argument = seedArgument(declaration)
        const wrapped =
            argument === undefined
                ? factory.createArrowFunction(
                      undefined,
                      undefined,
                      [],
                      undefined,
                      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      factory.createIdentifier('undefined'),
                  )
                : wrapSeed(argument)
        /* A promise seed (async thunk) unwraps to the resolved value and carries the SSR tier flag;
           a stream seed (bare thunk) probes to a frame cell and needs no flag (a stream never joins
           the barrier), so it stays a single-arg call to byte-match the explicit form. */
        const args = isAsyncSeed(wrapped)
            ? [wrapped, blockingCellNames.has(name) ? factory.createFalse() : factory.createTrue()]
            : [wrapped]
        statements.push(constDeclaration(name, scopeMethodCall('trackedComputed', args)))
    }
    return statements
}

/* Each lowering function above is all-or-nothing per VariableStatement: it returns
   undefined the moment one declaration doesn't match its kind, so the whole statement
   passes through verbatim. A statement mixing a reactive declaration with a differently-
   lowered one (`let count = state(0), step = 5`) therefore ships literal — but the
   collection pass already registered `count`, so references lower to `$$model.read("count")`
   with no `$$model.count = 0` seed (silent undefined). Reject it with a legible error so
   the author splits the declarations; a checker-free compiler must fail loud, not
   mis-lower silently. Same-kind lists (`let a = state(0), b = state(1)`) are fine. */
function rejectMixedDeclaration(statement: ts.Statement, bindings: ReactiveImportBindings): void {
    if (!ts.isVariableStatement(statement)) {
        return
    }
    const kinds = new Set(
        statement.declarationList.declarations.map((declaration) =>
            loweringKind(declaration, bindings),
        ),
    )
    /* Any two distinct kinds break: each lowering function bails on the non-matching
       declaration, so the statement ships verbatim. A uniform list (size 1) is fine. */
    if (kinds.size > 1) {
        throw new Error(
            'abide: declare each reactive signal in its own statement — a `let`/`const` that mixes a reactive declaration (state/linked/computed/props) with another kind cannot be lowered as one statement.',
        )
    }
}

/* The lowering bucket a single declaration falls into — mirrors the name-collection
   dispatch so `rejectMixedDeclaration` can detect a statement spanning more than one. */
function loweringKind(
    declaration: ts.VariableDeclaration,
    bindings: ReactiveImportBindings,
): 'state' | 'computed' | 'props' | 'cell' | 'plain' {
    const callee = signalCallee(declaration, bindings)
    if (callee === 'props') {
        return 'props'
    }
    if (isPlainStateSlot(declaration, bindings)) {
        return 'state'
    }
    if (isComputedSlot(declaration, bindings)) {
        return 'computed'
    }
    if (callee === 'linked' || callee === 'state') {
        return 'cell'
    }
    return 'plain'
}

/* `const NAME = <init>` — a fresh const declaration reusing the original initializer node. */
function constDeclaration(name: string, initializer: ts.Expression): ts.VariableStatement {
    return factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
            [factory.createVariableDeclaration(name, undefined, undefined, initializer)],
            ts.NodeFlags.Const,
        ),
    )
}

/* `scope().<method>(...args)` — the reactive method routed onto the ambient scope. */
function scopeMethodCall(method: string, args: readonly ts.Expression[]): ts.CallExpression {
    return factory.createCallExpression(
        factory.createPropertyAccessExpression(
            factory.createCallExpression(factory.createIdentifier('scope'), undefined, []),
            method,
        ),
        undefined,
        args,
    )
}

/* True for a read-only computed slot — `computed(compute)` with no write-through
   `set`. The writable `computed(compute, set)` lens keeps a `.value` cell (handled by
   the caller). */
function isComputedSlot(
    declaration: ts.VariableDeclaration,
    bindings: ReactiveImportBindings,
): boolean {
    const initializer = declaration.initializer
    return (
        signalCallee(declaration, bindings) === 'computed' &&
        initializer !== undefined &&
        ts.isCallExpression(initializer) &&
        initializer.arguments.length === 1
    )
}

/* A `.value`-cell signal declaration — a `linked` or a `state(initial, transform)` —
   routed onto the scope: `linked(seed)` → `const x = scope().linked(seed)`. The cell
   stays a standalone non-serializing cell (its refs stay `name.value`); the rewrite only
   removes the bare runtime import so the sole reactive surface is `scope()`. */
function cellStatements(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
    signalNames: ReadonlySet<string>,
): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        const callee = signalCallee(declaration, bindings)
        if (
            !ts.isIdentifier(declaration.name) ||
            (callee !== 'linked' && callee !== 'state') ||
            isPlainStateSlot(declaration, bindings)
        ) {
            return undefined
        }
        const args = (declaration.initializer as ts.CallExpression).arguments
        /* `linked` wraps its seed argument (a bare value/`await`/stream expression becomes a
           thunk, a literal `() => …` passes through) so the runtime primitive can route it to
           an async cell; `state` is a value-taker — its args pass verbatim, never wrapped. */
        if (callee === 'linked' && args[0] !== undefined) {
            const wrapped = wrapSeed(args[0])
            if (isAsyncSeed(wrapped)) {
                warnPostAwaitReads(wrapped, signalNames)
            }
            statements.push(
                constDeclaration(
                    declaration.name.text,
                    scopeMethodCall('linked', [wrapped, ...args.slice(1)]),
                ),
            )
        } else {
            statements.push(constDeclaration(declaration.name.text, scopeMethodCall(callee, args)))
        }
    }
    return statements
}

/* `let total = computed(compute)` → `const total = scope().derive("total", compute)`
   — a computed doc slot whose reader the references lower to `total()`. */
function computedStatements(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
    signalNames: ReadonlySet<string>,
    isEagerStreamComputed: EagerStreamPredicate,
    isPromiseComputed: EagerStreamPredicate,
): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (
            !ts.isIdentifier(declaration.name) ||
            signalCallee(declaration, bindings) !== 'computed' ||
            !isComputedSlot(declaration, bindings)
        ) {
            return undefined
        }
        const name = declaration.name.text
        const argument = seedArgument(declaration)
        /* The seed thunk: a wrapped argument (bare expr / `await` / literal thunk), or an arg-
           less `computed()` degenerating to `() => undefined`. */
        const wrapped =
            argument === undefined
                ? factory.createArrowFunction(
                      undefined,
                      undefined,
                      [],
                      undefined,
                      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      factory.createIdentifier('undefined'),
                  )
                : wrapSeed(argument)
        if (isAsyncSeed(wrapped)) {
            /* Async seed → the eager async cell (`AsyncComputed`, read via `$$readCell`), the
               runtime unwraps the promise. `await` in the thunk body → BLOCKING (joins the SSR
               barrier, resolves inline, client suspends its render region); async modifier with NO
               await → STREAMING (ships pending, resolves on the client) — ADR-0042 D6. Routed
               through `trackedComputed(thunk, streaming)` (same createAsyncCell for an async thunk)
               to carry the flag, matching the template-injected path. */
            warnPostAwaitReads(wrapped, signalNames)
            const streaming = argument === undefined || !isBlockingSeed(argument)
            statements.push(
                constDeclaration(
                    name,
                    scopeMethodCall('trackedComputed', [
                        wrapped,
                        streaming ? factory.createTrue() : factory.createFalse(),
                    ]),
                ),
            )
        } else if (argument !== undefined && isPromiseComputed(declaration)) {
            /* Type-directed PROMISE seed (ADR-0023/0043): a bare `state.computed(getFoo())` whose
               seed resolves to a promise. Wrap it as `async () => await (seed)` so createAsyncCell
               unwraps the resolved value — a plain `() => getFoo()` thunk would fall to
               trackedComputed's lazy opaque path (its probe self-identifies only a stream). Passed
               `streaming: true` (the `true` arg): no author `await` → it does NOT join the SSR
               blocking barrier — the shell ships pending and the client resolves + reactively
               re-resolves, the ADR-0032 no-await tier. `await getFoo()` stays the BLOCKING form. */
            statements.push(
                constDeclaration(
                    name,
                    scopeMethodCall('trackedComputed', [
                        wrapAwaitSeed(argument),
                        factory.createTrue(),
                    ]),
                ),
            )
        } else if (isEagerStreamComputed(declaration)) {
            /* Stream seed → the eager `trackedComputed`, which probes the seed and auto-tracks a
               stream (`AsyncComputed`) or falls back to a lazy computed; read via `$$readCell`.
               Reached when the seed type resolves to `asyncIterable` (ADR-0023) or, fail-open with
               no warm program, when it is a bare call/identifier (`isBareCallComputed`). */
            statements.push(constDeclaration(name, scopeMethodCall('trackedComputed', [wrapped])))
        } else {
            /* Sync arithmetic/member/literal seed → the lazy `derive` doc slot, read as `name()`. */
            statements.push(
                constDeclaration(
                    name,
                    scopeMethodCall('derive', [factory.createStringLiteral(name), wrapped]),
                ),
            )
        }
    }
    return statements
}

/* True for `state(initial, transform)` — the write-coercion transform forces a
   `.value` cell (writes run it) rather than a bare, serializable doc slot. */
function hasTransform(declaration: ts.VariableDeclaration): boolean {
    const initializer = declaration.initializer
    return (
        initializer !== undefined &&
        ts.isCallExpression(initializer) &&
        initializer.arguments.length >= 2
    )
}

/* A plain `state(initial)` with no transform → a serializable `model` doc slot;
   every other reactive declaration is a `.value` cell. The one rule shared by the
   name-collection pass and the slot lowering. */
function isPlainStateSlot(
    declaration: ts.VariableDeclaration,
    bindings: ReactiveImportBindings,
): boolean {
    return signalCallee(declaration, bindings) === 'state' && !hasTransform(declaration)
}

/* One destructured prop: the local binding name, the parent prop key it reads, and
   the optional `= default` expression (the fallback when the prop is absent). */
type PropsBinding = { local: string; key: string; initializer: ts.Expression | undefined }

/* The destructure of a `const {…, ...rest} = props()` pattern — its named bindings
   plus an optional rest binding (the unconsumed props, gathered by `restProps`).
   Nested destructuring has no single prop key, so it throws a legible compile error. */
function propsDestructure(declaration: ts.VariableDeclaration): {
    bindings: PropsBinding[]
    rest: string | undefined
} {
    const pattern = declaration.name as ts.ObjectBindingPattern
    const bindings: PropsBinding[] = []
    let rest: string | undefined
    for (const element of pattern.elements) {
        if (element.dotDotDotToken !== undefined) {
            if (!ts.isIdentifier(element.name)) {
                throw new Error('abide: `...rest` in `props()` must bind a plain name')
            }
            rest = element.name.text
            continue
        }
        if (!ts.isIdentifier(element.name)) {
            throw new Error('abide: nested destructuring in `props()` is not supported')
        }
        bindings.push({
            local: element.name.text,
            key: propsBindingKey(element),
            initializer: element.initializer,
        })
    }
    return { bindings, rest }
}

/* The parent prop key a binding element reads — its rename source (`name: alias` →
   `name`) or, absent a rename, the local name itself. */
function propsBindingKey(element: ts.BindingElement): string {
    const propertyName = element.propertyName
    if (propertyName === undefined) {
        return (element.name as ts.Identifier).text
    }
    if (
        ts.isIdentifier(propertyName) ||
        ts.isStringLiteralLike(propertyName) ||
        ts.isNumericLiteral(propertyName)
    ) {
        return propertyName.text
    }
    throw new Error('abide: computed prop keys in `props()` destructuring are not supported')
}

/* If `statement` is a `const {…, ...rest} = props()` destructure, returns one binding per
   named prop — plus a `const rest = restProps($props, [consumed])` for a rest binding;
   otherwise undefined. A prop the component only READS is a read-only reactive computed
   (`scope().derive("name", () => $props["key"]?.() ?? default)`, read as `name()`). A prop
   it WRITES or forwards (in `writtenNames`) is a writable `.value` cell instead
   (`$$bindableProp($props, "key", () => default)`, read/written as `name.value`), so a
   two-way `bind:prop` on the parent flows back. The `?? default` / `fallback` thunk applies
   the binding's `= default` when the prop is absent. */
function propsStatements(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
    writtenNames: ReadonlySet<string>,
): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (
            signalCallee(declaration, bindings) !== 'props' ||
            !ts.isObjectBindingPattern(declaration.name)
        ) {
            return undefined
        }
        const { bindings: propBindings, rest } = propsDestructure(declaration)
        for (const { local, key, initializer } of propBindings) {
            /* A written/forwarded prop → `$$bindableProp($props, "key", () => default)`. */
            if (writtenNames.has(local)) {
                const args: ts.Expression[] = [
                    factory.createIdentifier('$props'),
                    factory.createStringLiteral(key),
                ]
                if (initializer !== undefined) {
                    args.push(
                        factory.createArrowFunction(
                            undefined,
                            undefined,
                            [],
                            undefined,
                            factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                            factory.createParenthesizedExpression(initializer),
                        ),
                    )
                }
                statements.push(
                    constDeclaration(
                        local,
                        factory.createCallExpression(
                            factory.createIdentifier('$$bindableProp'),
                            undefined,
                            args,
                        ),
                    ),
                )
                continue
            }
            /* `$props["key"]?.()` — the parent thunk, optionally called. */
            const read = factory.createCallChain(
                factory.createElementAccessExpression(
                    factory.createIdentifier('$props'),
                    factory.createStringLiteral(key),
                ),
                factory.createToken(ts.SyntaxKind.QuestionDotToken),
                undefined,
                [],
            )
            /* `?? default` only when the binding declared a `= default` fallback. */
            const body =
                initializer === undefined
                    ? read
                    : factory.createBinaryExpression(
                          read,
                          factory.createToken(ts.SyntaxKind.QuestionQuestionToken),
                          factory.createParenthesizedExpression(initializer),
                      )
            const thunk = factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                body,
            )
            statements.push(
                constDeclaration(
                    local,
                    scopeMethodCall('derive', [factory.createStringLiteral(local), thunk]),
                ),
            )
        }
        /* The rest bag gathers every prop not named above (and not `children`). */
        if (rest !== undefined) {
            const consumed = propBindings.map((binding) => factory.createStringLiteral(binding.key))
            statements.push(
                constDeclaration(
                    rest,
                    factory.createCallExpression(
                        factory.createIdentifier('$$restProps'),
                        undefined,
                        [
                            factory.createIdentifier('$props'),
                            factory.createArrayLiteralExpression(consumed),
                        ],
                    ),
                ),
            )
        }
    }
    return statements
}

/* If `statement` declares `state(...)` bindings, returns `model.<name> = <init>`
   assignment statements (one per declaration); otherwise undefined. */
function stateAssignmentStatements(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !isPlainStateSlot(declaration, bindings)) {
            /* Only a plain `state(initial)` becomes a slot; `state(initial, transform)`
               (and everything else) is a `.value` cell — pass it through so the
               runtime call (and its transform) survives. */
            return undefined
        }
        const initial =
            (declaration.initializer as ts.CallExpression).arguments[0] ??
            factory.createIdentifier('undefined')
        statements.push(
            factory.createExpressionStatement(
                factory.createAssignment(
                    factory.createPropertyAccessExpression(
                        factory.createIdentifier('$$model'),
                        declaration.name.text,
                    ),
                    initial,
                ),
            ),
        )
    }
    return statements
}
