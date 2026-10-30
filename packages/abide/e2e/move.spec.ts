// A SURVIVOR IS MOVED, NOT REBUILT — and the part of that no count can see.
//
// `32.29` says a row the reconcile kept is moved. `list.test.ts` already holds the COUNT side of
// it: nodes moved, against the fewest the edit needs. What no count reaches is that
// `insertBefore` on a node already in the document is a REMOVE and then an INSERT, so the row
// leaves the tree and comes back — and `harness/measure`'s `elementsMoved` reads ONE move either
// way. Both arms move exactly one node. The difference is what the removal destroys on the way
// past: an `<iframe>` reloads, a `<video>` pauses, a transition restarts, and FOCUS IS LOST.
//
// FOCUS IS THE DISCRIMINATOR HERE because it needs no timing and no second resource: the input
// the reader was typing in either still has the caret after the reorder or it does not.
//
// BROWSER-ONLY, AND NOT BY PREFERENCE. happy-dom implements no `moveBefore`, so the bun lane
// runs the fallback and would be green against both arms — a gate there would be a green test
// measuring nothing, which CLAUDE.md records happening twice already.
//
// ENGINE-CONDITIONAL, which is the honest shape for a platform swap. `moveNode` PROBES rather
// than versions, so where `moveBefore` has not shipped the fallback is today's behavior and
// there is nothing to assert; the spec says so rather than failing a lane for its engine. What
// is asserted unconditionally is that the reorder HAPPENED — an arm that does nothing preserves
// focus perfectly.
//
// VERIFIED BY REVERT, 2026-09-22. Swapping `moveNode` back to `parent.insertBefore(node, anchor)`
// in `ui/reconcile.ts` takes the focused row's id from `i-b` to `''` in Chromium and this spec
// fails. `worth: focus lost on every reorder`.
//
// AND THE BUN LANE DID NOT NOTICE: `list.test.ts`, `nesting.test.ts` and `hydrate.test.ts` ran 51
// tests green with that installed. Every nodes-moved assertion the reconcile has stayed green,
// because both calls move one node and the emulator has no `moveBefore` to tell apart. That is
// the whole reason this file is in the browser lane rather than beside them.

import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname

// THREE ROWS AND A REVERSE, so the middle row is a survivor that genuinely moves: in a reverse of
// three, `b` keeps its place in the order but every sibling around it is rewritten, which is the
// case where a rebuild and a move look identical from the outside.
const PAGE_SOURCE = `<script>
import { reactive } from '@abide/abide'

const rows = reactive([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
</script>

<ul id="list">
{#for row of rows by row.id}
    <li><input id={'i-' + row.id}/></li>
{/for}
</ul>
<button id="go" onclick={() => rows.set([...rows()].reverse())}>reverse</button>`

const compiled = JSON.parse(
    execFileSync(
        'bun',
        [
            '-e',
            `
import { buildCompiledPage } from './packages/abide/bench/buildCompiledPage.ts'
console.log(JSON.stringify(await buildCompiledPage(${JSON.stringify(PAGE_SOURCE)})))
`,
        ],
        { cwd: REPO, encoding: 'utf8' },
    )
        .trim()
        .split('\n')
        .pop() as string,
) as { markup: string; script: string }

test('a reordered row keeps the state a rebuild would destroy', async ({
    page,
}, testInfo) => {
    // A FRESH NAVIGATION BEFORE `setContent`, per `compiled.spec.ts`: `setContent` replaces the
    // document and keeps the JavaScript context, so a stale `__MOUNT__` would mount into it.
    await page.goto('about:blank')
    await page.setContent(
        `<!doctype html><html><body>${compiled.markup}</body></html>`,
    )
    await page.addScriptTag({ content: compiled.script })

    const result = (await page.evaluate(() => {
        const lane = globalThis as unknown as {
            __MOUNT__?: () => void
            __FLUSH__?: () => void
        }
        lane.__MOUNT__?.()
        const focused = document.querySelector('#i-b') as HTMLInputElement
        focused.focus()
        ;(document.querySelector('#go') as HTMLElement).click()
        lane.__FLUSH__?.()
        return {
            canMove: 'moveBefore' in Element.prototype,
            order: [...document.querySelectorAll('#list input')].map(
                (node) => node.id,
            ),
            active: (document.activeElement as HTMLElement | null)?.id ?? '',
        }
    })) as { canMove: boolean; order: string[]; active: string }

    // THE ARM DID THE JOB. Asked first and always: a reconcile that never ran keeps focus for the
    // same reason a corpse never trips, and it would pass everything below.
    expect(result.order, 'the list did not reorder').toEqual([
        'i-c',
        'i-b',
        'i-a',
    ])

    console.log(
        `\n=== ${testInfo.project.name} — survivor state across a reverse ===\n` +
            `  moveBefore   ${result.canMove ? 'yes' : 'no — the fallback ran, and it is today'}\n` +
            `  focus after  ${result.active === '' ? 'LOST' : result.active}`,
    )

    // WHERE THE PLATFORM HAS IT. Anywhere else this is the `insertBefore` the reconcile made
    // before `moveNode` existed, and asserting against an engine for its version is what the
    // probe exists to avoid.
    if (result.canMove)
        expect(
            result.active,
            'the survivor was torn out of the document and lost focus',
        ).toBe('i-b')
})
