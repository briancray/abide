import { reportUnexpected } from './hooks.ts'

// 37.8 — A SERVER OUTLIVES WHAT NOBODY AWAITED. A promise rejected with nothing attached, or a throw
// out of a timer, belongs to no request, and bun's default for either is to end the process — every
// other caller with it. The server commands install this; `createApp` does not, so a test or a
// script keeps bun's default of failing loudly.
export function keepServing(): void {
    process.on('unhandledRejection', reportUnexpected)
    process.on('uncaughtException', reportUnexpected)
}
