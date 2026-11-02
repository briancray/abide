// SECTION 44 — the pairing link a site shows beside its command, as the bridge opens it: which links it
// reads (44.41), what it asks and runs (44.42), and the app `abide-bridge install` builds to open them
// (44.43), built into a directory of the test's own and never registered with Launch Services.

import { afterAll, expect, test } from 'bun:test'
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { spawned } from '@abide/harness/gate'

import {
    appIn,
    handlerIn,
    IDENTIFIER,
    install,
    uninstall,
} from '../../bridge/src/install.ts'
import {
    bridgeArguments,
    question,
    searchPath,
} from '../../bridge/src/opened.ts'
import {
    type Pairing,
    PAIRING_SCHEME,
    pairingOf,
} from '../../bridge/src/pairingLink.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const PAIRING: Pairing = {
    site: 'https://crm.example/app',
    code: 'abc_DEF-123',
    version: '0.4.0',
    tools: ['WebSearch', 'WebFetch'],
}

function linkOf(fields: Record<string, string>): string {
    return `${PAIRING_SCHEME}://pair?${new URLSearchParams(fields)}`
}

const GOOD = { ...PAIRING, tools: PAIRING.tools.join(',') }

test('a link is read as the pairing it names — 44.41', () => {
    expect(pairingOf(linkOf(GOOD))).toEqual(PAIRING)
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
        GOOD.site,
        `other://pair?${new URLSearchParams(GOOD)}`,
        `${PAIRING_SCHEME}://elsewhere?${new URLSearchParams(GOOD)}`,
        'not a url',
    ])
        expect(pairingOf(refused)).toBeUndefined()
})

// 44.42 — EVERY LINK IS ASKED, and the question names what the link would run. There is no kept
// answer to test: a code proves the site minted it, not that this visitor asked for it.
test('the question names the site, every tool and the release it asks for — 44.42', () => {
    const asked = question(PAIRING)
    expect(asked).toContain(PAIRING.site)
    expect(asked).toContain('WebSearch, WebFetch')
    expect(asked).toContain(`@abide/bridge ${PAIRING.version}`)
    expect(question({ ...PAIRING, tools: [] })).toContain('none of this Mac’s')
})

// 44.41, 44.32 — THE RELEASE THE LINK NAMES, run as the command beside it would be.
test('a link runs the release it names, granting its tools after the --', () => {
    const settings = {
        bun: '/opt/bun/bin/bun',
        claude: '/opt/claude/claude',
        path: '/opt/node/bin:/opt/bun/bin:/usr/bin',
    }
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

afterAll(removeTemporaryModules)

// 44.43 — THE APP OPENS THE SCHEME AND NOTHING SHOWS: built here, its plist claims `abide-bridge`, it
// keeps out of the Dock, and it is signed whole after the plist was edited. THE REVERT: drop the
// `codesign` step, and `codesign --verify` finds the edited plist breaks the seal `osacompile` gave it.
test.skipIf(process.platform !== 'darwin')(
    'install builds a signed app that opens the scheme, and uninstall removes it — 44.43',
    async () => {
        const directory = temporaryModule({}, `${tmpdir()}/`)
        const settings = {
            bun: process.execPath,
            claude: '/opt/claude/claude',
            path: '/usr/bin:/bin',
        }
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
