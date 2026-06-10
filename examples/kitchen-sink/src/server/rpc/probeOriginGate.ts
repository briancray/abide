import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { server } from '@belte/belte/server/server'

/*
Exercises the same-origin mutation gate from the inside, for the /security
demo. A browser can't forge its own Origin header, so this GET plays the
hostile page: it fires three POSTs at the app's own URLs with a mismatched
Origin — exactly the no-preflight CSRF shape the gate exists to stop — and
reports the statuses. createEcho (a normal mutation) and /__belte/mcp are
refused with 403 before any handler runs; trackPageview passes because it
declares `crossOrigin: true`.
*/
export const probeOriginGate = GET(async () => {
    const base = server().url
    const forged = async (path: string, body: string): Promise<number> => {
        const response = await fetch(new URL(path, base), {
            method: 'POST',
            headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
            body,
        })
        // Drain so the probe doesn't leak response bodies across three calls.
        await response.arrayBuffer()
        return response.status
    }
    return json({
        gatedMutation: await forged('/rpc/createEcho', '{"message":"forged"}'),
        crossOriginOptOut: await forged('/rpc/trackPageview', '{"pageUrl":"https://evil.example"}'),
        mcpEndpoint: await forged('/__belte/mcp', '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'),
    })
})
