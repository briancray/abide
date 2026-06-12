import { emitLogRecord } from './emitLogRecord.ts'
import { isDebugEnabled } from './isDebugEnabled.ts'
import { isDebugNegated } from './isDebugNegated.ts'
import { randomHexId } from './randomHexId.ts'
import type { ChannelLog } from './types/ChannelLog.ts'

/*
Channel gating source. Server: the DEBUG env var, npm-debug conventions via
isDebugEnabled. Browser: the `belte-debug` localStorage key with the same
pattern syntax, read per call so toggling it in devtools takes effect without
a reload. localStorage access is guarded — privacy modes throw on read.
*/
function channelPatterns(): string | undefined {
    if (typeof process !== 'undefined' && process.env.DEBUG) {
        return process.env.DEBUG
    }
    if (typeof localStorage !== 'undefined') {
        try {
            return localStorage.getItem('belte-debug') ?? undefined
        } catch {
            return undefined
        }
    }
    return undefined
}

// Prefers a full stack trace when the value is an Error so logs include the call site.
function errorParts(value: unknown): { msg: string; stack?: string } {
    if (value instanceof Error) {
        return { msg: value.message, stack: value.stack }
    }
    return { msg: String(value) }
}

/* Times `work` under an operation name, minting the record's span id so a future exporter can materialise it as a span. */
async function traceWork<Return>(
    name: string,
    work: () => Return | Promise<Return>,
    channel: string,
): Promise<Return> {
    const spanId = randomHexId(8)
    const startMs = performance.now()
    try {
        const result = await work()
        emitLogRecord({
            level: 'info',
            msg: '',
            name,
            spanId,
            durationMs: performance.now() - startMs,
            channel,
        })
        return result
    } catch (error) {
        const { msg, stack } = errorParts(error)
        emitLogRecord({
            level: 'error',
            msg,
            stack,
            name,
            spanId,
            durationMs: performance.now() - startMs,
            channel,
        })
        throw error
    }
}

/*
Builds the callable-with-levels log shape bound to a channel. Every record
carries the channel; `getChannel` is a thunk because the default (app-name)
channel resolves after module init. `always` channels — the app's own and
belte's framework voice — emit unless a `-name` DEBUG pattern explicitly
shuts them off; everything else is a diagnostic channel gated by DEBUG
(browser: the belte-debug localStorage key). Levels never gate: a silenced
channel is silent at every level, an enabled one shows them all.
*/
export function createChannelLog(
    getChannel: () => string,
    always: boolean,
): ChannelLog & { enabled(): boolean } {
    const enabled = () =>
        always
            ? !isDebugNegated(getChannel(), channelPatterns())
            : isDebugEnabled(getChannel(), channelPatterns())
    const call = (message: string, data?: unknown): void => {
        if (enabled()) {
            emitLogRecord({ level: 'info', msg: message, data, channel: getChannel() })
        }
    }
    return Object.assign(call, {
        /* Exposed so wrappers (belteLog's styling voices) emit through the same gate. */
        enabled,
        warn(message: string, data?: unknown): void {
            if (enabled()) {
                emitLogRecord({ level: 'warn', msg: message, data, channel: getChannel() })
            }
        },
        error(value: unknown, data?: unknown): void {
            if (enabled()) {
                emitLogRecord({ level: 'error', ...errorParts(value), data, channel: getChannel() })
            }
        },
        trace<Return>(name: string, work: () => Return | Promise<Return>): Promise<Return> {
            if (enabled()) {
                return traceWork(name, work, getChannel())
            }
            return (async () => work())()
        },
    })
}
