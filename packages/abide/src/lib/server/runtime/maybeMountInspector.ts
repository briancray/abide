import { abideLog } from '../../shared/abideLog.ts'
import { logTapSlot } from '../../shared/logTapSlot.ts'
import { requestScopeSlot } from '../../shared/requestScopeSlot.ts'
import { socketTapSlot } from '../../shared/socketTapSlot.ts'
import type { LogRecord } from '../../shared/types/LogRecord.ts'
import { buildCacheSnapshot } from './buildCacheSnapshot.ts'
import { buildInFlightSnapshot } from './buildInFlightSnapshot.ts'
import { buildInspectorSurface } from './buildInspectorSurface.ts'
import { inFlightRequests } from './inFlightRequests.ts'
import { ensureRegistriesLoaded } from './registryManifests.ts'
import type { InspectorContext } from './types/InspectorContext.ts'

/* The request handler `@abide/inspector` returns — serves its UI + data routes. */
type InspectorHandler = (request: Request, url: URL) => Promise<Response>

/* Shapes a published socket frame as a log record so the inspector's one feed
   carries it like any other event — on the `socket` channel, tied to the active
   trace when the publish happened inside a request (e.g. an RPC broadcasting). */
function socketFrameRecord(frame: { socket: string; message: unknown }): LogRecord {
    const scope = requestScopeSlot.resolver?.()
    return {
        ts: Date.now(),
        level: 'info',
        channel: 'socket',
        msg: frame.socket,
        data: frame.message,
        trace: scope?.trace.traceId,
        elapsedMs: scope?.elapsedMs,
        method: scope?.method,
        path: scope?.path,
    }
}

/*
Non-literal so Bun's bundler can't fold the optional package into a compiled
binary: the import stays external and resolves only at runtime, only when the
package is actually installed.
*/
const INSPECTOR_PACKAGE = '@abide/inspector'

/*
Activates the opt-in inspector when ABIDE_ENABLE_INSPECTOR=true. The flag is the
activation switch; the package is installed explicitly (`bun add -d
@abide/inspector`) — core never installs anything. Returns the package's request
handler for createServer to route, or undefined when the flag is off or the
package isn't present (with a one-line install hint in that case).

The inspector exposes all traffic and the whole machine surface, so it's gated
behind the operator's explicit flag and announces itself loudly on mount —
enable it only in trusted/dev environments (mirrors warnUnguardedMcp).
*/
export async function maybeMountInspector(app: {
    name: string
    version: string
}): Promise<InspectorHandler | undefined> {
    if (process.env.ABIDE_ENABLE_INSPECTOR !== 'true') {
        return undefined
    }
    const imported = (await import(INSPECTOR_PACKAGE).catch(() => undefined)) as
        | { mountInspector: (context: InspectorContext) => InspectorHandler }
        | undefined
    if (!imported) {
        abideLog.warn(
            `ABIDE_ENABLE_INSPECTOR=true but ${INSPECTOR_PACKAGE} isn't installed — run \`bun add -d ${INSPECTOR_PACKAGE}\``,
        )
        return undefined
    }
    /* Arm in-flight tracking now the inspector is mounting: runWithRequestScope
       fills this Set per request, kept process-wide (the events tap teardown is
       per-connection; the Set outlives any single feed). */
    inFlightRequests.tracked = new Set()
    const context: InspectorContext = {
        app,
        loadSurface: async () => {
            await ensureRegistriesLoaded()
            return buildInspectorSurface()
        },
        cacheSnapshot: buildCacheSnapshot,
        inFlightSnapshot: buildInFlightSnapshot,
        /*
        One process-wide tap each for the log and socket chokepoints; the
        inspector owns both and fans out to its readers. Socket frames arrive
        shaped as `socket`-channel records, so the inspector sees a single
        uniform event stream.
        */
        onRecord: (listener: (record: LogRecord) => void) => {
            const onFrame = (frame: { socket: string; message: unknown }) =>
                listener(socketFrameRecord(frame))
            logTapSlot.tap = listener
            socketTapSlot.tap = onFrame
            return () => {
                if (logTapSlot.tap === listener) {
                    logTapSlot.tap = undefined
                }
                if (socketTapSlot.tap === onFrame) {
                    socketTapSlot.tap = undefined
                }
            }
        },
    }
    const handler = imported.mountInspector(context)
    abideLog.warn('inspector enabled — exposes all traffic and the full surface; trusted use only')
    return handler
}
