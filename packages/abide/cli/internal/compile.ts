// `abide compile` — the app as ONE file you can copy to a machine with nothing on it.
//
// Three steps, and only the middle one is abide's: build the client the way `abide build` does,
// generate the server lane (`internal/binary.ts`), and hand that lane to `bun build --compile`. What
// comes out is the Bun runtime, this framework, the app, its pages, its bundle and its public files
// in a single executable — and its front door is the app's own console, so the same file serves the app
// and drives it.
//
// The client build is not optional and is not a flag. A binary whose `.abide/client` came from
// whatever was on the disk at compile time is a binary that ships one version of the pages and
// another of the bundle they hydrate with, which is the kind of mismatch that only shows up as a
// hydration error in front of somebody. So the build runs first, every time, and the manifest this
// reads is the one it just wrote.
//
// `--target` cross-compiles: Bun ships the runtime for another platform, so a linux binary is built
// on a laptop without one. The client build is the same bytes for every target — it is a browser
// bundle — which is why the loop is around the compile alone.

import { abidePlugin } from '#compiler/plugin.ts'
import { messageOf } from '#shared/internal/probes.ts'
import { appName } from '#shared/log.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { type ClientManifest, MANIFEST_FILE } from '../CLIENT_BUILD.ts'
import { refuse } from '../COMMANDS.ts'
import { type BinaryLane, binaryLane } from './binary.ts'
import { build } from './build.ts'
import { BOLD, colored, DIM, paint, plural } from './paint.ts'

/** What was asked for on the command line. `target` absent is this machine's own platform. */
interface Asked {
    out: string | null
    targets: string[]
}

export async function compile(argv: string[]): Promise<number> {
    const asked = optionsOf(argv)
    if (typeof asked === 'string') return refuse('compile', asked)

    const root = process.cwd()
    const name = appName()

    // The client first, and through the command rather than beside it: what a bundle CONTAINS is one
    // question, and a second copy of the answer here is a binary serving a lane `abide build` would
    // not have written.
    const built = await build([])
    if (built !== CLI_EXIT_CODES.ok) return built

    let manifest: ClientManifest | null
    try {
        manifest = (await Bun.file(`${root}/${MANIFEST_FILE}`).json()) as ClientManifest
    } catch {
        // An app with no pages writes no manifest, which is an app made of endpoints — a legitimate
        // thing to compile, and the one shape where there is nothing for a browser to be handed.
        manifest = null
    }

    let lane: BinaryLane
    try {
        lane = await binaryLane(root, manifest, name)
    } catch (failure) {
        console.error(`abide compile: the lane could not be written — ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }

    // One out per target. With one target the name is the name; with several it is a DIRECTORY, since
    // two platforms' binaries cannot both be one file.
    const several = asked.targets.length > 1
    const out = asked.out ?? name
    for (const target of asked.targets) {
        const outfile = target === '' ? out : several ? `${out}/${name}-${target}` : out
        const wrote = await compiled(lane.path, outfile, target)
        if (wrote !== CLI_EXIT_CODES.ok) return wrote
        await report(outfile, lane)
    }
    return CLI_EXIT_CODES.ok
}

/** One executable. `target` is `''` for this machine, which is what `compile: true` means to Bun. */
async function compiled(entry: string, outfile: string, target: string): Promise<number> {
    let out: Bun.BuildOutput
    try {
        out = await Bun.build({
            entrypoints: [entry],
            // `bun`, not `browser`: this is the SERVER lane, so a `server/rpc/**` module keeps its
            // body rather than eliding to its address — which is the one thing the plugin decides off
            // the target, and the whole reason the two lanes cannot share a build.
            target: 'bun',
            plugins: [abidePlugin],
            throw: false,
            // The JS build api does NOT imply `--production` the way the `--compile` FLAG does, so
            // both of these are off unless asked for. What they are worth, measured on the dogfood
            // app: boot to `listening` 51.2 ms -> 30.6 ms, and `<binary> help` 54.9 -> 32.9. The
            // saving is the parse and compile of the bundle, so it GROWS with the app while the
            // ~30 ms under it is Bun's own start — and the binary's front door is the app's console,
            // so an operator pays that start on every invocation rather than once per deploy. It
            // costs 13.3 MB of binary and 5.6 MB of RSS.
            bytecode: true,
            // Bytecode with no explicit format is CommonJS, and the lane is top-level `await` —
            // without this the build FAILS with "await can only be used inside an async function".
            format: 'esm',
            // Not for the bytes: minified names are what a stack trace would carry, and abide never
            // prints one — an rpc throw is `{name, message}` and an uncaught one is the lifecycle's
            // `unhandled: <message>`. So this is 0.9 MB with nothing lost, and `sourcemap` is 1.0 MB
            // with nothing GAINED until a stack reaches output.
            minify: true,
            compile: {
                outfile,
                ...(target === '' ? {} : { target: target as Bun.Build.CompileTarget }),
                // A binary you can copy to a machine with nothing on it must not read config out of
                // the directory somebody happened to launch it from. It does by default: a
                // `bunfig.toml` carrying `preload` in the working directory kills the app before it
                // starts (`error: preload not found`, exit 1), and this repo's own root bunfig would
                // quietly register happy-dom into a SERVER process. `.env` stays autoloaded — that
                // one is the app's own configuration seam, and `config()` reads it at runtime.
                autoloadBunfig: false,
            },
        })
    } catch (failure) {
        console.error(`abide compile: ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }
    if (!out.success) {
        for (const message of out.logs) console.error(String(message))
        return CLI_EXIT_CODES.failed
    }
    return CLI_EXIT_CODES.ok
}

/**
 * Two lines: the file, and what is inside it.
 *
 * The same shape `abide build` and a bind both report with, because it answers the same question —
 * what did this produce. The counts are what a binary is actually made of, and the one that catches
 * a mistake is `0 rpc`: a transport directory that was renamed scans to nothing, and a binary with
 * no endpoints in it looks exactly like a successful compile until something calls one.
 */
async function report(outfile: string, lane: BinaryLane): Promise<void> {
    const on = colored()
    const size = await Bun.file(outfile)
        .stat()
        .then((stat) => stat.size)
        .catch(() => 0)
    console.log(
        `compiled ${paint(outfile, BOLD, on)} ${paint(`${(size / 1_000_000).toFixed(1)} MB`, DIM, on)}`,
    )

    const parts: string[] = []
    if (lane.entry !== null) parts.push(lane.entry)
    if (lane.pages > 0) parts.push(plural(lane.pages, 'page'))
    if (lane.endpoints > 0) parts.push(`${plural(lane.endpoints, 'transport module')}`)
    parts.push(lane.assets === 0 ? 'no client bundle' : `${plural(lane.assets, 'file')} embedded`)
    if (lane.publics > 0) parts.push(`${plural(lane.publics, 'public file')}`)
    console.log(paint(`  ${parts.join(' · ')}`, DIM, on))
}

/**
 * `--out <path>` and `--target <t>`, and nothing else — the command IS the compile.
 *
 * NOT `calls.ts`'s `flagsOf`, and the invariant is what separates them: there a bare `--live` is
 * `true` because the endpoint's declared shape refuses one that should have been a string, and this
 * command has no shape to ask. So a bare `--out` is a value somebody forgot rather than a boolean,
 * and the unknown name it would otherwise accept is a typo that compiles to the wrong place.
 */
function optionsOf(argv: string[]): Asked | string {
    const asked: Asked = { out: null, targets: [] }
    for (let i = 0; i < argv.length; i++) {
        const argument = argv[i] as string
        const cut = argument.indexOf('=')
        const name = cut === -1 ? argument : argument.slice(0, cut)
        const written = cut === -1 ? argv[++i] : argument.slice(cut + 1)
        if (written === undefined) return `${name} needs a value`
        if (name === '--out') asked.out = written
        else if (name === '--target') asked.targets.push(written)
        else return `unknown option \`${name}\``
    }
    // Nothing named is THIS machine, spelled as the empty target so the loop below has one pass.
    if (asked.targets.length === 0) asked.targets.push('')
    return asked
}
