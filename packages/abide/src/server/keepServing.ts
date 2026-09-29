import { reportUnexpected } from './hooks.ts'

/**
 * Reports a fault nobody awaited instead of letting it end the `abide dev` process.
 *
 * 37.9 — `abide dev` OUTLIVES WHAT NOBODY AWAITED. A promise rejected with nothing attached, or a
 * throw out of a timer, belongs to no request, and bun's default for either is to end the process —
 * the author's session with it. `start` stops the app instead (`stopOnSignalOrFault`); `createApp`
 * installs neither, so a test or a script keeps bun's default of failing loudly.
 */
export function keepServing(): void {
    process.on('unhandledRejection', reportUnexpected)
    process.on('uncaughtException', reportUnexpected)
}
