// `abide-bridge install`: WHAT OPENS PAIRING LINKS ON THIS COMPUTER, built here rather than downloaded,
// with the handler it starts (`opened.ts`, bundled into one file so nothing it imports can be left
// behind) and what install found beside it. Each desktop registers a scheme its own way (44.43):
//
// MACOS hands a URL to an app as an Apple Event, never as an argument, so the app is an AppleScript
// applet (`osacompile`, on every Mac) whose `open location` starts the handler with the link. Built
// here, it carries no quarantine and Gatekeeper never reads it; ad-hoc signed whole after its
// `Info.plist` is changed, as `abide bundle` signs its own, since an edited bundle whose signature no
// longer matches is one macOS reads as damaged. In Application Support, not an Applications folder: it
// is nothing to open by hand, and Launch Services finds a handler there only once it is registered.
//
// LINUX reads a desktop entry claiming `x-scheme-handler/abide-bridge`, made the default with
// `xdg-mime`. WINDOWS reads the scheme from the visitor's own registry classes.

import { rm } from 'node:fs/promises' // bun has no recursive remove of its own

import type { HandlerSettings } from './opened.ts'
import { PAIRING_SCHEME } from './pairingLink.ts'

const APP_NAME = 'abide bridge'
export const IDENTIFIER = 'abide.bridge'
const DESKTOP_ENTRY = 'abide-bridge.desktop'
const LAUNCH_SERVICES =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const REGISTRY_KEY = `HKCU\\Software\\Classes\\${PAIRING_SCHEME}`

/** The handler install bundles into `directory`, which the desktop starts. */
export function handlerIn(directory: string): string {
    return `${directory}/handler/opened.js`
}

/** The directory the handler and what it keeps — its settings, the sites it always allows — are in. */
export function handlerDirectory(directory: string): string {
    return `${directory}/handler`
}

/** Where `XDG_DATA_HOME` points, or its default under the visitor's home. */
function dataHome(): string {
    const declared = Bun.env.XDG_DATA_HOME
    return declared === undefined || declared === ''
        ? `${Bun.env.HOME ?? ''}/.local/share`
        : declared
}

/**
 * `mimeapps.list` as `list` reads, with the desktop entry no longer the scheme's default — `xdg-mime`
 * sets a default and has no way to unset one, and a default naming a removed entry opens nothing.
 */
export function withoutDefault(list: string): string {
    const key = `x-scheme-handler/${PAIRING_SCHEME}=`
    const lines: string[] = []
    for (const line of list.split('\n')) {
        const entries = line.startsWith(key)
            ? line.slice(key.length).split(';')
            : []
        if (!entries.includes(DESKTOP_ENTRY)) {
            lines.push(line)
            continue
        }
        const kept: string[] = []
        for (const entry of entries)
            if (entry !== '' && entry !== DESKTOP_ENTRY) kept.push(entry)
        if (kept.length > 0) lines.push(`${key}${kept.join(';')};`)
    }
    return lines.join('\n')
}

/** Unregisters the Linux desktop entry: no longer the scheme's default, and gone. */
async function uninstallLinux(directory: string): Promise<void> {
    const declared = Bun.env.XDG_CONFIG_HOME
    const list = Bun.file(
        `${declared === undefined || declared === '' ? `${Bun.env.HOME ?? ''}/.config` : declared}/mimeapps.list`,
    )
    if (await list.exists()) {
        const written = await list.text()
        const unregistered = withoutDefault(written)
        if (unregistered !== written) await Bun.write(list, unregistered)
    }
    await rm(entryPath(directory, true), { force: true })
}

/** Where install writes, under the visitor's own home on each desktop. */
export function installDirectory(
    platform: NodeJS.Platform = process.platform,
): string {
    if (platform === 'win32')
        return `${Bun.env.LOCALAPPDATA ?? `${Bun.env.USERPROFILE ?? ''}\\AppData\\Local`}\\abide-bridge`
    if (platform === 'linux') return `${dataHome()}/abide-bridge`
    return `${Bun.env.HOME ?? ''}/Library/Application Support/abide-bridge`
}

/** The app install writes into `directory`, on macOS. */
export function appIn(directory: string): string {
    return `${directory}/${APP_NAME}.app`
}

/** `text` as an AppleScript string literal. */
function appleScriptString(text: string): string {
    return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** The applet's source: a link opened starts the handler with it, in the background. */
function appletSource(bun: string, directory: string): string {
    const handler = appleScriptString(handlerIn(directory))
    return `on open location theURL
\tdo shell script quoted form of ${appleScriptString(bun)} & " " & quoted form of ${handler} & " " & quoted form of theURL & " > /dev/null 2>&1 &"
end open location

on run
\tdisplay dialog "abide bridge opens the pairing links abide sites show, so your Claude Code can be their assistant. There is nothing to do here." buttons {"OK"} default button "OK" with title "abide bridge"
end run
`
}

/**
 * `argument` quoted as a desktop entry's `Exec` reads one: its quoting escapes first, then the string
 * escape that doubles every backslash again, and `%` doubled so it is never read as a field code.
 */
function execArgument(argument: string): string {
    const quoted = argument.replace(/(["`$\\])/g, '\\$1')
    return `"${quoted.replaceAll('\\', '\\\\').replaceAll('%', '%%')}"`
}

/** The desktop entry that opens the scheme on Linux, starting the handler with the link. */
export function desktopEntry(bun: string, directory: string): string {
    return `[Desktop Entry]
Type=Application
Name=${APP_NAME}
Exec=${execArgument(bun)} ${execArgument(handlerIn(directory))} %u
NoDisplay=true
Terminal=false
MimeType=x-scheme-handler/${PAIRING_SCHEME};
`
}

/** The commands that register the scheme in the visitor's own registry classes on Windows. */
export function registryCommands(bun: string, directory: string): string[][] {
    const handler = handlerIn(directory).replaceAll('/', '\\')
    return [
        ['reg', 'add', REGISTRY_KEY, '/ve', '/d', `URL:${APP_NAME}`, '/f'],
        ['reg', 'add', REGISTRY_KEY, '/v', 'URL Protocol', '/d', '', '/f'],
        [
            'reg',
            'add',
            `${REGISTRY_KEY}\\shell\\open\\command`,
            '/ve',
            '/d',
            `"${bun}" "${handler}" "%1"`,
            '/f',
        ],
    ]
}

/** Runs one of the desktop's own tools, throwing with what it wrote where it fails. */
async function tool(command: string[]): Promise<void> {
    const child = Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe' })
    const [code, said] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
    ])
    if (code !== 0) throw new Error(`${command[0]} failed: ${said.trim()}`)
}

/** Throws where this is a desktop no pairing link opens on. */
function supported(): void {
    if (
        process.platform !== 'darwin' &&
        process.platform !== 'linux' &&
        process.platform !== 'win32'
    )
        throw new Error(
            `pairing links open on macOS, Linux and Windows, and this is ${process.platform}. The command a site shows pairs from any terminal.`,
        )
}

/** Where install and uninstall work, and whether they register with the desktop — a test's own directory, unregistered. */
type Placement = { directory?: string; register?: boolean }

/** Builds the macOS applet into `directory`, answering where it is. */
async function installMac(
    settings: HandlerSettings,
    directory: string,
    register: boolean,
): Promise<string> {
    const app = appIn(directory)
    const source = `${handlerDirectory(directory)}/applet.applescript`
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
    if (register) await tool([LAUNCH_SERVICES, '-f', app])
    return app
}

/** The desktop entry's path: in `directory` where install is not registering, else the visitor's applications. */
function entryPath(directory: string, register: boolean): string {
    return register
        ? `${dataHome()}/applications/${DESKTOP_ENTRY}`
        : `${directory}/${DESKTOP_ENTRY}`
}

/** Writes the Linux desktop entry, and makes it the scheme's default, answering where it is. */
async function installLinux(
    settings: HandlerSettings,
    directory: string,
    register: boolean,
): Promise<string> {
    const entry = entryPath(directory, register)
    await Bun.write(entry, desktopEntry(settings.bun, directory))
    if (register)
        await tool([
            'xdg-mime',
            'default',
            DESKTOP_ENTRY,
            `x-scheme-handler/${PAIRING_SCHEME}`,
        ])
    return entry
}

/**
 * Builds what opens pairing links into `directory`, with the handler it starts beside it, and
 * registers it with the desktop unless `register` is false. Answers what was registered.
 */
export async function install(
    settings: HandlerSettings,
    options: Placement = {},
): Promise<string> {
    supported()
    const directory = options.directory ?? installDirectory()
    const register = options.register !== false
    const bundled = await Bun.build({
        entrypoints: [`${import.meta.dir}/opened.ts`],
        outdir: handlerDirectory(directory),
        target: 'bun',
    })
    if (!bundled.success)
        throw new Error(
            `the link handler did not bundle: ${bundled.logs.join('\n')}`,
        )
    await Bun.write(
        `${handlerDirectory(directory)}/settings.json`,
        JSON.stringify(settings, null, 4),
    )
    if (process.platform === 'darwin')
        return installMac(settings, directory, register)
    if (process.platform === 'linux')
        return installLinux(settings, directory, register)
    if (register)
        for (const command of registryCommands(settings.bun, directory))
            await tool(command)
    return REGISTRY_KEY
}

/**
 * Unregisters what install registered from `directory` and removes everything install wrote there — the
 * removal runs even where the desktop refuses, and the refusal is thrown after it.
 */
export async function uninstall(options: Placement = {}): Promise<void> {
    supported()
    const directory = options.directory ?? installDirectory()
    const register = options.register !== false
    try {
        if (process.platform === 'darwin') {
            const app = appIn(directory)
            if (
                register &&
                (await Bun.file(`${app}/Contents/Info.plist`).exists())
            )
                await tool([LAUNCH_SERVICES, '-u', app])
        } else if (process.platform === 'linux') {
            // Unregistered, the entry is in `directory`, which goes below.
            if (register) await uninstallLinux(directory)
        } else if (register) await tool(['reg', 'delete', REGISTRY_KEY, '/f'])
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
