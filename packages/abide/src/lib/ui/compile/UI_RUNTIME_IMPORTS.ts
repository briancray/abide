/*
The abide-ui runtime names every compiled component module depends on, each
paired with its package subpath (after the package name). One source of truth so
three things can't drift: the normal module's import block (`compileModule`), the
hot module's `window.__abide` destructure (dev component HMR), and the dev bridge
that populates `window.__abide`. Order is the emit order.
*/
export const UI_RUNTIME_IMPORTS: { name: string; specifier: string }[] = [
    { name: 'html', specifier: 'shared/html' },
    { name: 'snippet', specifier: 'shared/snippet' },
    { name: 'scope', specifier: 'ui/scope' },
    { name: 'enterScope', specifier: 'ui/enterScope' },
    { name: 'exitScope', specifier: 'ui/exitScope' },
    { name: 'effect', specifier: 'ui/effect' },
    { name: 'mount', specifier: 'ui/dom/mount' },
    { name: 'appendText', specifier: 'ui/dom/appendText' },
    { name: 'appendTextAt', specifier: 'ui/dom/appendTextAt' },
    { name: 'appendSnippet', specifier: 'ui/dom/appendSnippet' },
    { name: 'appendStatic', specifier: 'ui/dom/appendStatic' },
    { name: 'cloneStatic', specifier: 'ui/dom/cloneStatic' },
    { name: 'skeleton', specifier: 'ui/dom/skeleton' },
    { name: 'anchorCursor', specifier: 'ui/dom/anchorCursor' },
    { name: 'attr', specifier: 'ui/dom/attr' },
    { name: 'on', specifier: 'ui/dom/on' },
    { name: 'attach', specifier: 'ui/dom/attach' },
    { name: 'each', specifier: 'ui/dom/each' },
    { name: 'eachAsync', specifier: 'ui/dom/eachAsync' },
    { name: 'when', specifier: 'ui/dom/when' },
    { name: 'awaitBlock', specifier: 'ui/dom/awaitBlock' },
    { name: 'tryBlock', specifier: 'ui/dom/tryBlock' },
    { name: 'switchBlock', specifier: 'ui/dom/switchBlock' },
    { name: 'mountSlot', specifier: 'ui/dom/mountSlot' },
    { name: 'outlet', specifier: 'ui/dom/outlet' },
    { name: 'mountChild', specifier: 'ui/dom/mountChild' },
    { name: 'mergeProps', specifier: 'ui/dom/mergeProps' },
    { name: 'spreadProps', specifier: 'ui/dom/spreadProps' },
    { name: 'restProps', specifier: 'ui/dom/restProps' },
    { name: 'spreadAttrs', specifier: 'ui/dom/spreadAttrs' },
    { name: 'readCall', specifier: 'ui/dom/readCall' },
    { name: 'hydrate', specifier: 'ui/dom/hydrate' },
    { name: 'escapeKey', specifier: 'ui/runtime/escapeKey' },
    { name: 'nextBlockId', specifier: 'ui/runtime/nextBlockId' },
    { name: 'enterRenderPass', specifier: 'ui/runtime/enterRenderPass' },
    { name: 'exitRenderPass', specifier: 'ui/runtime/exitRenderPass' },
]
