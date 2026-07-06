/*
Inverse of encodeRefJson — rebuild a value graph (cycles, shared references, and the
JSON-hostile types) from a `[rootValue, slots]` ref-json string. Two passes are
required: pass one allocates every hoisted container as an empty shell, pass two fills
them. The shell must exist before its contents are filled so a back-reference to an
ancestor resolves to the already-allocated object — which is what reconnects a cycle.
Inline primitives need no shell; they decode directly where they sit.
*/
import { REF_JSON_TAGS } from './REF_JSON_TAGS.ts'

export function decodeRefJson(text: string): unknown {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed) || parsed.length !== 2 || !Array.isArray(parsed[1])) {
        // encodeRefJson always emits a `[rootValue, slots]` pair; anything else isn't our format.
        throw new TypeError('decodeRefJson: not a ref-json payload')
    }
    const [rootValue, slots] = parsed as [unknown, unknown[]]
    // Pass 1: an empty container shell per slot. Pass 2 fills them so a ref to an ancestor finds its shell.
    const shells = slots.map(buildShell)
    slots.forEach((slot, index) => {
        fillShell(slot, shells[index], shells)
    })
    return resolveValue(rootValue, shells)
}

// Empty container matching a slot's kind. Every slot is a container (only containers are hoisted).
function buildShell(slot: unknown): unknown {
    if (Array.isArray(slot)) {
        if (slot[0] === REF_JSON_TAGS.ARRAY) {
            return []
        }
        if (slot[0] === REF_JSON_TAGS.MAP) {
            return new Map()
        }
        if (slot[0] === REF_JSON_TAGS.SET) {
            return new Set()
        }
    }
    return {}
}

// Decode an inline value: bare primitive (itself), a leaf-special, or a reference to a built shell.
function resolveValue(value: unknown, shells: unknown[]): unknown {
    if (!Array.isArray(value)) {
        return value
    }
    switch (value[0]) {
        case REF_JSON_TAGS.REF:
            return shells[value[1] as number]
        case REF_JSON_TAGS.UNDEFINED:
            return undefined
        case REF_JSON_TAGS.DATE:
            return new Date(value[1] as number)
        case REF_JSON_TAGS.REGEXP:
            return new RegExp(value[1] as string, value[2] as string)
        case REF_JSON_TAGS.BIGINT:
            return BigInt(value[1] as string)
        case REF_JSON_TAGS.NUMBER:
            return decodeNumberToken(value[1] as string)
        default:
            throw new TypeError(`decodeRefJson: unknown value tag ${String(value[0])}`)
    }
}

// Fill a container shell from its slot, resolving each inline child.
function fillShell(slot: unknown, shell: unknown, shells: unknown[]): void {
    if (!Array.isArray(slot)) {
        const target = shell as Record<string, unknown>
        const record = slot as Record<string, unknown>
        for (const key of Object.keys(record)) {
            target[key] = resolveValue(record[key], shells)
        }
        return
    }
    if (slot[0] === REF_JSON_TAGS.ARRAY) {
        const target = shell as unknown[]
        // Loop (not push(...spread)) so a huge array can't blow the call-stack arg limit.
        for (let index = 1; index < slot.length; index++) {
            target.push(resolveValue(slot[index], shells))
        }
        return
    }
    if (slot[0] === REF_JSON_TAGS.MAP) {
        const target = shell as Map<unknown, unknown>
        for (const [key, val] of slot[1] as [unknown, unknown][]) {
            target.set(resolveValue(key, shells), resolveValue(val, shells))
        }
        return
    }
    if (slot[0] === REF_JSON_TAGS.SET) {
        const target = shell as Set<unknown>
        for (const member of slot[1] as unknown[]) {
            target.add(resolveValue(member, shells))
        }
    }
}

// Reverse of encodeRefJson's numberToken.
function decodeNumberToken(token: string): number {
    if (token === 'NaN') {
        return Number.NaN
    }
    if (token === 'Infinity') {
        return Number.POSITIVE_INFINITY
    }
    if (token === '-Infinity') {
        return Number.NEGATIVE_INFINITY
    }
    return -0
}
