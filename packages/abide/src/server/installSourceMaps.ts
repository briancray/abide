// 38.97 — A STACK FRAME IN A MODULE COMPILED FROM A `.abide` NAMES THE `.abide`. Bun reads no
// source map it is handed — not inline in a module a plugin serves, not on disk, not in the
// bundler — so the frame is placed here, through `Error.prepareStackTrace`, which bun calls for
// every `stack` read. Every other frame is written as bun writes it.
//
// INSTALLED ONCE PER PROCESS, the maps added to as apps boot: `abide dev` boots one worker per
// rebuild, and a test boots several apps in one process.

import { resolve } from 'node:path' // bun exposes no path helpers of its own
import { decodeMappings, placeAt, type Segment } from './sourceMappings.ts'

/** Per `.abide` below the root, as its server module is served there: the file, and its `mappings`. */
export type SourceMaps = Record<string, readonly [string, string]>

type Registered = {
    source: string
    mappings: string
    lines: Segment[][] | undefined
}

/** By the `.abide`'s path, which a frame in its served module names. */
const REGISTERED = new Map<string, Registered>()
/** An executable's files by their path below the root, for its frames, whose directory is not known. */
const BELOW = new Map<string, Registered>()

/**
 * Registers `maps`, the files below `base`, and places frames in them from now on.
 *
 * `base` is `undefined` for an executable, whose frames name each file as it was bundled.
 */
export function installSourceMaps(
    maps: SourceMaps,
    base: string | undefined,
): void {
    for (const [module, [source, mappings]] of Object.entries(maps)) {
        const registered = { source, mappings, lines: undefined }
        if (base !== undefined)
            REGISTERED.set(resolve(base, module), registered)
        else BELOW.set(module, registered)
    }
    if (Error.prepareStackTrace !== placeFrames)
        Error.prepareStackTrace = placeFrames
}

type CallSite = {
    getFileName(): string | undefined | null
    getLineNumber(): number | null
    getColumnNumber(): number | null
    getFunctionName(): string | null
    isAsync?(): boolean
}

function placeFrames(error: Error, frames: CallSite[]): string {
    let out = `${error.name}: ${error.message}`
    if (error.message === '' || error.message === undefined) out = error.name
    for (const frame of frames) {
        const name = frame.getFunctionName()
        const where = placed(frame)
        out += `\n    at ${frame.isAsync?.() ? 'async ' : ''}${name ? `${name} (${where})` : where}`
    }
    return out
}

// A call site's column counts from 0 where the stack bun writes counts from 1.
function placed(frame: CallSite): string {
    const file = frame.getFileName() ?? '<anonymous>'
    const line = frame.getLineNumber() ?? 0
    const column = frame.getColumnNumber() ?? 0
    const registered = registeredFor(file)
    if (registered !== undefined && line > 0) {
        registered.lines ??= decodeMappings(registered.mappings)
        const place = placeAt(registered.lines, line - 1, column)
        if (place !== undefined)
            return `${registered.source}:${place[0] + 1}:${place[1] + 1}`
    }
    return `${file}:${line}:${column + 1}`
}

function registeredFor(path: string): Registered | undefined {
    const found = REGISTERED.get(path)
    if (found !== undefined) return found
    // An executable's frames name the file as bun's own map does, relative to where it was
    // bundled from — so it is found by the path below the root it ends with.
    if (path.startsWith('/')) return undefined
    for (const [module, registered] of BELOW)
        if (path === module || path.endsWith(`/${module}`)) return registered
    return undefined
}
