// Types BOTH passes can read, so the two derivations can be diffed against each other. Anything they
// disagree about is a shape that changes depending on whether a build step ran, which is not what
// "the second speed only upgrades" is supposed to mean.

import { GET, POST } from 'abide/server'

export const scalars = GET((a: { s: string; n: number; b: boolean; nil: null }) => a)
export const optional = GET((a: { need: string; maybe?: number; orNull: string | null }) => a)
export const literals = GET((a: { sort: 'asc' | 'desc'; one: 1 | 2; flag: true }) => a)
export const arrays = GET((a: { tags: string[]; rows: number[][] }) => a)
export const nested = GET((a: { who: { id: number; deep: { ok: boolean } } }) => a)
export const record = GET((a: { by: Record<string, number> }) => a)
export const mixed = GET((a: { v: string | number }) => a)
export const dates = POST((a: { when: Date; at: URL; file: File }) => a)
export const tuples = GET((a: { pair: [string, number] }) => a)
