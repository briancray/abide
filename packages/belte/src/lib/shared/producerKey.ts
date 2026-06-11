import { canonicalJson } from './canonicalJson.ts'

/*
Producers have no wire identity, so each is assigned a stable id on first use,
kept in a WeakMap so it's collected with the function. The cache key is that id
plus the canonicalised args — a hoisted producer dedupes across calls; an inline
arrow gets a fresh id every call and never does.

`producerKey.existing` reads the id without assigning one — selectors matching
prior entries must not mint identities for producers never cached.
*/
const producerIds = new WeakMap<object, string>()
let producerCounter = 0

export function producerKey(producer: object, args: unknown): string {
    /* Not getOrInsertComputed: shared module ships to the browser, where support is too new (Safari 26.2 / Chrome 145). */
    let id = producerIds.get(producer)
    if (id === undefined) {
        id = `@producer:${++producerCounter}`
        producerIds.set(producer, id)
    }
    return args === undefined ? id : `${id} ${canonicalJson(args)}`
}

/* With `args`, the exact entry key for that call (same format as producerKey) — still never minting. */
producerKey.existing = function existing(producer: object, args?: unknown): string | undefined {
    const id = producerIds.get(producer)
    if (id === undefined || args === undefined) {
        return id
    }
    return `${id} ${canonicalJson(args)}`
}
