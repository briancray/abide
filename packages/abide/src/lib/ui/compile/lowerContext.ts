import ts from 'typescript'
import { createShadowScope } from './createShadowScope.ts'
import { docAccessTransformer } from './lowerDocAccess.ts'
import { nestedBindingNames, nestedPlainLocalNames } from './prepareNestedScript.ts'
import { signalRefsTransformer } from './renameSignalRefs.ts'
import { TS_PRINTER } from './TS_PRINTER.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import { unwrapParens } from './unwrapParens.ts'

/* Compiled once — strips the trailing `;` off every lowered expression. */
const TRAILING_SEMICOLON = /;$/

/*
The shared expression-lowering context both back-ends build on: the signal→`model`
rewrite and doc-access lowering that turns the signal surface the author writes
(`count` → `model.count` → patch/read) into the doc API, plus the branch-scoped
nested-`<script>` deref scope. Identical on both sides by design — server and
client must lower an expression the same way or their markup diverges and
hydration breaks — so it lives in one place: a new sugar token or a paren/scope
fix lands here once instead of in lockstep across `generateBuild`/`generateSSR`.
SSR's effect-stripping stays a caller-side wrap (`stripEffects`), the one real
asymmetry; the node-walk skeletons stay in each back-end.
*/
export function lowerContext(
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    computedNames: ReadonlySet<string> = new Set(),
    /* `linked` / async `computed` names, read through `$$readCell(name)`. */
    cellReadNames: ReadonlySet<string> = new Set(),
    /* The subset that are BLOCKING `await` cells (ADR-0042), read through `$$readCellBlocking(name)`
       (suspend-on-pending). Passed only by the CLIENT back-end; SSR leaves it empty. */
    blockingCellNames: ReadonlySet<string> = new Set(),
) {
    /* The typed branch-local shadow stack: one auto-popping value owning both kinds.
       `derived` names deref to `.value` like a `computed` (block value params the client
       binds as a reactive cell, and nested-`<script>` bindings); `plain` names deref as
       the bare identifier (block value params SSR binds as a real JS local). Both, as a
       nearer lexical scope, SHADOW a same-named component signal. `withShadow` pushes on
       entry and pops in a `finally`, so a branch's shadows cannot outlive the branch even
       if its body throws — the leak the old hand-written pop allowed. */
    const scope = createShadowScope()

    /* Parse `code` once and chain the reference rename and doc-access lowering over the
       one tree — the two string passes would each parse + reprint. `localDerived` is
       snapshotted per call (as the transformer's block-local shadow set) so a binding
       pushed mid-compile is honoured AND shadows a same-named component signal. */
    function lowerOnce(code: string): string {
        const source = ts.createSourceFile('expr.ts', code, ts.ScriptTarget.Latest, true)
        const result = ts.transform(source, [
            signalRefsTransformer(
                stateNames,
                derivedNames,
                computedNames,
                new Set(scope.names('derived')),
                new Set(scope.names('plain')),
                cellReadNames,
                blockingCellNames,
            ),
            docAccessTransformer('$$model'),
        ])
        const output = TS_PRINTER.printFile(result.transformed[0] as ts.SourceFile).trim()
        result.dispose()
        return output
    }

    /* Lowers a single expression (no trailing `;`). Wrapped in parens so a bare object
       literal (`{ a: 1 }`) parses as an expression, not a block of labeled statements,
       through the rewrite; the wrapper is then peeled back off. */
    function expression(code: string): string {
        return unwrapParens(lowerOnce(`(${code})`).replace(TRAILING_SEMICOLON, ''))
    }

    /* As above but keeps the trailing `;` for a statement/handler body. */
    function statement(code: string): string {
        return lowerOnce(code)
    }

    /* A two-way bind target is either an LVALUE (`count`, `model.lines[i]`) — reads as
       itself, writes by assignment — or an ACCESSOR object from `bind:value={{ get, set }}`
       — reads via `.get()`, writes via `.set(v)`. The accessor is the only way to bind a
       value whose write goes somewhere other than the read target (the replacement for the
       old writable `computed(compute, set)` lens). A read-only `computed` is NOT an lvalue,
       so binding one bare is a compile error pointing at the accessor form. */
    const isAccessorBind = (code: string): boolean => code.trim().startsWith('{')

    function guardWritableBind(code: string): void {
        const name = code.trim()
        if (computedNames.has(name)) {
            throw new Error(
                `bind: \`${name}\` is a read-only computed — bind a writable target, or an accessor: bind:value={{ get: () => ${name}, set: (next) => { /* write the source */ } }}`,
            )
        }
    }

    /* The expression a two-way bind reads its current value from. */
    function bindRead(code: string): string {
        if (isAccessorBind(code)) {
            return `(${expression(code)}).get()`
        }
        guardWritableBind(code)
        return expression(code)
    }

    /* The statement a two-way bind runs to write `valueExpr` (a raw runtime expression,
       e.g. `el.value`) back into its target. */
    function bindWrite(code: string, valueExpr: string): string {
        if (isAccessorBind(code)) {
            return `(${expression(code)}).set(${valueExpr});`
        }
        guardWritableBind(code)
        /* A `linked` cell (a writable `State`) is read through `$$readCell`, but that call is
           not an lvalue — the WRITE goes straight to the cell's `.value` setter (`NAME.value =
           …`). The name is a real local holding the cell, so it needs no reference lowering. */
        const name = code.trim()
        if (cellReadNames.has(name)) {
            return `${name}.value = ${valueExpr};`
        }
        return statement(`${code} = ${valueExpr}`)
    }

    /* Adds any `<script>` children's binding names to the deref scope (so the script
       bodies and the branch's markup auto-deref them) for the duration of `body`. Reactive
       bindings register as `derived` `.value` cells; the script's PLAIN top-level locals
       register as `plain` bare locals so a local that shares a name with a component signal
       shadows it (else the reference lowers to `$$model.read(...)`, ignoring the local). */
    function withNestedScripts<T>(children: TemplateNode[], body: () => T): T {
        const derived = children.flatMap((child) =>
            child.kind === 'script' ? [...nestedBindingNames(child.code)] : [],
        )
        const plain = children.flatMap((child) =>
            child.kind === 'script' ? [...nestedPlainLocalNames(child.code)] : [],
        )
        return scope.withShadow(derived, 'derived', () => scope.withShadow(plain, 'plain', body))
    }

    return {
        expression,
        statement,
        withNestedScripts,
        /* The raw branch-local shadow registration both back-ends drive `withBindings`
           through: a block's bindings flow to a `ShadowKind` only via that one shared loop,
           never through a per-block `scope.withShadow` call here. */
        withShadow: scope.withShadow,
        bindRead,
        bindWrite,
    }
}
