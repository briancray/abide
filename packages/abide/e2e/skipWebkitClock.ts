import { test } from '@playwright/test'

/**
 * Skips the calling spec's tests in webkit, whose clock cannot price them inside a gate.
 *
 * THE REFUSAL THAT SAYS SO is the instrument working rather than a fault to route around. 43.11
 * asks a sample to be 100x the clock's MEASURED resolution; webkit reports 1,000,000 ns where
 * chromium is ~100 µs and bun is 41 ns, so the bar is 100 ms a sample. Growing n to clear it runs
 * to `MAX_N`, and ten reps of that measured ~28 s for ONE reactive case — `listCases()` has four,
 * of three arms each, which is minutes on one spec.
 *
 * SO THE NUMBER IS NOT LOST, IT IS MOVED. This lane answers in the engines whose clock can carry it
 * inside a gate; a webkit reading is a `bun run bench` question, taken deliberately and with a
 * budget to match. Reported as a skip rather than a failure because nothing here is broken — the
 * engine's clock is the substrate, and 43.11's whole point is that an instrument says when it
 * cannot price something.
 */
export function skipWebkitClock(): void {
    test.skip(
        ({ browserName }) => browserName === 'webkit',
        'webkit coarsens its clock to 1 ms; 43.11 cannot be met inside a gate budget',
    )
}
