// THE BUN→NODE BRIDGE for the tsgo sync API — one mechanism, two callers.
//
// The tsgo `API` cannot open its pipe under Bun, so any code that needs the type checker while running
// under Bun has to re-exec ITSELF under node, hand its request over on stdin, and read the answer back on
// stdout. Two places need that — `cli/check.ts` (project diagnostics) and
// `server/internal/deriveSchema.ts` (type-derived input/output schemas) — and each implemented the whole
// of it: a `globalThis as { Bun: … }` cast, a result marker, a `lastIndexOf(marker)` + slice-to-newline
// scrape, an `import.meta.main` responder, and a near-identical paragraph explaining why any of it exists.
//
// Two things followed from that, and only one of them was defensible:
//
//   - THE DEADLOCK LESSON lived in one copy. `deriveSchema` drains stdout and stderr CONCURRENTLY with
//     the exit, with a comment recording why: "a subprocess that fills the stderr pipe buffer blocks
//     until it is read, and it never exits". `check.ts` used `spawnSync`, which is safe for a different
//     reason (Bun buffers both pipes for you) — so the next bridge would inherit whichever it happened to
//     copy. The async drain is the one that generalises, and both callers are async, so it is the only
//     one here.
//   - THE FAILURE POLICY differed with no stated reason: `check.ts` threw on a missing marker,
//     `deriveSchema` degraded to a per-entry warning. That difference is REAL and belongs to the callers
//     — a type check that cannot run has nothing to report, while schema derivation has a documented
//     "loud but non-fatal" fallback — so this module has ONE failure (a thrown `NodeBridgeError`) and the
//     policy is a `catch` at the two call sites, where a reader can see which is which.
//
// STRIP-ONLY SAFE, and that is a hard constraint rather than a preference: `cli/check.ts` re-executes
// ITSELF under node with types stripped, so anything it imports must be valid JS once the annotations are
// removed (no enums, no parameter properties) and must not touch `Bun` at module load.

// Marker rather than "parse the whole of stdout": the subprocess is a real program that may print
// anything on the way (a tsgo warning, a node deprecation), and only the last line we wrote is ours.
// `lastIndexOf` for the same reason — a request that happens to contain the marker string cannot displace
// the real result.
const RESULT_MARKER = '__ABIDE_NODE_RESULT__:'

export class NodeBridgeError extends Error {
    // The subprocess's stderr, trimmed — the only diagnostic there is when no result came back.
    readonly stderr: string
    constructor(what: string, stderr: string) {
        super(`${what}: node subprocess produced no result${stderr ? ` (stderr: ${stderr})` : ''}`)
        this.name = 'NodeBridgeError'
        this.stderr = stderr
    }
}

// Are we the Bun side? The whole point of the bridge is that the answer decides which path a caller
// takes, so it is asked here rather than spelled as a `globalThis` cast per caller.
export function underBun(): boolean {
    return (globalThis as { Bun?: unknown }).Bun !== undefined
}

interface BunSpawn {
    spawn: (
        cmd: string[],
        options: { stdin: Uint8Array; stdout: 'pipe'; stderr: 'pipe' },
    ) => {
        stdout: ReadableStream<Uint8Array>
        stderr: ReadableStream<Uint8Array>
        exited: Promise<number>
    }
}

// Re-exec `self` under node with `argv` appended, send `payload` as JSON on stdin, and return the JSON it
// wrote after the marker. `what` names the caller in a failure message.
export async function askNode<Request, Response>(input: {
    self: string
    argv: string[]
    payload: Request
    what: string
}): Promise<Response> {
    const bun = (globalThis as unknown as BunSpawn & { Bun: BunSpawn }).Bun
    const proc = bun.spawn(['node', input.self, ...input.argv], {
        stdin: new TextEncoder().encode(JSON.stringify(input.payload)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    // Concurrently, NOT in sequence — see the header. A sequential read of stdout followed by stderr
    // deadlocks on a subprocess that fills the stderr pipe buffer, wherever the pipes are not buffered
    // for us. `nodeTypeBridge.test.ts` covers the flooding subprocess and says plainly that it does not
    // discriminate this ordering under Bun: the concurrent form is here because it is correct without
    // depending on the runtime to buffer, not because a test would catch the other one.
    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    const markerAt = stdout.lastIndexOf(RESULT_MARKER)
    if (markerAt === -1) throw new NodeBridgeError(input.what, stderr.trim())
    const jsonStart = markerAt + RESULT_MARKER.length
    const jsonEnd = stdout.indexOf('\n', jsonStart)
    return JSON.parse(
        stdout.slice(jsonStart, jsonEnd === -1 ? undefined : jsonEnd),
    ) as unknown as Response
}

// The NODE half. Read the JSON request off stdin, hand it to `handler`, and write the answer after the
// marker. Called from an `import.meta.main` guard in the module the Bun side re-executes — the same module,
// which is what keeps the request and response shapes from needing a second declaration anywhere.
export async function answerAsNode<Request, Response>(
    handler: (request: Request) => Response,
): Promise<void> {
    const chunks: Uint8Array[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array)
    const text = Buffer.concat(chunks).toString('utf8')
    const response = handler(JSON.parse(text) as Request)
    process.stdout.write(`${RESULT_MARKER}${JSON.stringify(response)}\n`)
}
