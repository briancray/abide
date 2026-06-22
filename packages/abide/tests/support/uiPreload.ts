import { abideUiPlugin } from '../../src/lib/ui/compile/abideUiPlugin.ts'
import { anchorCursor } from '../../src/lib/ui/dom/anchorCursor.ts'
import { appendTextAt } from '../../src/lib/ui/dom/appendTextAt.ts'
import { cloneStatic } from '../../src/lib/ui/dom/cloneStatic.ts'
import { mergeProps } from '../../src/lib/ui/dom/mergeProps.ts'
import { mountChild } from '../../src/lib/ui/dom/mountChild.ts'
import { mountSlot } from '../../src/lib/ui/dom/mountSlot.ts'
import { outlet } from '../../src/lib/ui/dom/outlet.ts'
import { restProps } from '../../src/lib/ui/dom/restProps.ts'
import { skeleton } from '../../src/lib/ui/dom/skeleton.ts'
import { spreadAttrs } from '../../src/lib/ui/dom/spreadAttrs.ts'
import { spreadProps } from '../../src/lib/ui/dom/spreadProps.ts'
import { enterScope } from '../../src/lib/ui/enterScope.ts'
import { exitScope } from '../../src/lib/ui/exitScope.ts'
import { enterRenderPass } from '../../src/lib/ui/runtime/enterRenderPass.ts'
import { exitRenderPass } from '../../src/lib/ui/runtime/exitRenderPass.ts'
import { nextBlockId } from '../../src/lib/ui/runtime/nextBlockId.ts'
import { scope } from '../../src/lib/ui/scope.ts'

/*
Test preload registering abide-ui's `.abide` loader so fixture pages/components
import and compile through the runtime the server and client bundles use. abide-ui
is the only UI runtime, and the reactive test harnesses are plain `.ts` (abide-ui
effect/computed), needing no loader.
*/
Bun.plugin(abideUiPlugin)

/*
Compiled SSR/client bodies run via `new Function` in the unit harnesses reference
the render-pass helpers as bare names (the real bundle imports them). Expose them
globally so those bodies resolve to the real runtime singleton — keeping the
block-id counter shared between a harness's server render and client mount.
*/
const globals = globalThis as Record<string, unknown>
globals.nextBlockId = nextBlockId
globals.enterRenderPass = enterRenderPass
globals.exitRenderPass = exitRenderPass
/* Compiled child mounts call `mountChild` as a bare name; the real bundle imports
   it. Off the hot path (hotReloadEnabled stays false here) it just runs the
   factory, exactly as the previous direct call did. */
globals.mountChild = mountChild
/* A `{...expr}` spread compiles to `mergeProps([spreadProps(expr), …])`; the real
   bundle imports both, the harnesses resolve them as bare globals. */
globals.mergeProps = mergeProps
globals.spreadProps = spreadProps
/* `const { foo, ...rest } = props()` lowers to `restProps($props, [...])`, and a native
   `<el {...rest}>` to `spreadAttrs(el, () => rest)`; the bundle imports both. */
globals.restProps = restProps
globals.spreadAttrs = spreadAttrs
/* The build emits `cloneStatic` for fully-static element runs; the real bundle
   imports it, the `new Function` harnesses resolve it as a bare global. */
globals.cloneStatic = cloneStatic
/* Likewise `skeleton` for a bound element with a static subtree — parser-backed so
   foreign content (SVG/MathML) keeps its namespace. */
globals.skeleton = skeleton
/* `appendTextAt` mounts a reactive-text hole at its skeleton anchor. */
globals.appendTextAt = appendTextAt
/* `anchorCursor` positions a skeleton-anchored control-flow block/slot — the create
   insertion reference + the parked hydrate cursor at the anchor. */
globals.anchorCursor = anchorCursor
/* `mountSlot` mounts a `<slot>`'s content as a marker-bounded range at its anchor. */
globals.mountSlot = mountSlot
/* `outlet` emits a layout's empty router fill boundary at its anchor; the router
   fills it with the next chain layer (`fillBoundary`). */
globals.outlet = outlet
/* The lowering emits `const model = scope()`; harness bodies resolve `scope` as a
   bare global (the real bundle imports it). Client mount/hydrate establish the
   per-component scope; SSR establishes one per render (see enterScope). */
globals.scope = scope
globals.enterScope = enterScope
globals.exitScope = exitScope
