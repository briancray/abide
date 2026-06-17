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
    { name: 'doc', specifier: 'ui/doc' },
    { name: 'state', specifier: 'ui/state' },
    { name: 'derived', specifier: 'ui/derived' },
    { name: 'effect', specifier: 'ui/effect' },
    { name: 'mount', specifier: 'ui/dom/mount' },
    { name: 'openChild', specifier: 'ui/dom/openChild' },
    { name: 'openRoot', specifier: 'ui/dom/openRoot' },
    { name: 'appendText', specifier: 'ui/dom/appendText' },
    { name: 'appendSnippet', specifier: 'ui/dom/appendSnippet' },
    { name: 'appendStatic', specifier: 'ui/dom/appendStatic' },
    { name: 'cloneStatic', specifier: 'ui/dom/cloneStatic' },
    { name: 'attr', specifier: 'ui/dom/attr' },
    { name: 'on', specifier: 'ui/dom/on' },
    { name: 'each', specifier: 'ui/dom/each' },
    { name: 'eachAsync', specifier: 'ui/dom/eachAsync' },
    { name: 'when', specifier: 'ui/dom/when' },
    { name: 'awaitBlock', specifier: 'ui/dom/awaitBlock' },
    { name: 'tryBlock', specifier: 'ui/dom/tryBlock' },
    { name: 'switchBlock', specifier: 'ui/dom/switchBlock' },
    { name: 'mountChild', specifier: 'ui/dom/mountChild' },
    { name: 'hydrate', specifier: 'ui/dom/hydrate' },
    { name: 'nextBlockId', specifier: 'ui/runtime/nextBlockId' },
    { name: 'enterRenderPass', specifier: 'ui/runtime/enterRenderPass' },
    { name: 'exitRenderPass', specifier: 'ui/runtime/exitRenderPass' },
]
