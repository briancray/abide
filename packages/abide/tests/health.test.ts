// 25.4 — WHAT `onHealth` ADDS IS TYPED WHERE THE APP DECLARES IT, by merging into `Health`, so a reader
// of `health()` needs no cast. THE REVERT: declare `Health` as a type alias again; the merge below is
// a second declaration of the name, and `bun run typecheck` refuses this file.

import { expect, test } from 'bun:test'
import type { Health } from '#shared/health.ts'

declare module '#shared/health.ts' {
    interface Health {
        reachable: string[]
    }
}

test('a field an app declares on Health is typed — 25.4', () => {
    const report: Health = {
        version: '1.0.0',
        abide: '0.0.0',
        startedAt: '2026-10-05T00:00:00.000Z',
        reachable: ['tmdb'],
    }
    const reachable: string[] = report.reachable
    expect(reachable).toEqual(['tmdb'])
})
