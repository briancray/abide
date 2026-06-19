import { html } from '../shared/html.ts'
import { snippet } from '../shared/snippet.ts'
import { anchorCursor } from './dom/anchorCursor.ts'
import { appendSnippet } from './dom/appendSnippet.ts'
import { appendStatic } from './dom/appendStatic.ts'
import { appendText } from './dom/appendText.ts'
import { appendTextAt } from './dom/appendTextAt.ts'
import { attach } from './dom/attach.ts'
import { attr } from './dom/attr.ts'
import { awaitBlock } from './dom/awaitBlock.ts'
import { cloneStatic } from './dom/cloneStatic.ts'
import { each } from './dom/each.ts'
import { eachAsync } from './dom/eachAsync.ts'
import { hydrate } from './dom/hydrate.ts'
import { mount } from './dom/mount.ts'
import { mountChild } from './dom/mountChild.ts'
import { mountSlot } from './dom/mountSlot.ts'
import { on } from './dom/on.ts'
import { skeleton } from './dom/skeleton.ts'
import { switchBlock } from './dom/switchBlock.ts'
import { tryBlock } from './dom/tryBlock.ts'
import { when } from './dom/when.ts'
import { effect } from './effect.ts'
import { enterScope } from './enterScope.ts'
import { exitScope } from './exitScope.ts'
import { enterRenderPass } from './runtime/enterRenderPass.ts'
import { exitRenderPass } from './runtime/exitRenderPass.ts'
import { hotReloadEnabled } from './runtime/hotReloadEnabled.ts'
import { hotReplace } from './runtime/hotReplace.ts'
import { nextBlockId } from './runtime/nextBlockId.ts'
import { scope } from './scope.ts'

/*
Dev-only: exposes the abide-ui runtime plus `hotReplace` on `window.__abide`, and
flips on `hotReloadEnabled` so `mountChild` records every instance it mounts. A
hot module (the dev server's standalone recompile of one edited `.abide`) reads
its runtime from this object instead of importing fresh copies — so it shares the
one reactive graph and instance registry — then calls `hotReplace` to swap every
live instance in place. The keys mirror `UI_RUNTIME_IMPORTS` (+ `hotReplace`); a
test guards that pairing. `startClient` calls this when the server marks the page
dev (the live-reload script sets `window.__abideDev`).
*/
export function installHotBridge(): void {
    ;(globalThis as { __abide?: Record<string, unknown> }).__abide = {
        html,
        snippet,
        scope,
        enterScope,
        exitScope,
        effect,
        mount,
        appendText,
        appendTextAt,
        appendSnippet,
        appendStatic,
        cloneStatic,
        skeleton,
        anchorCursor,
        attr,
        on,
        attach,
        each,
        eachAsync,
        when,
        awaitBlock,
        tryBlock,
        switchBlock,
        mountSlot,
        mountChild,
        hydrate,
        nextBlockId,
        enterRenderPass,
        exitRenderPass,
        hotReplace,
    }
    hotReloadEnabled.current = true
}
