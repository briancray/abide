import { putOwn } from '../putOwn.ts'

/**
 * The entry key for an `Args` value: its canonical wire form, as a string.
 *
 * RULEBOOK 11.24: members sorted by name, `undefined` members dropped, `Date` written ISO.
 *
 * 11.26: the key is taken BEFORE any gate runs, because a browser holds no copy of the gate — a
 * key taken after normalising is computed one way on a server and another in a browser, and every
 * handler with a normalising schema would miss its seed buffer and re-issue the call on hydration.
 *
 * 11.65: WHAT THE WIRE FORM CANNOT WRITE IS REFUSED AT THE REACH. `JSON.stringify` does not fail
 * on any of it — a `Set`, a `Map` and a class instance each have no own enumerable keys and
 * canonicalise to `{}`, and a non-finite number is written `null` — so two different reaches
 * produced one key and 1.8 joined the second to the first's standing work. The value was right
 * for the first caller and wrong for every other one, with nothing to see.
 */
export function canonicalKey(args: unknown): string {
    if (args === undefined) return ''
    return JSON.stringify(canonical(args, []))
}

// THE PATH IS A STACK OF STEPS, joined only when a refusal names it. Built as a string per member
// it was a concatenation for every element and every nested key on every reach, for a message the
// success path never reads.
type Steps = (string | number)[]

function canonical(value: unknown, path: Steps): unknown {
    if (value === null) return value
    const kind = typeof value
    if (kind === 'number') {
        if (!Number.isFinite(value)) throw outside(String(value), path)
        return value
    }
    if (kind !== 'object') {
        if (kind === 'boolean' || kind === 'string') return value
        // `undefined` reaches here from an ARRAY element alone — a member is dropped above.
        throw outside(kind === 'undefined' ? 'undefined' : `a ${kind}`, path)
    }
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) {
        const out: unknown[] = []
        for (let index = 0; index < value.length; index += 1) {
            path.push(index)
            out.push(canonical(value[index], path))
            path.pop()
        }
        return out
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
        throw outside(named(value as object), path)
    const source = value as Record<string, unknown>
    const keys = Object.keys(source).sort()
    // AN ORDINARY OBJECT, AND `putOwn` FOR THE ONE KEY THAT NEEDS IT: `__proto__` is a SETTER on
    // `Object.prototype`, so `out[key] = …` for that key creates no own property and
    // `JSON.stringify` never sees it — `{id: 1, __proto__: {role: 'admin'}}` and `{id: 1}` then
    // canonicalise to one string, and 1.8 joins the second reach to the first's standing work.
    // `Object.create(null)` closed that too, and V8 builds it in DICTIONARY mode: the shipped key
    // took 49-56% of the time without it there, and a standing keyed reach 53%, where JSC reads
    // level to 110% (`harness/scripts/sharedCases.ts`, two runs per engine).
    const out: Record<string, unknown> = {}
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index] as string
        const member = source[key]
        if (member === undefined) continue
        path.push(key)
        putOwn(out, key, canonical(member, path))
        path.pop()
    }
    return out
}

function named(value: object): string {
    const from = value.constructor as { name?: unknown } | undefined
    return typeof from?.name === 'string' && from.name !== ''
        ? `a ${from.name}`
        : 'a class instance'
}

function outside(what: string, steps: Steps): Error {
    let path = ''
    for (const step of steps)
        path +=
            typeof step === 'number'
                ? `[${step}]`
                : path === ''
                  ? step
                  : `.${step}`
    return new Error(
        `An Args key cannot carry ${what} at ${
            path === '' ? 'the arguments themselves' : `"${path}"`
        }: the canonical wire form writes it as another entry's key (RULEBOOK 11.65).`,
    )
}
