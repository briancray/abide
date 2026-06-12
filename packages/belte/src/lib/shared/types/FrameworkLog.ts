import type { Log } from './Log.ts'

/*
The framework's internal voice — the public Log shape bound to the always-on
'belte' channel, plus the CLI/build styling voices: info (plain message),
success (green), detail (dim secondary text). Internal only; apps speak
through their own channel via the public log.
*/
export type FrameworkLog = Log & {
    info(message: string): void
    success(message: string): void
    detail(message: string): void
}
