// Builds one browser bench — `bench/<name>Injectable.ts` — into one IIFE's source a page can be
// injected with, for a spec to `await buildBench('list')`. The build is the harness's own
// `buildInjectable`, over this entry rather than its MEASURE lane's: what keeps abide out of that
// lane is its entry's graph, not the build.

import type { batch, claimOf, emulatedDom, ratio } from '@abide/harness/report'
import type { Page } from '@playwright/test'

import { buildInjectable } from '../../harness/scripts/buildInjectable.ts'

/** Builds `bench/<name>Injectable.ts` into an IIFE and returns its source. */
export function buildBench(name: string): Promise<string> {
    return buildInjectable(
        new URL(`./${name}Injectable.ts`, import.meta.url).pathname,
    )
}

/**
 * Opens a blank page `page` runs `source` in first.
 *
 * NAVIGATED, NOT JUST SET: `setContent` on a page still on its initial `about:blank` reruns no init
 * script — nothing navigated — so the injection would be silently absent.
 */
export async function openInjected(page: Page, source: string): Promise<void> {
    await page.addInitScript({ content: source })
    await page.goto('about:blank')
    await page.setContent('<!doctype html><html><body></body></html>')
}

/** What `buildBench('report')` leaves on the page's `globalThis.__REPORT__`. */
export type Report = {
    batch: typeof batch
    claimOf: typeof claimOf
    emulatedDom: typeof emulatedDom
    ratio: typeof ratio
}
