// `abide-bridge install`: AN APP THAT OPENS PAIRING LINKS, built on this Mac rather than downloaded. A
// URL reaches a macOS app as an Apple Event, never as an argument, so the app is an AppleScript applet
// (`osacompile`, on every Mac) whose `open location` starts the handler (`opened.ts`, bundled into one
// file so nothing it imports can be left behind) with the link. Built here, it carries no quarantine and Gatekeeper never reads it; ad-hoc signed whole after
// its `Info.plist` is changed, as `abide bundle` signs its own, since an edited bundle whose signature
// no longer matches is one macOS reads as damaged.
//
// IN APPLICATION SUPPORT, NOT AN APPLICATIONS FOLDER (44.43): it is nothing to open by hand, and Launch
// Services finds a handler there only once it is registered, so install registers it and uninstall
// takes it away again.

import { rm } from 'node:fs/promises' // bun has no recursive remove of its own

import type { HandlerSettings } from './opened.ts'
import { PAIRING_SCHEME } from './pairingLink.ts'

const APP_NAME = 'abide bridge'
export const IDENTIFIER = 'abide.bridge'
const LAUNCH_SERVICES =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
/** The handler install bundles into `directory`, which the applet starts. */
export function handlerIn(directory: string): string {
    return `${directory}/handler/opened.js`
}

/** Where install writes, under the visitor's home. */
export function installDirectory(): string {
    return `${Bun.env.HOME ?? ''}/Library/Application Support/abide-bridge`
}

/** The app install writes into `directory`. */
export function appIn(directory: string): string {
    return `${directory}/${APP_NAME}.app`
}

/** `text` as an AppleScript string literal. */
function appleScriptString(text: string): string {
    return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** The applet's source: a link opened starts the handler with it, in the background, into the log. */
function appletSource(bun: string, directory: string): string {
    const handler = appleScriptString(handlerIn(directory))
    const log = appleScriptString(`${directory}/bridge.log`)
    return `on open location theURL
\tdo shell script quoted form of ${appleScriptString(bun)} & " " & quoted form of ${handler} & " " & quoted form of theURL & " >> " & quoted form of ${log} & " 2>&1 &"
end open location

on run
\tdisplay dialog "abide bridge opens the pairing links abide sites show, so your Claude Code can be their assistant. There is nothing to do here." buttons {"OK"} default button "OK" with title "abide bridge"
end run
`
}

/** Runs one of macOS's own tools, throwing with what it wrote where it fails. */
async function tool(command: string[]): Promise<void> {
    const child = Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe' })
    const [code, said] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
    ])
    if (code !== 0) throw new Error(`${command[0]} failed: ${said.trim()}`)
}

/** Throws where this is not macOS, the one place a pairing link opens. */
function onMac(): void {
    if (process.platform !== 'darwin')
        throw new Error(
            `pairing links open on macOS, and this is ${process.platform}. The command a site shows pairs from any terminal.`,
        )
}

/** Where install and uninstall work, and whether they touch Launch Services — a test's own directory, unregistered. */
type Placement = { directory?: string; register?: boolean }

/**
 * Builds the app that opens pairing links into `directory`, with the handler it starts beside it, and
 * registers it with Launch Services unless `register` is false.
 */
export async function install(
    settings: HandlerSettings,
    options: Placement = {},
): Promise<string> {
    onMac()
    const directory = options.directory ?? installDirectory()
    const app = appIn(directory)
    const bundled = await Bun.build({
        entrypoints: [`${import.meta.dir}/opened.ts`],
        outdir: `${directory}/handler`,
        target: 'bun',
    })
    if (!bundled.success)
        throw new Error(
            `the link handler did not bundle: ${bundled.logs.join('\n')}`,
        )
    await Bun.write(
        `${directory}/handler/settings.json`,
        JSON.stringify(settings, null, 4),
    )
    const source = `${directory}/handler/applet.applescript`
    await Bun.write(source, appletSource(settings.bun, directory))
    await rm(app, { recursive: true, force: true })
    await tool(['osacompile', '-o', app, source])
    const plist = `${app}/Contents/Info.plist`
    for (const [key, type, value] of [
        ['CFBundleIdentifier', '-string', IDENTIFIER],
        ['LSUIElement', '-bool', 'YES'],
        [
            'CFBundleURLTypes',
            '-json',
            JSON.stringify([
                {
                    CFBundleURLName: 'abide bridge pairing',
                    CFBundleURLSchemes: [PAIRING_SCHEME],
                },
            ]),
        ],
    ] as const)
        await tool(['plutil', '-replace', key, type, value, plist])
    await tool(['codesign', '--force', '--sign', '-', app])
    if (options.register !== false) await tool([LAUNCH_SERVICES, '-f', app])
    return app
}

/**
 * Unregisters the app install built in `directory` and removes everything install wrote there — the
 * removal runs even where Launch Services refuses, and the refusal is thrown after it.
 */
export async function uninstall(options: Placement = {}): Promise<void> {
    onMac()
    const directory = options.directory ?? installDirectory()
    const app = appIn(directory)
    try {
        if (
            options.register !== false &&
            (await Bun.file(`${app}/Contents/Info.plist`).exists())
        )
            await tool([LAUNCH_SERVICES, '-u', app])
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
