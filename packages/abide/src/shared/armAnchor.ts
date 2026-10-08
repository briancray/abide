import { REGION_OPEN } from './ANCHORS.ts'

// 41.24 — A REGION HOLDING ONE ARM AT A TIME NAMES THE ARM THE SERVER PAINTED in its open anchor,
// `[0`, `[1` and on: an `{#if}` chain's arm, and a `{#try}`'s catch as its arm `1` (32.16). The
// spelling is written here and read here, so the compiler and the client cannot disagree about it.
// A bare `REGION_OPEN` names none — a region the browser filled, a `{#try}` whose body painted, or
// one the server left empty (41.4) — and is adopted as it stands.

/** An open anchor's data naming `arm`. */
export function armAnchor(arm: number): string {
    return `${REGION_OPEN}${arm}`
}

/** The arm an open anchor's data names, or `undefined` where it names none. */
export function namedArm(data: string): number | undefined {
    return data.length === 1 ? undefined : Number(data.slice(1))
}
