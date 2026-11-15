// 38.186 — WHAT A NATIVE APP OPENED FROM THE FINDER PRINTS, kept for whoever reads it after — most
// often an agent, so the file is found by a fixed path, says at its top what wrote it and how its
// lines read, and is never bigger than one read.
//
// THE DESCRIPTORS, NOT `console`: launchd points stdout and stderr at /dev/null, and both are pointed
// at the file instead — every write lands there, either thread's `console`, `log` and bun's own crash
// report alike, as the two threads share them. Opened on the launcher's thread once `onConfig` is
// filed, so the folder follows `APP_DATA_DIR` as `native.json` does (38.73), and checked for size
// there too, since the window MUST NOT wake for a timer (38.179).

import { dlopen, FFIType } from 'bun:ffi'
import { closeSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs' // bun exposes no directory creation, rename or open answering a descriptor of its own
import { homedir } from 'node:os' // bun exposes no home directory of its own
import { isatty } from 'node:tty' // bun exposes no terminal check by descriptor, and a worker's `process.stdout` is not the process's

const SYSTEM = dlopen('/usr/lib/libSystem.B.dylib', {
    dup2: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
})

/** A file past this is set aside for a new one. */
const MAXIMUM_BYTES = 5 * 1024 * 1024
/** The files set aside, `<name>.1.log` the newest. */
const KEPT = 4
const CHECK_MILLISECONDS = 60_000

/**
 * Sets the last launch's log aside, points stdout and stderr at `<name>.log` under
 * `~/Library/Logs/<the last folder of dataDirectory>`, and sets it aside again whenever it outgrows
 * one read — or leaves them, answering `undefined`, where either is a terminal, which already shows
 * them.
 */
export function keepLogFile(
    dataDirectory: string,
    name: string,
    version: string,
): string | undefined {
    if (isatty(1) || isatty(2)) return undefined
    const folder = dataDirectory.split('/').findLast((part) => part !== '')
    const directory = `${homedir()}/Library/Logs/${folder ?? name}`
    mkdirSync(directory, { recursive: true })
    const path = `${directory}/${name}.log`
    begin(path, `${name} ${version} launched`)
    setInterval(() => {
        if (Bun.file(path).size > MAXIMUM_BYTES)
            begin(path, `${name} ${version} continued from ${name}.1.log`)
    }, CHECK_MILLISECONDS).unref()
    return path
}

/** Shifts the files set aside one older, dropping the oldest, and points output at a new `path`. */
function begin(path: string, opening: string): void {
    const stem = path.slice(0, -'.log'.length)
    for (let older = KEPT; older >= 1; older -= 1)
        try {
            renameSync(
                older === 1 ? path : `${stem}.${older - 1}.log`,
                `${stem}.${older}.log`,
            )
        } catch {
            // Fewer launches than `KEPT` have written one.
        }
    const file = openSync(path, 'w')
    writeSync(file, header(opening))
    SYSTEM.symbols.dup2(file, 1)
    SYSTEM.symbols.dup2(file, 2)
    closeSync(file)
}

// How a reader who has never seen the file reads it: what wrote it and when, how a `log` line is
// laid out in the format 36.8 picks off a terminal, and where the older files are.
function header(opening: string): string {
    const lines =
        process.env.ABIDE_LOG_FORMAT === 'json'
            ? 'a line from `log` is a JSON object: time, level, namespace, trace, message.'
            : 'a line from `log` is tab-separated: time, level, namespace, trace, message, a newline in the message written as \\n.'
    return `# ${opening} ${new Date().toISOString()}, pid ${process.pid}.
# ${lines} any other line is the app's own console, or the runtime's.
# older output is in the .1.log beside this file, then .2.log, up to .${KEPT}.log.
`
}
