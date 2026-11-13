// SECTION 44 — the pairing link a site shows beside its command, as the bridge opens it: which links it
// reads (44.41), what it asks and runs (44.42), and the app `abide-bridge install` builds to open them
// (44.43), built into a directory of the test's own and never registered with Launch Services.

import { afterAll, expect, test } from 'bun:test'
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { spawned } from '@abide/harness/gate'

import {
    allowAlways,
    allowedAs,
    allowedSites,
    forget,
} from '../../bridge/src/allowedSites.ts'
import { linuxQuestion } from '../../bridge/src/desktop.ts'
import { grantOf, visitorServers } from '../../bridge/src/grant.ts'
import {
    appIn,
    checkoutHandler,
    checkoutOf,
    desktopEntry,
    handlerIn,
    IDENTIFIER,
    install,
    registryCommands,
    uninstall,
    withoutDefault,
} from '../../bridge/src/install.ts'
import {
    bridgeArguments,
    iconOf,
    question,
    searchPath,
    unservedOf,
} from '../../bridge/src/opened.ts'
import { PAIRING_SCHEME } from '../../bridge/src/PAIRING_SCHEME.ts'
import { type Pairing, pairingOf } from '../../bridge/src/pairingLink.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const PAIRING: Pairing = {
    site: 'https://crm.example/app',
    code: 'abc_DEF-123',
    version: '0.4.0',
    tools: ['WebSearch', 'WebFetch'],
    full: false,
}

/** What the visitor reads of a question: its headline, then its body. */
function said(asked: { headline: string; body: string }): string {
    return `${asked.headline}\n\n${asked.body}`
}

function linkOf(fields: Record<string, string>): string {
    return `${PAIRING_SCHEME}://pair?${new URLSearchParams(fields)}`
}

// A link asks for full access only by naming it, so the plain one names nothing of it.
const { full: _full, ...LINKED } = PAIRING
const GOOD = { ...LINKED, tools: PAIRING.tools.join(',') }

const SETTINGS = {
    bun: '/opt/bun/bin/bun',
    claude: '/opt/claude/claude',
    path: '/opt/node/bin:/opt/bun/bin:/usr/bin',
    claudeArgs: [],
    full: false,
    env: {},
}

// What a visitor gave install for every link: their own MCP servers, and a host one of them reads.
const KEPT = {
    ...SETTINGS,
    claudeArgs: ['--mcp-config', '/Users/me/sources.mcp.json'],
    env: { GH_HOST: 'github.example', GH_TOKEN: 'secret-token' },
}

test('a link is read as the pairing it names — 44.41', () => {
    expect(pairingOf(linkOf(GOOD))).toEqual(PAIRING)
    expect(pairingOf(linkOf({ ...GOOD, full: '1' }))?.full).toBe(true)
    const { tools: _tools, ...untooled } = GOOD
    expect(pairingOf(linkOf(untooled))?.tools).toEqual([])
    expect(
        pairingOf(linkOf({ ...GOOD, site: 'http://localhost:3000' }))?.site,
    ).toBe('http://localhost:3000')
})

// 44.41 — A LINK IS NEVER READ AS MORE THAN IT IS: the release goes into `bun x`'s package spec and
// the tools onto Claude Code's command line. THE REVERT: drop the `RELEASE` test, and `latest` (a tag
// the site could move) and a `file:` spec are run.
test('a link that would be read as more than a pairing is refused — 44.41', () => {
    for (const refused of [
        linkOf({ ...GOOD, site: 'http://crm.example' }),
        linkOf({ ...GOOD, site: 'https://user:secret@crm.example' }),
        linkOf({ ...GOOD, site: 'https://crm.example/?next=1' }),
        linkOf({ ...GOOD, site: 'file:///etc' }),
        linkOf({ ...GOOD, version: 'latest' }),
        linkOf({ ...GOOD, version: '^0.4.0' }),
        linkOf({ ...GOOD, version: 'file:../evil' }),
        linkOf({ ...GOOD, code: 'a b' }),
        linkOf({ ...GOOD, tools: 'Bash(rm:*)' }),
        linkOf({ ...GOOD, tools: 'WebSearch --add-dir /' }),
        linkOf({ ...GOOD, tools: 'mcp__calendar meetings' }),
        linkOf({ ...GOOD, tools: 'mcp__calendar;rm' }),
        linkOf({ ...GOOD, full: 'yes' }),
        GOOD.site,
        `other://pair?${new URLSearchParams(GOOD)}`,
        `${PAIRING_SCHEME}://elsewhere?${new URLSearchParams(GOOD)}`,
        'not a url',
    ])
        expect(pairingOf(refused)).toBeUndefined()
})

// 44.42 — EVERY LINK IS ASKED, and the question names what the link would run: the site, as the
// visitor reads it, in the headline with every tool it asks for.
test('the question names the site and every tool it asks for — 44.42', () => {
    const asked = question(PAIRING, SETTINGS)
    expect(asked.headline).toContain('crm.example/app')
    expect(asked.headline).toContain('WebSearch, WebFetch')
    expect(asked.body).toContain('auto mode')
    expect(said(asked)).not.toContain('gave install')
    expect(said(asked)).not.toContain(PAIRING.version)
    expect(question({ ...PAIRING, tools: [] }, SETTINGS).headline).toContain(
        'none of this computer’s',
    )
    // Options that leave auto mode are not called auto mode.
    expect(
        question(PAIRING, {
            ...SETTINGS,
            claudeArgs: ['--permission-mode', 'acceptEdits'],
        }).body,
    ).not.toContain('auto mode')
})

// 44.42 — THE APP'S NAME IS THE SITE'S TO CHOOSE, so the question shows it beside the site it is
// served from, never in its place, and titles itself by it. THE REVERT: show the name alone, and an app
// calling itself anything reads as that.
test('the question names the app beside its site, and is titled by it — 44.42', () => {
    const asked = question({ ...PAIRING, full: true }, SETTINGS, [], {
        name: 'CRM',
    })
    expect(asked.title).toBe('CRM')
    expect(asked.headline).toBe(
        'CRM (crm.example/app) is requesting full access to your local Claude Code.',
    )
    expect(asked.body).toContain('Or allow only CRM’s own tools')
    expect(question(PAIRING, SETTINGS).title).toBe('crm.example/app')
})

// 44.91 — THE APP'S NOTE IS SHOWN AS ITS OWN WORDS: quoted and said by the app, first under the headline,
// and never in the headline the bridge writes. THE REVERT: drop the note from `question`, and it is not
// shown at all.
test('the question shows the app’s note as its own words — 44.91', () => {
    const asked = question({ ...PAIRING, full: true }, SETTINGS, [], {
        name: 'CRM',
        note: 'So it can file your deals.',
    })
    expect(asked.headline).not.toContain('file your deals')
    expect(asked.body.split('\n\n')[0]).toBe(
        'CRM says: “So it can file your deals.”',
    )
    expect(
        question(PAIRING, SETTINGS, [], { note: 'Why.' }).body.split('\n\n')[0],
    ).toBe('crm.example/app says: “Why.”')
})

// 44.90 — THE ICON IS THE SITE'S OWN `/icon.png`, and only where it is a PNG no larger than an app
// icon: anything else leaves the desktop's own.
test('the question shows the icon the site publishes, where it is a PNG — 44.90', async () => {
    const png = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ])
    const served = Bun.serve({
        port: 0,
        fetch(request) {
            const path = new URL(request.url).pathname
            if (path === '/png/icon.png') return new Response(png)
            if (path === '/text/icon.png') return new Response('<svg/>')
            if (path === '/huge/icon.png')
                return new Response(new Uint8Array(2 * 1024 * 1024))
            return new Response('', { status: 404 })
        },
    })
    try {
        const site = `http://localhost:${served.port}`
        expect(await iconOf(`${site}/png`)).toEqual(png)
        expect(await iconOf(`${site}/text`)).toBeUndefined()
        expect(await iconOf(`${site}/huge`)).toBeUndefined()
        expect(await iconOf(`${site}/none`)).toBeUndefined()
    } finally {
        await served.stop(true)
    }
})

// 44.42, 44.86 — AN ASK FOR FULL ACCESS NAMES NO TOOL: it says what it asks for, and that the site's own
// tools alone may be allowed instead.
test('a link asking for full access is asked naming no tool — 44.42, 44.86', () => {
    const asked = question({ ...PAIRING, full: true }, SETTINGS)
    expect(asked.headline).toBe(
        'crm.example/app is requesting full access to your local Claude Code.',
    )
    expect(said(asked)).not.toContain('WebSearch')
    expect(asked.body).toContain('Or allow only crm.example/app’s own tools')
})

// 44.42, 44.44 — WHAT INSTALL KEPT IS ASKED ABOUT TOO: it reaches every site the visitor allows, so the
// question names each option and each variable — by name, since a value may be a token.
test('the question names the options and variables install kept, and no value — 44.42, 44.44', () => {
    const asked = said(question(PAIRING, KEPT))
    expect(asked).toContain('--mcp-config /Users/me/sources.mcp.json')
    expect(asked).toContain('GH_HOST GH_TOKEN')
    expect(asked).not.toContain('secret-token')
    expect(asked).not.toContain('github.example')
})

// 44.41, 44.32 — THE RELEASE THE LINK NAMES, run as the command beside it would be.
test('a link runs the release it names, granting its tools after the --', () => {
    const settings = SETTINGS
    expect(bridgeArguments(PAIRING, settings)).toEqual([
        '/opt/bun/bin/bun',
        'x',
        '@abide/bridge@0.4.0',
        PAIRING.site,
        PAIRING.code,
        '--claude',
        '/opt/claude/claude',
        '--',
        '--tools',
        'WebSearch,WebFetch',
    ])
    expect(bridgeArguments({ ...PAIRING, tools: [] }, settings)).not.toContain(
        '--',
    )
    // An npm-installed `claude` runs `env node`, so the PATH install was run on comes after.
    expect(searchPath(settings)).toBe(
        '/opt/bun/bin:/opt/claude:/opt/node/bin:/usr/bin',
    )
})

// 44.44 — WHAT INSTALL KEPT RUNS WITH EVERY LINK, ahead of the link's tools, so the bridge reads both
// as the visitor's command line; a link with no tools still carries them.
test('a link runs with the options install kept, ahead of its tools — 44.44', () => {
    expect(bridgeArguments(PAIRING, KEPT).slice(7)).toEqual([
        '--',
        '--mcp-config',
        '/Users/me/sources.mcp.json',
        '--tools',
        'WebSearch,WebFetch',
    ])
    expect(bridgeArguments({ ...PAIRING, tools: [] }, KEPT).slice(7)).toEqual([
        '--',
        '--mcp-config',
        '/Users/me/sources.mcp.json',
    ])
})

// 44.82 — AN INSTALL RUN `--full` RUNS EVERY LINK'S BRIDGE `--full`, and the question says so in
// place of the tools the link asks for. THE REVERT: drop the `--full` `bridgeArguments` adds, and the
// arguments read as the plain link's.
test('an install run --full runs every link full, and asks saying so — 44.42, 44.82', () => {
    const full = { ...SETTINGS, full: true }
    expect(bridgeArguments(PAIRING, full).slice(5)).toEqual([
        '--claude',
        '/opt/claude/claude',
        '--full',
        '--',
        '--tools',
        'WebSearch,WebFetch',
    ])
    const asked = said(question(PAIRING, full))
    expect(asked).toContain('give every site full access')
    expect(asked).not.toContain('WebSearch, WebFetch')
})

// 44.87 — A LINK RUNS FULL ONLY AS ALLOWED: the pairing `consented` answers carries the allowed ask, and
// the bridge runs `--full` for it. THE REVERT: drop `pairing.full` from `bridgeArguments`, and an
// allowed ask runs with the link's tools alone.
test('a link whose ask for full access was allowed runs full — 44.87', () => {
    expect(
        bridgeArguments({ ...PAIRING, tools: [], full: true }, SETTINGS).slice(
            5,
        ),
    ).toEqual(['--claude', '/opt/claude/claude', '--full'])
})

// 44.89 — A CHECKOUT RUNS ITSELF: an install from a copy outside any `node_modules` opens links with that
// copy's handler, read where it stands, and runs that copy's bridge in place of the release the link
// names. THE REVERT: drop the `checkout` branch of `bridgeArguments`, and the link's npm release runs.
test('an install from a checkout runs the checkout, whatever release a link names — 44.89', async () => {
    expect(checkoutOf('/Users/me/abide/packages/bridge/bin')).toBe(
        '/Users/me/abide/packages/bridge',
    )
    expect(
        checkoutOf(
            '/Users/me/.bun/install/cache/.bunx-501/@abide/bridge@0.6.2/node_modules/@abide/bridge/bin',
        ),
    ).toBeUndefined()
    expect(checkoutOf('C:\\work\\abide\\packages\\bridge\\bin')).toBe(
        'C:/work/abide/packages/bridge',
    )
    const checkout = `${import.meta.dir}/../../bridge`
    expect(
        bridgeArguments(PAIRING, { ...SETTINGS, checkout }).slice(0, 4),
    ).toEqual([
        '/opt/bun/bin/bun',
        `${checkout}/bin/abideBridge.ts`,
        PAIRING.site,
        PAIRING.code,
    ])
    // The handler is the checkout's own `open`, handed the directory its settings are kept in.
    const handler = checkoutHandler(checkout)
    const imported = new Bun.Transpiler({ loader: 'ts' }).scanImports(handler)
    expect(imported.map((each) => each.path)).toEqual([
        `${checkout}/src/opened.ts`,
    ])
    expect(typeof (await import(`${checkout}/src/opened.ts`)).open).toBe(
        'function',
    )
    expect(handler).toContain('import.meta.dir')
})

// 44.29 — AN MCP TOOL IS A TOOL TOO: a link asks for one by Claude Code's name for it, or for all of a
// server's, and nothing else of a server — never the command that starts it.
test('a link asks for MCP tools by name, or for all of a server’s — 44.29, 44.41', () => {
    expect(
        pairingOf(
            linkOf({
                ...GOOD,
                tools: 'WebSearch,mcp__calendar__meetings,mcp__mail',
            }),
        )?.tools,
    ).toEqual(['WebSearch', 'mcp__calendar__meetings', 'mcp__mail'])
})

// 44.29 — THE SITE ASKS, THE VISITOR GRANTS, THE VISITOR'S OWN CONFIGURATION SERVES: an MCP tool is given
// where the visitor granted it or all of its server's, and its server is one they configured; a site
// can never name `app`, the bridge's own. THE REVERT: give an MCP tool whose server is not configured,
// and `mcp__drive__files` is given rather than unserved.
test('an MCP tool is given only where granted and its server configured — 44.29', () => {
    const configured = new Map<string, unknown>([
        ['calendar', { command: 'calendar-server' }],
        ['mail', { command: 'mail-server' }],
    ])
    const grant = grantOf(
        [
            'WebSearch',
            'WebFetch',
            'mcp__calendar__meetings',
            'mcp__mail__send',
            'mcp__drive__files',
            'mcp__calendar__invite',
        ],
        new Set([
            'WebSearch',
            'mcp__calendar__meetings',
            'mcp__mail',
            'mcp__drive__files',
        ]),
        configured,
    )
    expect(grant).toEqual({
        builtIn: ['WebSearch'],
        mcp: ['mcp__calendar__meetings', 'mcp__mail__send'],
        servers: {
            calendar: { command: 'calendar-server' },
            mail: { command: 'mail-server' },
        },
        ungranted: ['WebFetch', 'mcp__calendar__invite'],
        unserved: ['mcp__drive__files'],
    })
})

// 44.58 — THE VISITOR'S SERVERS, BY THE NAME THEIR TOOLS CARRY: from each `--mcp-config` they passed, a
// file or JSON written out, never naming the bridge's own `app`.
test('the visitor’s MCP servers are read from what they passed — 44.58', async () => {
    const directory = temporaryModule({}, `${tmpdir()}/`)
    await Bun.write(
        `${directory}/sources.json`,
        JSON.stringify({ mcpServers: { 'my.calendar': { command: 'c' } } }),
    )
    const servers = await visitorServers([
        `${directory}/sources.json`,
        JSON.stringify({ mcpServers: { app: { command: 'x' }, mail: {} } }),
    ])
    expect([...servers.keys()]).toEqual(['my_calendar', 'mail'])
    await expect(visitorServers([`${directory}/none.json`])).rejects.toThrow(
        'none.json',
    )
})

// 44.65 — THE QUESTION NAMES WHAT CANNOT BE GIVEN: an MCP tool the link asks for whose server the visitor's
// Claude Code is not configured with, and how to add it.
test('the question names each MCP tool whose server the visitor lacks — 44.65', async () => {
    const pairing = {
        ...PAIRING,
        tools: ['WebSearch', 'mcp__calendar__meetings', 'mcp__mail'],
    }
    const sources = JSON.stringify({ mcpServers: { mail: {} } })
    const unserved = await unservedOf(pairing, {
        ...SETTINGS,
        claudeArgs: ['--mcp-config', sources],
    })
    expect(unserved).toEqual(['mcp__calendar__meetings'])
    const asked = said(question(pairing, SETTINGS, unserved))
    expect(asked).toContain('no calendar MCP server')
    expect(asked).toContain('claude mcp add --scope user')
    expect(said(question(pairing, SETTINGS))).not.toContain('MCP server')
})

// 44.62, 44.66, 44.88 — WHAT IS ALLOWED IS KEPT PER SITE AND HOLDER, grows by the tools allowed since,
// keeps an ask for full access as answered, and is forgotten by site or whole.
test('a site is allowed per holder, and forgotten — 44.62, 44.66, 44.88', async () => {
    const file = `${temporaryModule({}, `${tmpdir()}/`)}/allowed.json`
    expect(await allowedSites(file)).toEqual([])
    await allowAlways(file, 'https://a.example', 'h1', ['WebSearch'])
    await allowAlways(file, 'https://a.example', 'h1', ['mcp__calendar'])
    await allowAlways(file, 'https://b.example', 'h2', [])
    await allowAlways(file, 'http://localhost:3000/app', 'h3', [])
    await allowAlways(file, 'https://c.example', 'h4', [], false)
    await allowAlways(file, 'https://d.example', 'h5', [], true)
    const sites = await allowedSites(file)
    const asking = (tools: string[], full = false) => ({ tools, full })
    expect(
        allowedAs(
            sites,
            'https://a.example',
            'h1',
            asking(['mcp__calendar', 'WebSearch']),
        ),
    ).toBeDefined()
    expect(
        allowedAs(sites, 'https://a.example', 'h2', asking([])),
    ).toBeUndefined()
    expect(
        allowedAs(sites, 'https://a.example', 'h1', asking(['WebFetch'])),
    ).toBeUndefined()
    // An ask for full access never answered is asked; one answered pairs as it was answered.
    expect(
        allowedAs(sites, 'https://a.example', 'h1', asking([], true)),
    ).toBeUndefined()
    expect(
        allowedAs(sites, 'https://c.example', 'h4', asking([], true))?.full,
    ).toBe(false)
    // Full access allowed covers whatever a narrower link asks for.
    expect(
        allowedAs(sites, 'https://d.example', 'h5', asking(['Bash'])),
    ).toBeDefined()
    expect(await forget(file, 'c.example')).toBe(1)
    expect(await forget(file, 'd.example')).toBe(1)
    expect(await forget(file, 'https://a.example/')).toBe(1)
    // A bare name is the site kept under either scheme.
    expect(await forget(file, 'localhost:3000/app/')).toBe(1)
    expect(await allowedSites(file)).toEqual([
        { site: 'https://b.example', holder: 'h2', tools: [] },
    ])
    expect(await forget(file)).toBe(1)
    expect(await allowedSites(file)).toEqual([])
})

// 44.43 — UNINSTALL UNSETS THE DEFAULT `xdg-mime` SET, which it has no command for: the entry is taken
// out of the scheme's line, and the line goes where it named no other.
test('uninstall takes the desktop entry out of mimeapps.list — 44.43', () => {
    const list = [
        '[Default Applications]',
        'text/html=firefox.desktop',
        'x-scheme-handler/abide-bridge=abide-bridge.desktop',
        '',
    ].join('\n')
    expect(withoutDefault(list)).toBe(
        '[Default Applications]\ntext/html=firefox.desktop\n',
    )
    expect(
        withoutDefault(
            'x-scheme-handler/abide-bridge=abide-bridge.desktop;other.desktop;',
        ),
    ).toBe('x-scheme-handler/abide-bridge=other.desktop;')
    const another = list.replace('abide-bridge.desktop', 'x.desktop')
    expect(withoutDefault(another)).toBe(another)
})

// 44.43 — LINUX AND WINDOWS OPEN THE SCHEME AS THEIR DESKTOPS DO: a desktop entry claiming
// `x-scheme-handler/abide-bridge`, its `Exec` quoting each path; registry classes under the visitor's
// own hive starting the handler with the link.
test('Linux and Windows register the scheme to start the handler with the link — 44.43', () => {
    // A quoted `"` is `\"`, and the string escape doubles that backslash; a `%` is doubled.
    const entry = desktopEntry('/home/me/.bun/bin/bun', '/home/me/a "b"%/x')
    expect(entry).toContain(
        'Exec="/home/me/.bun/bin/bun" "/home/me/a \\\\"b\\\\"%%/x/handler/opened.js" %u',
    )
    expect(entry).toContain(`MimeType=x-scheme-handler/${PAIRING_SCHEME};`)
    expect(entry).toContain('NoDisplay=true')
    const commands = registryCommands(
        'C:\\bun\\bun.exe',
        'C:\\Users\\me\\abide-bridge',
    )
    expect(commands.at(-1)).toEqual([
        'reg',
        'add',
        `HKCU\\Software\\Classes\\${PAIRING_SCHEME}\\shell\\open\\command`,
        '/ve',
        '/d',
        '"C:\\bun\\bun.exe" "C:\\Users\\me\\abide-bridge\\handler\\opened.js" "%1"',
        '/f',
    ])
    expect(commands[1]).toContain('URL Protocol')
})

// 44.64 — A QUESTION THAT CANNOT BE SHOWN IS A NO: a Linux desktop asks with `zenity`, else `kdialog`,
// and offers the site's own tools as a third button only where a link asks for full access (44.86);
// with neither there is no question. zenity's headline is bold markup, so what a site names is escaped.
test('a Linux desktop asks with zenity or kdialog, or not at all — 44.64, 44.86', () => {
    const asked = {
        title: 'CRM',
        headline: '<i>a.example</i> asks',
        body: 'b & c',
        icon: undefined,
    }
    const zenity = linuxQuestion(
        asked,
        true,
        (tool) => tool === 'zenity',
        '/tmp/icon.png',
    )
    expect(zenity?.[0]).toBe('zenity')
    // 44.90 — titled by the app, with its icon.
    expect(zenity?.slice(2, 6)).toEqual([
        '--title',
        'CRM',
        '--window-icon',
        '/tmp/icon.png',
    ])
    expect(zenity).toContain('--extra-button')
    expect(zenity).toContain(
        '<b>&lt;i&gt;a.example&lt;/i&gt; asks</b>\n\nb &amp; c',
    )
    expect(
        linuxQuestion(asked, false, (tool) => tool === 'zenity'),
    ).not.toContain('--extra-button')
    expect(linuxQuestion(asked, true, (tool) => tool === 'kdialog')).toContain(
        '--yesnocancel',
    )
    expect(linuxQuestion(asked, false, (tool) => tool === 'kdialog')).toContain(
        '--yesno',
    )
    expect(linuxQuestion(asked, true, () => false)).toBeUndefined()
})

afterAll(removeTemporaryModules)

// 44.43 — THE APP OPENS THE SCHEME AND NOTHING SHOWS: built here, its plist claims `abide-bridge`, it
// keeps out of the Dock, and it is signed whole after the plist was edited. THE REVERT: drop the
// `codesign` step, and `codesign --verify` finds the edited plist breaks the seal `osacompile` gave it.
test.skipIf(process.platform !== 'darwin')(
    'install builds a signed app that opens the scheme, and uninstall removes it — 44.43',
    async () => {
        const directory = temporaryModule({}, `${tmpdir()}/`)
        const settings = { ...KEPT, bun: process.execPath }
        const app = await install(settings, { directory, register: false })
        expect(app).toBe(appIn(directory))
        const plist = await spawned(
            [
                'plutil',
                '-convert',
                'json',
                '-o',
                '-',
                `${app}/Contents/Info.plist`,
            ],
            { deadline: 10_000 },
        )
        const info = JSON.parse(plist.stdout) as {
            CFBundleIdentifier: string
            LSUIElement: boolean
            CFBundleURLTypes: { CFBundleURLSchemes: string[] }[]
        }
        expect(info.CFBundleIdentifier).toBe(IDENTIFIER)
        expect(info.LSUIElement).toBe(true)
        expect(info.CFBundleURLTypes[0]?.CFBundleURLSchemes).toEqual([
            PAIRING_SCHEME,
        ])
        const verified = await spawned(
            ['codesign', '--verify', '--deep', '--strict', app],
            { deadline: 10_000 },
        )
        expect(verified.exitCode).toBe(0)
        const script = await spawned(
            ['osadecompile', `${app}/Contents/Resources/Scripts/main.scpt`],
            {
                deadline: 10_000,
            },
        )
        expect(script.stdout).toContain('on open location')
        expect(script.stdout).toContain(handlerIn(directory))
        expect(
            await Bun.file(`${directory}/handler/settings.json`).json(),
        ).toEqual(settings)
        // Copied away from its package, the handler can reach nothing beside it it was not bundled with.
        const imported = new Bun.Transpiler({ loader: 'ts' }).scanImports(
            await Bun.file(handlerIn(directory)).text(),
        )
        expect(imported.filter((each) => each.path.startsWith('.'))).toEqual([])

        await uninstall({ directory, register: false })
        expect(await Bun.file(`${app}/Contents/Info.plist`).exists()).toBe(
            false,
        )
        expect(await Bun.file(handlerIn(directory)).exists()).toBe(false)
    },
    60_000,
)
