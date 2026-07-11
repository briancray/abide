import { reviveWireField } from './reviveWireField.ts'
import type { OutputWirePlan } from './types/OutputWirePlan.ts'

/*
The type-directed wire DECODE step for a rpc success response (ADR-0029 output path) — the
response-side sibling of parseArgs' input revival. The server encoded a handler's structured
return into honest JSON (`wireJsonReplacer`): a `Set` → array, a `Map` → `[K,V]` entries, a
`bigint` → digit string, a `Date` → ISO string. A wire array is ambiguous (a real `T[]` vs an
encoded `Set<T>`), so the abide client revives from the DECLARED kind the warm server program baked
onto the stub (`OutputWirePlan`), applied to a DECODED response body here. Only the fields named in
the plan are touched; a genuine array / scalar the plan omits is left as-is.

Mutates the decoded body in place — the value is call-private (a fresh JSON.parse result or a
freshly cloned warm value), never shared. Fail-open at every branch: no plan, a non-object body, or
an unrevivable field value keeps the honest-JSON form so a type/runtime mismatch degrades visibly
rather than throwing. Top-level fields only; a structured value nested deeper is not descended into
(deferred, ADR-0029).
*/
export function reviveWireOutput(value: unknown, plan: OutputWirePlan | undefined): unknown {
    if (plan === undefined) {
        return value
    }
    /* Only a plain object carries the named fields; a top-level array/scalar/null has none. */
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return value
    }
    const record = value as Record<string, unknown>
    for (const key in plan) {
        const fieldPlan = plan[key]
        if (fieldPlan === undefined || !(key in record)) {
            continue
        }
        record[key] = reviveWireField(record[key], fieldPlan)
    }
    return value
}
