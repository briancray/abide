import { lowerDocAccess } from './lowerDocAccess.ts'
import { nestedBindingNames } from './prepareNestedScript.ts'
import { renameSignalRefs } from './renameSignalRefs.ts'
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
    /* Branch-scoped signal bindings (from nested `<script>`s) — they deref to
       `.value` like a `computed`. Pushed while a branch's script + markup compile,
       popped after, so they shadow only within that subtree. */
    const localDerived = new Set<string>()
    const derefScope = (): ReadonlySet<string> =>
        localDerived.size === 0 ? derivedNames : new Set([...derivedNames, ...localDerived])

    /* Rewrites signal refs, then lowers a single expression (no trailing `;`).
       Wrapped in parens so a bare object literal (`{ a: 1 }`) parses as an
       expression, not a block of labeled statements, through both rewrite passes;
       the wrapper is then peeled back off. */
    function expression(code: string): string {
        const renamed = renameSignalRefs(`(${code})`, stateNames, derefScope(), computedNames)
        return unwrapParens(lowerDocAccess(renamed, 'model').trim().replace(/;$/, ''))
    }

    /* As above but keeps the trailing `;` for a statement/handler body. */
    function statement(code: string): string {
        const renamed = renameSignalRefs(code, stateNames, derefScope(), computedNames)
        return lowerDocAccess(renamed, 'model').trim()
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

    /* Adds any `<script>` children's binding names to the deref scope (so the script
       bodies and the branch's markup auto-deref them), runs `body` within that scope,
       then pops the names it added. Returns whatever `body` produces. */
    function withNestedScripts<T>(children: TemplateNode[], body: () => T): T {
        const added: string[] = []
        for (const child of children) {
            if (child.kind === 'script') {
                for (const name of nestedBindingNames(child.code)) {
                    if (!localDerived.has(name)) {
                        localDerived.add(name)
                        added.push(name)
                    }
                }
            }
        }
        const result = body()
        for (const name of added) {
            localDerived.delete(name)
        }
        return result
    }

    return { expression, statement, withNestedScripts, bindRead, bindWrite }
}
