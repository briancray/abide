/*
Injects a component's scoped CSS into the document head exactly once per scope
attribute — so a component mounted many times adds its `<style>` only the first
time. The runtime target for a `<style>` block; the CSS is already scoped to
`[scopeAttribute]` by the compiler. A no-op without a document (the server emits
the `<style>` into its HTML directly).
*/
const injected = new Set<string>()

// @readme plumbing
export function injectStyle(scopeAttribute: string, css: string): void {
    if (injected.has(scopeAttribute)) {
        return
    }
    if (typeof document === 'undefined' || document.head === null || document.head === undefined) {
        return
    }
    injected.add(scopeAttribute)
    const element = document.createElement('style')
    element.setAttribute('data-belte-style', scopeAttribute)
    element.textContent = css
    document.head.appendChild(element)
}
