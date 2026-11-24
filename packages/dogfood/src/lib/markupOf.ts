// THE MARKUP AN EXAMPLE MADE, read off the live DOM rather than its source, so what a reader styles
// against is what the browser holds this moment — the parts a headless component spread, the state
// it set — and never a description of it. Comments are the anchors hydration walks, so they are dropped.

import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

// A drawing's geometry is long and says nothing a stylesheet reaches, so it alone is cut short; a
// class or a style is what an example is about, and is shown whole.
const DRAWN = new Set(['d', 'points', 'transform'])
const LONG_DRAWING = 48
const INLINE_TEXT = 60
// The bare attribute a component's scoped `<style>` marks its elements with: compiled, never written.
const SCOPE_TOKEN = /^a-[0-9a-z]{6}$/

/** The markup under `root` as indented HTML, one element to a line. */
export function markupOf(root: Element): string {
    const lines: string[] = []
    for (const child of root.childNodes) write(child, 0, lines)
    return lines.join('\n')
}

function write(node: Node, depth: number, lines: string[]): void {
    const indent = '  '.repeat(depth)
    if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text !== '') lines.push(indent + text)
        return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    const tag = element.localName
    let open = `<${tag}`
    for (const attribute of element.attributes) {
        if (attribute.value === '' && SCOPE_TOKEN.test(attribute.name)) continue
        const value =
            DRAWN.has(attribute.name) && attribute.value.length > LONG_DRAWING
                ? `${attribute.value.slice(0, LONG_DRAWING)}…`
                : attribute.value
        open +=
            value === ''
                ? ` ${attribute.name}`
                : ` ${attribute.name}="${value}"`
    }
    open += '>'
    if (VOID_ELEMENTS.has(tag)) {
        lines.push(indent + open)
        return
    }
    // An element holding text alone stays on its line, as a reader would write it.
    let onlyText = true
    for (const child of element.childNodes)
        if (child.nodeType === Node.ELEMENT_NODE) onlyText = false
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (onlyText && text.length <= INLINE_TEXT) {
        lines.push(`${indent}${open}${text}</${tag}>`)
        return
    }
    lines.push(indent + open)
    for (const child of element.childNodes) write(child, depth + 1, lines)
    lines.push(`${indent}</${tag}>`)
}

/**
 * The selectors a stylesheet reaches the markup under `root` by: each part a headless component
 * named with a `data-` attribute holding a value (`[data-tabs="tab"]`), and each state set on that
 * part — a `data-` attribute of its own (`[data-tabs="tab"][data-selected]`), an ARIA state, or a
 * native one like `disabled`. Added to `into`, so a state the reader has only just caused stays
 * listed after it clears.
 */
export function hooksOf(root: Element, into: Set<string>): void {
    for (const element of root.querySelectorAll('*')) {
        const parts: string[] = []
        const states: string[] = []
        for (const attribute of element.attributes) {
            const { name, value } = attribute
            if (name.startsWith('data-')) {
                if (value !== '' && !STATE_VALUES.has(value))
                    parts.push(`[${name}="${value}"]`)
                else
                    states.push(`[${name}${value === '' ? '' : `="${value}"`}]`)
            } else if (ARIA_STATES.has(name))
                states.push(`[${name}="${value}"]`)
            else if (NATIVE_STATES.has(name)) states.push(`[${name}]`)
        }
        if (parts.length === 0 && states.length === 0) continue
        if (parts.length === 0) parts.push(element.localName)
        for (const part of parts) {
            if (part !== element.localName) into.add(part)
            for (const state of states) into.add(part + state)
        }
    }
}

// A `data-` value that reads as a state rather than a part's name.
const STATE_VALUES = new Set(['true', 'false', 'open', 'closed'])
// The ARIA attributes that say what state a part is in, rather than what it names or controls.
const ARIA_STATES = new Set([
    'aria-busy',
    'aria-checked',
    'aria-current',
    'aria-disabled',
    'aria-expanded',
    'aria-invalid',
    'aria-pressed',
    'aria-selected',
])
const NATIVE_STATES = new Set(['disabled', 'open', 'hidden'])
