import ts from 'typescript'
import { docAccessTransformer } from './lowerDocAccess.ts'
import { nestedBindingNames } from './prepareNestedScript.ts'
import { signalRefsTransformer } from './renameSignalRefs.ts'
import { TS_PRINTER } from './TS_PRINTER.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import { unwrapParens } from './unwrapParens.ts'

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
) {
    /* Branch-scoped signal bindings (from nested `<script>`s, and the block value params
       pushed by `withLocalDerived`) — they deref to `.value` like a `computed`, and as a
       nearer lexical scope they SHADOW a same-named component signal. Pushed while a
       branch's script + markup compile, popped after, so they shadow only within that
       subtree. */
    const localDerived = new Set<string>()

    /* Branch-scoped PLAIN bindings — a block value param SSR binds as a real JS local
       holding the plain resolved value (not a cell). Shadows a same-named component signal
       like `localDerived`, but derefs as the bare identifier, not `.value` (see
       `withLocalPlain`). Pushed only by the SSR back-end; the client uses `localDerived`. */
    const localPlain = new Set<string>()

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
                new Set(localDerived),
                new Set(localPlain),
            ),
            docAccessTransformer('model'),
        ])
        const output = TS_PRINTER.printFile(result.transformed[0] as ts.SourceFile).trim()
        result.dispose()
        return output
    }

    /* Lowers a single expression (no trailing `;`). Wrapped in parens so a bare object
       literal (`{ a: 1 }`) parses as an expression, not a block of labeled statements,
       through the rewrite; the wrapper is then peeled back off. */
    function expression(code: string): string {
        return unwrapParens(lowerOnce(`(${code})`).replace(/;$/, ''))
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
        return statement(`${code} = ${valueExpr}`)
    }

    /* Pushes the names not already in `scope` for the duration of `body`, then pops
       exactly what it added — the shared push/run/pop the deref-scope helpers below use,
       over whichever Set (`localDerived` / `localPlain`) a binding shadows through. */
    function withScoped<T>(scope: Set<string>, names: Iterable<string>, body: () => T): T {
        const added: string[] = []
        for (const name of names) {
            if (!scope.has(name)) {
                scope.add(name)
                added.push(name)
            }
        }
        const result = body()
        for (const name of added) {
            scope.delete(name)
        }
        return result
    }

    /* Adds any `<script>` children's binding names to the deref scope (so the script
       bodies and the branch's markup auto-deref them) for the duration of `body`. */
    function withNestedScripts<T>(children: TemplateNode[], body: () => T): T {
        const names = children.flatMap((child) =>
            child.kind === 'script' ? [...nestedBindingNames(child.code)] : [],
        )
        return withScoped(localDerived, names, body)
    }

    /* Pushes explicit names into the deref scope for `body` then pops them — the
       programmatic counterpart to `withNestedScripts`, used to bind a block's value param
       (an `await` `then` value, a keyed `each` item) as a reactive `.value` cell so the
       branch reads it reactively and re-runs in place when the block sets the cell. */
    function withLocalDerived<T>(names: string[], body: () => T): T {
        return withScoped(localDerived, names, body)
    }

    /* Like `withLocalDerived` but for a binding SSR holds as a plain JS value (an `await`
       `then` value awaited inline) rather than a reactive cell. Pushes the names so they
       shadow a same-named component signal AND deref as the bare identifier (not `.value`),
       since the emitted SSR code reads the local directly. */
    function withLocalPlain<T>(names: string[], body: () => T): T {
        return withScoped(localPlain, names, body)
    }

    return {
        expression,
        statement,
        withNestedScripts,
        withLocalDerived,
        withLocalPlain,
        bindRead,
        bindWrite,
    }
}
