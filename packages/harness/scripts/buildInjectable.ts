// Builds the measure lane into ONE IIFE the browser arm is injected with. The bytes
// playwright injects and the bytes `bun test` imports have to be the same code, or
// the lane's one claim — the only lane in both substrates — is a claim about two
// different instruments.
//
// A spec injects the source with `addInitScript({ content })` and reads
// `__HARNESS_MEASURE__` off the page. Built in memory rather than into `dist/`: every
// spec loads in both engine projects at once, and two workers writing one file is a
// reader that can catch it half-written.

import type { Page } from '@playwright/test'

const ENTRY = new URL('../src/measure/injectable.ts', import.meta.url).pathname

/** Builds the measure lane's injectable — or another entry's, the same way — and returns its source. */
export async function buildInjectable(entry = ENTRY): Promise<string> {
    const built = await Bun.build({
        entrypoints: [entry],
        format: 'iife',
        target: 'browser',
        minify: false,
    })
    if (!built.success)
        throw new AggregateError(built.logs, `${entry} did not build`)
    return (built.outputs[0] as Blob).text()
}

/**
 * Opens a blank page `page` runs `source` in first.
 *
 * NAVIGATED, NOT JUST SET: `setContent` on a page still on its initial `about:blank` reruns no init
 * script — nothing navigated — so the injection would be silently absent, and every counter read
 * undefined: the gate failing on the instrument rather than on the claim.
 */
export async function openInjected(page: Page, source: string): Promise<void> {
    await page.addInitScript({ content: source })
    await page.goto('about:blank')
    await page.setContent('<!doctype html><html><body></body></html>')
}
