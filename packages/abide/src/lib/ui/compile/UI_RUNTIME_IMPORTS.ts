/*
The abide-ui runtime names every compiled component module depends on, each
paired with its package subpath (after the package name). One source of truth so
three things can't drift: the normal module's import block (`compileModule`), the
hot module's `window.__abide` destructure (dev component HMR), and the dev bridge
that populates `window.__abide`. Order is the emit order.

`alias` (when set) is the LOCAL name codegen emits — a `$$`-prefixed form reserved
for the compiler so a user variable of the helper's bare name can never collide
(`each as $$each`). It defaults to `name`; the dev bridge keys stay bare (the import
source), so a hot module destructures `{ name: alias }`. As each helper's emit sites
flip to its `$$` alias, set `alias` here in lockstep.
*/
export const UI_RUNTIME_IMPORTS: { name: string; specifier: string; alias?: string }[] = [
    { name: 'snippet', specifier: 'shared/snippet', alias: '$$snippet' },
    /* `scope` is author-facing (`scope().state(...)`) but lowers to `$$scope` shadowably:
       `referenceFor` rewrites a bare `scope` read to `$$scope` only when not lexically
       shadowed, so the aliased import is the binding that emitted code resolves to. */
    { name: 'scope', specifier: 'ui/scope', alias: '$$scope' },
    { name: 'enterScope', specifier: 'ui/enterScope', alias: '$$enterScope' },
    { name: 'exitScope', specifier: 'ui/exitScope', alias: '$$exitScope' },
    { name: 'effect', specifier: 'ui/effect', alias: '$$effect' },
    { name: 'mount', specifier: 'ui/dom/mount', alias: '$$mount' },
    { name: 'appendText', specifier: 'ui/dom/appendText', alias: '$$appendText' },
    { name: 'appendTextAt', specifier: 'ui/dom/appendTextAt', alias: '$$appendTextAt' },
    { name: 'appendSnippet', specifier: 'ui/dom/appendSnippet', alias: '$$appendSnippet' },
    { name: 'appendStatic', specifier: 'ui/dom/appendStatic', alias: '$$appendStatic' },
    { name: 'cloneStatic', specifier: 'ui/dom/cloneStatic', alias: '$$cloneStatic' },
    { name: 'skeleton', specifier: 'ui/dom/skeleton', alias: '$$skeleton' },
    { name: 'anchorCursor', specifier: 'ui/dom/anchorCursor', alias: '$$anchorCursor' },
    { name: 'attr', specifier: 'ui/dom/attr', alias: '$$attr' },
    { name: 'on', specifier: 'ui/dom/on', alias: '$$on' },
    { name: 'attach', specifier: 'ui/dom/attach', alias: '$$attach' },
    { name: 'each', specifier: 'ui/dom/each', alias: '$$each' },
    { name: 'eachAsync', specifier: 'ui/dom/eachAsync', alias: '$$eachAsync' },
    { name: 'when', specifier: 'ui/dom/when', alias: '$$when' },
    { name: 'awaitBlock', specifier: 'ui/dom/awaitBlock', alias: '$$awaitBlock' },
    { name: 'deferResume', specifier: 'ui/deferResume', alias: '$$deferResume' },
    { name: 'tryBlock', specifier: 'ui/dom/tryBlock', alias: '$$tryBlock' },
    { name: 'switchBlock', specifier: 'ui/dom/switchBlock', alias: '$$switchBlock' },
    { name: 'mountSlot', specifier: 'ui/dom/mountSlot', alias: '$$mountSlot' },
    { name: 'outlet', specifier: 'ui/dom/outlet', alias: '$$outlet' },
    { name: 'mountChild', specifier: 'ui/dom/mountChild', alias: '$$mountChild' },
    { name: 'mergeProps', specifier: 'ui/dom/mergeProps', alias: '$$mergeProps' },
    { name: 'spreadProps', specifier: 'ui/dom/spreadProps', alias: '$$spreadProps' },
    { name: 'restProps', specifier: 'ui/dom/restProps', alias: '$$restProps' },
    { name: 'spreadAttrs', specifier: 'ui/dom/spreadAttrs', alias: '$$spreadAttrs' },
    { name: 'readCall', specifier: 'ui/dom/readCall', alias: '$$readCall' },
    { name: 'hydrate', specifier: 'ui/dom/hydrate', alias: '$$hydrate' },
    { name: 'escapeKey', specifier: 'ui/runtime/escapeKey', alias: '$$escapeKey' },
    { name: 'nextBlockId', specifier: 'ui/runtime/nextBlockId', alias: '$$nextBlockId' },
    {
        name: 'enterRenderPass',
        specifier: 'ui/runtime/enterRenderPass',
        alias: '$$enterRenderPass',
    },
    { name: 'exitRenderPass', specifier: 'ui/runtime/exitRenderPass', alias: '$$exitRenderPass' },
]
