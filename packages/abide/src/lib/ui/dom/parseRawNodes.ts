import { foreignWrapperTag } from './foreignWrapperTag.ts'

/*
Parses a trusted raw-markup string into detached nodes in the SAME foreign namespace
as `parent`. The HTML fragment parser namespaces by its context element, so markup
bound inside an <svg>/<math> must parse inside a matching wrapper — otherwise a bare
`<path>` lands in the HTML namespace and never renders. Mirrors `cloneStatic`'s
foreign handling, but parses per-call into a throwaway `<template>` rather than the
skeleton cache: raw values are dynamic, so caching every distinct string would leak.
*/
export function parseRawNodes(parent: Node, markup: string): Node[] {
    const wrapper = foreignWrapperTag(parent)
    const template = document.createElement('template')
    template.innerHTML = wrapper === undefined ? markup : `<${wrapper}>${markup}</${wrapper}>`
    const source = wrapper === undefined ? template.content : (template.content.firstChild as Node)
    return [...source.childNodes]
}
