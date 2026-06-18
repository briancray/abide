/*
Parsed-once `<template>` per unique static-skeleton string, reused across every
mount. A `<template>` (not a detached `<div>`) so table/select content parses by
the real content model, exactly as the browser parsed the server markup. Backs
`cloneStatic`'s skeleton-string→template cache.

The cache is keyed by the owning `document`: a template belongs to the document
that created it, and its clones must land in that same document. In production there
is one document, so this is one inner map; under the test harness, which installs a
fresh `document` per file, it keeps each file's templates (and their node class)
from leaking into the next.
*/
const CACHES = new WeakMap<object, Map<string, HTMLTemplateElement>>()

export function templateFor(html: string): HTMLTemplateElement {
    let cache = CACHES.get(document)
    if (cache === undefined) {
        cache = new Map()
        CACHES.set(document, cache)
    }
    let template = cache.get(html)
    if (template === undefined) {
        template = document.createElement('template')
        template.innerHTML = html
        cache.set(html, template)
    }
    return template
}
