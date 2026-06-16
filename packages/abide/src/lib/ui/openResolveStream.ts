import { RESOLVE_STREAM_PATH } from '../shared/RESOLVE_STREAM_PATH.ts'
import { streamResponse } from '../shared/streamResponse.ts'
import type { CacheStore } from '../shared/types/CacheStore.ts'
import type { StreamedResolution } from '../shared/types/StreamedResolution.ts'
import { withBase } from '../shared/withBase.ts'
import { applyStreamedResolution } from './applyStreamedResolution.ts'
import { flushUnresolvedPlaceholders } from './flushUnresolvedPlaceholders.ts'
import { setPageStreamController } from './pageStreamController.ts'
import type { StreamingDeferred } from './types/StreamingDeferred.ts'

/*
Opens the out-of-band resolution stream (token from `__SSR__.streamToken`) and
applies each StreamedResolution to its placeholder as it arrives. The stream is
NDJSON, so it shares the canonical `streamResponse` frame parser the rpc/CLI/MCP
drains use rather than re-implementing line framing. The reader gives a reliable
end signal the inline document stream couldn't: on clean EOF or a cut (a non-ok
response or mid-stream error throws here), any still-pending placeholder
re-fetches live; on abort (navigation) the gone page's reads are left alone.
Registered with setPageStreamController so a navigation can cancel it and free
the connection.
*/
export async function openResolveStream(
    token: string,
    store: CacheStore,
    deferreds: Map<string, StreamingDeferred>,
): Promise<void> {
    const controller = new AbortController()
    setPageStreamController(controller)
    try {
        const response = await fetch(withBase(`${RESOLVE_STREAM_PATH}${token}`), {
            signal: controller.signal,
        })
        for await (const resolution of streamResponse<StreamedResolution>(response)) {
            applyStreamedResolution(store, deferreds, resolution)
        }
    } catch {
        // Navigated away mid-stream — the page is gone; don't re-fetch its reads.
    }
    // Clean EOF or a cut (non-abort error): re-fetch anything still pending.
    if (!controller.signal.aborted) {
        flushUnresolvedPlaceholders(deferreds)
    }
}
