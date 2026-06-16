import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
A component's scoped CSS. On a fresh mount it injects a `<style>` into the document
head exactly once per scope attribute (a component mounted many times adds its
style only the first time). On hydrate it instead CLAIMS the `<style>` the server
emitted as the component's first node — advancing the hydration cursor so the body
that follows lines up — and leaves it in the DOM (scoped `[data-b-…]` selectors
work from anywhere). The compiler emits this as the first statement of a component
with a `<style>` block; the CSS is already scoped by the compiler.
*/
const injected = new Set<string>()

// @readme plumbing
export function injectStyle(parent: Node, scopeAttribute: string, css: string): void {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const node = claimChild(hydration, parent)
        const tag = (node as { tagName?: string } | null)?.tagName
        if (node !== null && tag !== undefined && tag.toLowerCase() === 'style') {
            hydration.next.set(parent, node.nextSibling)
        }
        injected.add(scopeAttribute)
        return
    }
    if (injected.has(scopeAttribute)) {
        return
    }
    if (typeof document === 'undefined' || document.head === null || document.head === undefined) {
        return
    }
    injected.add(scopeAttribute)
    const element = document.createElement('style')
    element.setAttribute('data-abide-style', scopeAttribute)
    element.textContent = css
    document.head.appendChild(element)
}
