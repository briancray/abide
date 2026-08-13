// What `abide build` wrote, as something that answers requests.
//
// The manifest is the ALLOWLIST, and that is the whole security story of this file: a name is served
// because the build recorded it, not because it resolved to a file under a directory. There is no
// path to normalise, no `..` to reject and no symlink to worry about — `/__abide/client/../../.env`
// is simply a name the manifest does not have.
//
// Everything else here is a consequence of the hash being in the FILENAME. An address that can only
// ever mean one set of bytes is cacheable forever, so the headers and the file handles are built
// ONCE per asset per encoding at load and the per-request work is a map lookup. That is also why there
// is no ETag and no `If-None-Match`: a revalidation is a round trip to be told what `immutable`
// already said, and the one thing that changes on a rebuild is the name.
//
// Not part of `dispatch`, which serves ENDPOINTS. This is a directory, it exists only where a build
// ran, and `abide dev` serves the same route out of a bundler's memory rather than off a disk — so
// it is mounted in front of the request pipeline rather than inside it.
//
// Which is why a form holds a `Blob` rather than a path: a `BunFile` IS one, and so is a build
// artifact that was never written down. The two lanes differ in where the bytes came from and in one
// header, and in nothing a request can see.

// `node:path` stands in for nothing: Bun ships no path api, and the builtin IS the supported one.
import { basename } from 'node:path'
import { mountBase } from '$shared/internal/mount.ts'
import { acceptedEncoding } from '$shared/internal/wire.ts'
import {
    assetOf,
    CLIENT_DIR,
    CLIENT_ROUTE,
    type ClientAsset,
    type ClientGraph,
    type ClientManifest,
    type Encoding,
    MANIFEST_FILE,
} from '../CLIENT_BUILD.ts'

/**
 * One form of one asset: what to read, and the headers that describe it.
 *
 * The handle rather than the path. A `BunFile` is a lazy reference and every `Response` built from
 * one reads independently, so there is nothing per-request about it — and the name carries a content
 * hash, which means the bytes at this path cannot change for the life of the process. A dev build's
 * bytes are a `Blob` over the same seam, held rather than re-read.
 */
interface Form {
    file: Blob
    headers: Record<string, string>
    /** `null` on the identity bytes; what an `Accept-Encoding` is matched against on the rest. */
    encoding: Encoding | null
}

/** The identity bytes, and the precompressed forms beside them — smallest first, as the build left them. */
interface Held {
    identity: Form
    encoded: Form[]
    /**
     * `encoded`'s encodings, in its order — what `acceptedEncoding` is asked, and an index into it is
     * an index into `encoded`. Built once at boot rather than per request: the asset path answers
     * every module a page loads, and this is the only allocation the negotiation would have needed.
     */
    names: string[]
}

/**
 * The bundle, ready to serve.
 *
 * A class rather than an object literal closing over the load, because this lives as long as the
 * process does: a closure would keep `root`, the output directory and the manifest's own `BunFile`
 * reachable for the whole run, and what answering a request needs is the map.
 */
export class ClientAssets {
    /** The name-to-forms allowlist. Everything else about the build was spent building it. */
    private readonly held: Map<string, Held>

    constructor(held: Map<string, Held>) {
        this.held = held
    }

    /** How many files the manifest named. What the command prints, so an operator sees a build arrived. */
    get count(): number {
        return this.held.size
    }

    /** The answer, or `undefined` when the path is not under `/__abide/client/` at all. */
    serve(request: Request): Response | undefined {
        // The raw URL text first, exactly as `dispatch` does it: an app's own request pays one
        // substring test for the bundle existing rather than a URL parse. The test is a cheap
        // SUPERSET — a query string could carry the prefix — so the parsed pathname decides.
        if (!request.url.includes(CLIENT_ROUTE)) return undefined
        // Against the MOUNTED prefix, exactly as `dispatch` does it and for the same reason: the
        // document asked for `/v2/__abide/client/x.js`, the file this build wrote is still `x.js`, and
        // the bundle is not also served at the origin root.
        const at = new URL(request.url).pathname
        const base = mountBase()
        if (!at.startsWith(base)) return undefined
        const path = at.slice(base.length)
        if (!path.startsWith(CLIENT_ROUTE)) return undefined

        const asset = this.held.get(path.slice(CLIENT_ROUTE.length))
        // Answered here rather than handed on: past the prefix the request is ours, and a page
        // asking for a chunk this build does not have is a stale document rather than a route the
        // app might know. Plain text, not the JSON refusal the endpoints answer with — what reads
        // this is a browser fetching a script, and the status is the whole of what it acts on.
        if (asset === undefined) return new Response(`nothing is built at ${path}\n`, { status: 404 })
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
        }

        const form = chosen(asset, request.headers.get('accept-encoding'))
        return new Response(form.file, { headers: form.headers })
    }
}

/** A loaded build: what answers requests, and what the manifest said, which the caller keeps or drops. */
export interface LoadedClient {
    assets: ClientAssets
    manifest: ClientManifest
}

/**
 * The bundle at `root`, ready to serve — or `null` when no build has been written there.
 *
 * `null` rather than a throw for the MISSING case, because "nothing has been built" is a state a
 * caller decides about: an app with no client entry is a legitimate app, and one with a client entry
 * and no build is a mistake. Only the caller knows which of those it is looking at. A manifest that
 * is there and unreadable throws, because that is a build to fix rather than a build to do.
 *
 * The manifest comes back BESIDE the assets rather than on them. It is read once — an `app.html`
 * naming its sources is cut at boot — and holding it on the thing that outlives the boot would keep
 * a record per built file reachable for the life of the process, which is the retention this class
 * exists to avoid.
 */
export async function clientAssets(root: string): Promise<LoadedClient | null> {
    const file = Bun.file(`${root}/${MANIFEST_FILE}`)
    if (!(await file.exists())) return null
    const manifest = (await file.json()) as ClientManifest
    const directory = `${root}/${CLIENT_DIR}`

    const held = new Map<string, Held>()
    for (const name in manifest.assets)
        held.set(name, formsOf(directory, name, manifest.assets[name] as ClientAsset))

    return { assets: new ClientAssets(held), manifest }
}

/**
 * A build that was never written down — what `abide dev` serves.
 *
 * The artifacts come straight off `Bun.build`, so the whole of the difference from the lane above is
 * where the bytes live and what the `cache-control` says. There are no sidecars: compression is the
 * expensive half of `abide build` and it buys nothing over a loopback, so a dev asset has the one
 * form and `chosen` hands it back without reading an `Accept-Encoding` at all.
 *
 * The bytes are taken ONCE here rather than left on the artifact. A `BuildArtifact` is a `Blob` and
 * would serve directly, but the whole build stays reachable through it — and this holds the map for
 * the life of the process.
 */
export async function heldClient(
    outputs: Bun.BuildArtifact[],
    entries: Record<string, string>,
    graph: ClientGraph | undefined,
): Promise<LoadedClient> {
    // Every artifact at once. The bytes are already in memory, so this is a promise tick per artifact
    // rather than a read — and one artifact waiting on the one before it is a tick per chunk charged
    // to every save.
    const pending: Promise<ArrayBuffer>[] = []
    for (const artifact of outputs) pending.push(artifact.arrayBuffer())
    const drained = await Promise.all(pending)

    const held = new Map<string, Held>()
    const assets: Record<string, ClientAsset> = {}
    for (let at = 0; at < outputs.length; at++) {
        const artifact = outputs[at] as Bun.BuildArtifact
        const bytes = drained[at] as ArrayBuffer
        const name = basename(artifact.path)
        assets[name] = assetOf(artifact, bytes.byteLength, [])
        held.set(name, {
            identity: {
                file: new Blob([bytes], { type: artifact.type }),
                headers: {
                    'content-type': artifact.type,
                    'cache-control': NEVER,
                    'x-content-type-options': NOSNIFF,
                },
                encoding: null,
            },
            encoded: NO_FORMS,
            names: NO_NAMES,
        })
    }
    return { assets: new ClientAssets(held), manifest: { entries, assets, graph } }
}

/**
 * A dev asset is never kept.
 *
 * The opposite of `FOREVER` below, and for the same reason: a name is only cacheable when it can
 * mean one set of bytes, and a dev entry keeps its SOURCE name across rebuilds so that a breakpoint
 * and a stack frame survive one. Something has to give, and it is the cache — a stale chunk behind a
 * hash-free address is a bug hunt that ends in a hard refresh.
 */
const NEVER = 'no-store'

/** Shared because neither is ever written to: every dev asset has exactly the identity form. */
const NO_FORMS: Form[] = []
const NO_NAMES: string[] = []

/**
 * A year, and `immutable` on top of it.
 *
 * The two say different things and both are needed: `max-age` is how long a cache may serve this
 * without asking, and `immutable` is the promise that asking would be pointless — which is what stops
 * a browser revalidating the whole bundle on every reload. Both are true because the name carries a
 * content hash, and neither would be safe for a second without it.
 */
const FOREVER = 'public, max-age=31536000, immutable'

/**
 * Spelled here as well as in `headersFor`, because this route never reaches it: the bundle is served
 * in FRONT of the request pipeline, so nothing it answers goes through the funnel every other abide
 * response does. This is the route that most needs it — a chunk is JavaScript, and a browser that
 * sniffs one it was handed under the wrong type is executing it on this origin.
 */
const NOSNIFF = 'nosniff'

function formsOf(directory: string, name: string, asset: ClientAsset): Held {
    // The identity form's type for every form of it. A `.br` sidecar is the same JavaScript compressed
    // — `Content-Encoding` is what says how — and Bun would otherwise read the type off the `.br`
    // extension and hand a browser an octet-stream it will not execute.
    //
    // `vary` even on the form that has no encoding: a shared cache that stored this one without it
    // would go on serving identity bytes to a caller that asked for brotli, and to one that did not
    // ask at all. The header describes what the ANSWER depends on, not what this answer used.
    const shared = {
        'content-type': asset.type,
        'cache-control': FOREVER,
        vary: 'accept-encoding',
        'x-content-type-options': NOSNIFF,
    }
    const identity: Form = { file: Bun.file(`${directory}/${name}`), headers: shared, encoding: null }
    const encoded: Form[] = []
    const names: string[] = []
    for (const sidecar of asset.encodings) {
        encoded.push({
            file: Bun.file(`${directory}/${sidecar.file}`),
            headers: { ...shared, 'content-encoding': sidecar.encoding },
            encoding: sidecar.encoding,
        })
        names.push(sidecar.encoding)
    }
    return { identity, encoded, names }
}

/**
 * The best form this caller accepts.
 *
 * The header reading is `acceptedEncoding`'s, shared with the streamed responses `page()` compresses
 * — see there for why a `q=0` is the one weight that decides anything and why `*` is not an
 * invitation. What is local is the RANKING: `encoded` is smallest-first out of the build, so the
 * order the build wrote is already the order to prefer, and the index comes back against it.
 *
 */
function chosen(asset: Held, accepted: string | null): Form {
    const best = acceptedEncoding(accepted, asset.names)
    return best < 0 ? asset.identity : (asset.encoded[best] as Form)
}
