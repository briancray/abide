// THE STREAM-SLOT PATCH GEOMETRY — the two DOM ops, written once.
//
// A streamed subtree lands the same way on both transports, and both had their own implementation of
// it: the first-load document as a MINIFIED JS STRING the parser runs inline (`documentPatch`), the
// soft-nav JSONL stream as TypeScript the client applies (`navigate.applyPatchFrame`, because a
// `fetch`ed body's inline scripts don't auto-run). `STREAM_SENTINEL` already shares the PREFIXES; the
// algorithm over them was two spellings, and only one was tested — the soft-nav half has five cases in
// `nav.test.ts` (including the `<tr>`-into-a-real-`<tbody>` one), the first-load half had none, and
// the first-load half is the one on the default path. A fix applied to the readable copy had nothing
// forcing it into the string.
//
// These functions are STRINGIFIED into the first-load preamble (`documentPatchPreamble`), so they may
// reference NOTHING but their own parameters and DOM globals — no imports, no module constants, no
// closures. That is why the sentinel prefix and the document are parameters rather than reads.

// `fill` a deferred `{#await}` slot: delete the pending fallback — the run of nodes between the
// `<template id="<prefix><id>">` sentinel and its opening `<!--<prefix><id>-->` comment — and insert
// `content` in its place. If the opening comment is missing (impossible from the emitter; belt-and-
// braces so a bad walk can never delete a parent's unrelated children) it removes NOTHING and still
// inserts, degrading to duplicate content rather than data loss.
export function abideFillSlot(id: number, content: Node, prefix: string, doc: Document): void {
    const sentinel = doc.getElementById(prefix + id)
    const parent = sentinel === null ? null : sentinel.parentNode
    if (sentinel === null || parent === null) return
    const stale: ChildNode[] = []
    let found = false
    for (let node = sentinel.previousSibling; node !== null; node = node.previousSibling) {
        if (node.nodeType === 8 && (node as Comment).data === prefix + id) {
            found = true
            break
        }
        stale.push(node as ChildNode)
    }
    if (found) for (let i = 0; i < stale.length; i++) parent.removeChild(stale[i] as ChildNode)
    parent.insertBefore(content, sentinel)
}

// `append` one streamed `{#for await}` item: insert BEFORE the list's trailing
// `<template id="<prefix><id>">` sentinel, so document order is item order at O(1) per patch. The
// sentinel trails the items and is parse-legal in every parent, so nothing can be foster-parented out
// of a table and a streamed `<tr>` lands as a real `<tbody>` child.
export function abideAppendItem(id: number, content: Node, prefix: string, doc: Document): void {
    const sentinel = doc.getElementById(prefix + id)
    const parent = sentinel === null ? null : sentinel.parentNode
    if (sentinel === null || parent === null) return
    parent.insertBefore(content, sentinel)
}
