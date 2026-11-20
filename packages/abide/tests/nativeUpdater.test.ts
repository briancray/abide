// 38.142-38.147 — A NATIVE APP UPDATING ITSELF, apart from the window: what `abide native`
// publishes, served as a host would, read back by the updater an installed copy runs. A fake `.app`
// is a directory with an `Info.plist` — what the updater moves is the directory, not what runs. And
// 38.78, 38.87 — the one real `.app` below, and the names `abide native` gives it.

import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises' // bun exposes no temporary directory or removal of its own
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { spawned } from '@abide/harness/gate'

import { launcherOf } from '#server/launcherOptions.ts'
import { menuBar } from '#server/menuBar.ts'
import {
    appOf,
    CHECK_INTERVAL,
    type Checked,
    NativeUpdater,
    NUDGE_INTERVAL,
    RETRY_INTERVAL,
} from '#server/NativeUpdater.ts'
import { ran } from '#server/ran.ts'
import {
    newUpdateKey,
    publicKeyOf,
    publishUpdate,
    updateKey,
} from '#server/updateFeed.ts'
import { log } from '#shared/log.ts'

import { BIN } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const made: string[] = []
afterAll(async () => {
    for (const directory of made)
        await rm(directory, { recursive: true, force: true })
    removeTemporaryModules()
})

async function workspace(): Promise<string> {
    const directory = await mkdtemp(`${tmpdir()}/abide-update-`)
    made.push(directory)
    return directory
}

/** A `.app` at `path` whose `Info.plist` names `version`. */
async function fakeApp(path: string, version: string): Promise<void> {
    await Bun.write(
        `${path}/Contents/Info.plist`,
        `<plist><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`,
    )
    await Bun.write(`${path}/Contents/MacOS/CRM`, '#!/bin/sh\n')
}

async function versionAt(app: string): Promise<string | undefined> {
    const file = Bun.file(`${app}/Contents/Info.plist`)
    if (!(await file.exists())) return undefined
    return /<string>([^<]+)<\/string>/.exec(await file.text())?.[1]
}

/** Publishes CRM `version` signed with `privateKey`, serves the folder, and counts each read. */
async function published(
    version: string,
    privateKey: string,
    release: { required?: boolean; notes?: string | null } = {},
) {
    const directory = await workspace()
    await fakeApp(`${directory}/build/CRM.app`, version)
    await publishUpdate(
        `${directory}/build/CRM.app`,
        `${directory}/updates`,
        {
            version,
            required: release.required ?? false,
            notes: release.notes ?? null,
        },
        privateKey,
    )
    const reads: string[] = []
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch(request) {
            const path = new URL(request.url).pathname
            reads.push(path)
            const file = Bun.file(`${directory}${path}`)
            return file
                .exists()
                .then((there) =>
                    there
                        ? new Response(file)
                        : new Response('missing', { status: 404 }),
                )
        },
    })
    return { directory, server, reads, update: `${server.url}updates` }
}

/** An installed CRM `version` that trusts `privateKey`'s public half. */
async function installed(version: string, update: string, privateKey: string) {
    const directory = await workspace()
    const app = `${directory}/Applications/CRM.app`
    await fakeApp(app, version)
    const told: string[] = []
    const updater = new NativeUpdater(
        update,
        await publicKeyOf(privateKey),
        app,
        version,
        (staged) => told.push(staged?.version ?? 'lost'),
    )
    return { app, updater, told }
}

const outcome = (checked: Checked): string =>
    checked.outcome === 'staged'
        ? `staged ${checked.staged.version}`
        : checked.outcome === 'current'
          ? 'current'
          : `${checked.outcome}: ${checked.reason}`

// The feed's zip is `ditto`'s, which macOS alone has — as it alone has the bundle an update replaces.
const ON_MAC = process.platform === 'darwin'

// THE REVERT is `install` not moving the staged `.app`: no app is left to read after it.
test.skipIf(!ON_MAC)(
    'a newer build is staged, and installed in place of the app — 38.142, 38.144',
    async () => {
        const key = await newUpdateKey()
        const host = await published('1.1.0', key, {
            required: true,
            notes: 'Fixes export.',
        })
        using _ = host.server
        const { app, updater, told } = await installed(
            '1.0.0',
            host.update,
            key,
        )
        const checked = await updater.check()
        expect(outcome(checked)).toBe('staged 1.1.0')
        expect(told).toEqual(['1.1.0'])
        expect(updater.staged?.required).toBe(true)
        expect(updater.staged?.notes).toBe('Fixes export.')
        expect(`before install ${await versionAt(app)}`).toBe(
            'before install 1.0.0',
        )
        expect(await updater.install()).toBe(true)
        expect(`after install ${await versionAt(app)}`).toBe(
            'after install 1.1.0',
        )
        expect(await Bun.file(`${app}.update`).exists()).toBe(false)
    },
)

// THE REVERT is `order(...) <= 0` read as `=== 0`: a feed rolled back to 0.9.0 stages a downgrade,
// and the zip is read.
test.skipIf(!ON_MAC)(
    'a feed naming the same or an older version stages nothing — 38.142',
    async () => {
        const key = await newUpdateKey()
        for (const version of ['1.0.0', '0.9.0']) {
            const host = await published(version, key)
            using _ = host.server
            const { app, updater } = await installed('1.0.0', host.update, key)
            expect(`${version}: ${outcome(await updater.check())}`).toBe(
                `${version}: current`,
            )
            expect(host.reads).toEqual(['/updates/latest.json'])
            expect(await updater.install()).toBe(false)
            expect(await versionAt(app)).toBe('1.0.0')
        }
    },
)

// THE REVERT is `verifiedFeed` answering the feed without verifying it: the rewritten notes, and
// then the other key's build, are staged.
test.skipIf(!ON_MAC)(
    'a feed changed after signing, or signed by another key, is refused — 38.143',
    async () => {
        const key = await newUpdateKey()
        const host = await published('1.1.0', key, { notes: 'Fixes export.' })
        using _ = host.server
        const feed = `${host.directory}/updates/latest.json`
        const signed = await Bun.file(feed).json()
        await Bun.write(feed, JSON.stringify({ ...signed, required: true }))
        const { app, updater } = await installed('1.0.0', host.update, key)
        expect(outcome(await updater.check())).toBe(
            'refused: the update feed is not signed by the key this app was bundled with',
        )
        const stranger = await published('1.1.0', await newUpdateKey())
        using __ = stranger.server
        const trusting = await installed('1.0.0', stranger.update, key)
        expect(outcome(await trusting.updater.check())).toBe(
            'refused: the update feed is not signed by the key this app was bundled with',
        )
        expect(`${updater.staged}, ${trusting.updater.staged}`).toBe(
            'undefined, undefined',
        )
        expect(await versionAt(app)).toBe('1.0.0')
    },
)

// THE REVERT is the digest check dropped: another build zipped under the signed feed's name is
// staged, and installs as 6.6.6.
test.skipIf(!ON_MAC)(
    'a zip that is not the one the feed signed is refused — 38.143',
    async () => {
        const key = await newUpdateKey()
        const host = await published('1.1.0', key)
        using _ = host.server
        const { file } = await Bun.file(
            `${host.directory}/updates/latest.json`,
        ).json()
        const other = `${host.directory}/other/CRM.app`
        await fakeApp(other, '6.6.6')
        await rm(`${host.directory}/updates/${file}`)
        await ran([
            'ditto',
            '-c',
            '-k',
            '--keepParent',
            other,
            `${host.directory}/updates/${file}`,
        ])
        const { app, updater } = await installed('1.0.0', host.update, key)
        expect(outcome(await updater.check())).toBe(
            `refused: ${file} is not the file the update feed signed`,
        )
        await updater.install()
        expect(await versionAt(app)).toBe('1.0.0')
    },
)

// THE REVERT is `install` without its undo: the second rename fails, and no app is left where the
// one that ran was.
test.skipIf(!ON_MAC)(
    'a replacement that fails leaves the app that ran in place — 38.144',
    async () => {
        const key = await newUpdateKey()
        const host = await published('1.1.0', key)
        using _ = host.server
        const { app, updater } = await installed('1.0.0', host.update, key)
        await updater.check()
        await rm(`${app}.update`, { recursive: true })
        expect(updater.install()).rejects.toThrow()
        await updater.install().catch(() => undefined)
        expect(await versionAt(app)).toBe('1.0.0')
    },
)

// THE REVERT is `check` answering what is staged without reading the feed, as before: 1.2.0 is
// never read, and the restart installs 1.1.0.
test.skipIf(!ON_MAC)(
    'a check after staging reads the feed again, and stages a newer release in place of the staged one — 38.142',
    async () => {
        const key = await newUpdateKey()
        const host = await published('1.1.0', key)
        using _ = host.server
        const { app, updater, told } = await installed(
            '1.0.0',
            host.update,
            key,
        )
        expect(outcome(await updater.check())).toBe('staged 1.1.0')
        host.reads.length = 0
        expect(outcome(await updater.check())).toBe('staged 1.1.0')
        expect(host.reads).toEqual(['/updates/latest.json'])
        await fakeApp(`${host.directory}/build/CRM.app`, '1.2.0')
        await publishUpdate(
            `${host.directory}/build/CRM.app`,
            `${host.directory}/updates`,
            { version: '1.2.0', required: false, notes: null },
            key,
        )
        expect(outcome(await updater.check())).toBe('staged 1.2.0')
        expect(told).toEqual(['1.1.0', '1.2.0'])
        expect(await updater.install()).toBe(true)
        expect(await versionAt(app)).toBe('1.2.0')
    },
)

// THE REVERT is `due` an hour after every check, whatever it found: the feed that could not be read
// is tried again an hour later rather than a minute.
test('a feed that cannot be reached is tried again after a minute, backing off to the hour — 38.142', async () => {
    const { updater } = await installed(
        '1.0.0',
        'http://127.0.0.1:9/updates',
        await newUpdateKey(),
    )
    const waits: number[] = []
    for (let tries = 0; tries < 8; tries += 1) {
        await updater.check()
        waits.push(updater.due - updater.lastChecked)
    }
    expect(waits).toEqual([
        RETRY_INTERVAL,
        2 * RETRY_INTERVAL,
        4 * RETRY_INTERVAL,
        8 * RETRY_INTERVAL,
        16 * RETRY_INTERVAL,
        32 * RETRY_INTERVAL,
        CHECK_INTERVAL,
        CHECK_INTERVAL,
    ])
})

// THE REVERT is `checkWhenDue` reading `due` alone: the app coming to the front an hour short of the
// next check reads nothing.
test('a check is due by the wall clock, and waking or coming to the front brings it to five minutes after the last — 38.142', async () => {
    const { updater } = await installed(
        '1.0.0',
        'http://127.0.0.1:9/updates',
        await newUpdateKey(),
    )
    expect(updater.checkWhenDue(false)).toBeDefined()
    await updater.checking
    updater.due = updater.lastChecked + CHECK_INTERVAL
    const after = (elapsed: number, nudged: boolean): boolean => {
        const checking = updater.checkWhenDue(
            nudged,
            updater.lastChecked + elapsed,
        )
        return checking !== undefined
    }
    expect(after(NUDGE_INTERVAL - 1, true)).toBe(false)
    expect(after(CHECK_INTERVAL - 1, false)).toBe(false)
    expect(after(NUDGE_INTERVAL, true)).toBe(true)
    await updater.checking
})

// THE REVERT is the `logged` line dropped from `check`: nothing in the log says a check ran.
test('every check writes one line naming what it found — 38.142', async () => {
    const { updater } = await installed(
        '1.0.0',
        'http://127.0.0.1:9/updates',
        await newUpdateKey(),
    )
    const before = log.records().length
    await updater.check()
    const lines = log
        .records()
        .slice(before)
        .filter((record) => record.namespace.endsWith(':update'))
        .map((record) => record.message)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toStartWith(
        '1.0.0: unreachable http://127.0.0.1:9/updates/latest.json could not be read',
    )
})

test('a feed that cannot be reached stages nothing and is not a refusal — 38.142', async () => {
    const key = await newUpdateKey()
    const { updater } = await installed(
        '1.0.0',
        'http://127.0.0.1:9/updates',
        key,
    )
    expect((await updater.check()).outcome).toBe('unreachable')
})

test('an update reads the app it replaces off the executable inside it', () => {
    expect(appOf('/Applications/CRM.app/Contents/MacOS/CRM')).toBe(
        '/Applications/CRM.app',
    )
    expect(appOf('/usr/local/bin/crm')).toBeUndefined()
})

// THE REVERT is `updateKey` making a key on every call: the second bundle signs with a key no
// installed copy trusts.
test('the first bundle makes the key, and every one after it reuses it — 38.147', async () => {
    const given = process.env.ABIDE_UPDATE_KEY
    const keys = `${await workspace()}/update-keys`
    delete process.env.ABIDE_UPDATE_KEY
    try {
        const first = await updateKey('crm', keys)
        const second = await updateKey('crm', keys)
        expect(first.made).toBe(`${keys}/crm.key`)
        expect(second.made).toBeUndefined()
        expect(second.privateKey).toBe(first.privateKey)
        // Owner read and write alone.
        const { mode } = await Bun.file(`${keys}/crm.key`).stat()
        expect((mode & 0o777).toString(8)).toBe('600')
        process.env.ABIDE_UPDATE_KEY = await newUpdateKey()
        expect((await updateKey('crm', keys)).privateKey).toBe(
            process.env.ABIDE_UPDATE_KEY,
        )
    } finally {
        if (given === undefined) delete process.env.ABIDE_UPDATE_KEY
        else process.env.ABIDE_UPDATE_KEY = given
    }
})

// THE REVERT is `defaultMenu` adding the item whatever `update` is: the app with no feed shows
// Check for Updates… too.
test("the update role stands under the app's name only where onLauncher names a feed — 38.149", () => {
    const roles = (update: string | undefined): string => {
        const [application] = menuBar('CRM', true, [], update, false)
        if (application === undefined || application === 'separator') return ''
        return (application.items ?? [])
            .map((item) => (item === 'separator' ? '—' : (item.role ?? '')))
            .join(' ')
    }
    expect(roles(undefined)).toBe('about — hide hideOthers showAll — quit')
    expect(roles('Check for Updates…')).toBe(
        'about update — hide hideOthers showAll — quit',
    )
})

test('onLauncher takes an update address, and refuses one that is not a URL — 38.80', () => {
    expect(
        launcherOf({ update: 'https://crm.example.com/updates' }),
    ).toMatchObject({
        update: 'https://crm.example.com/updates',
    })
    expect(launcherOf({}) as { update: unknown }).toMatchObject({
        update: undefined,
    })
    expect(launcherOf({ update: 'crm updates' })).toContain(
        '`update` is not a launcher option, or "crm updates" is not a value it takes',
    )
})

// 38.78, 38.87 — THE APP IS SHOWN BY ITS `APP_NAME` and kept by its package's name: the bundle's
// name, its display name and the `.app` are `Faster`, read from the `onConfig` its root layout files
// as `abide native` runs — past a schema that requires what only the start form supplies — and the
// executable and the identifier the platform keeps the app's state under stay `faster-app`. THE
// REVERT: name `infoPlist` and `out` by `executableName(identity.name)`, as before; the bundle is
// `faster-app.app` and its name `faster-app`. 38.194 — and it names the reasons the camera, the
// microphone and the location are asked for: WebKit leaves `navigator.mediaDevices` undefined in
// a bundle that names none. THE REVERT: drop the three entries from `infoPlist`; the camera's
// reason reads undefined.
test.skipIf(process.platform !== 'darwin')(
    'abide native names the bundle by APP_NAME and keeps its executable and identifier — 38.78, 38.87, 38.194',
    async () => {
        const app = temporaryModule({
            'package.json': JSON.stringify({
                name: '@acme/faster-app',
                version: '1.2.3',
                type: 'module',
            }),
            'src/index.abide': '<main>board</main>',
            'src/layout.abide': `<script server>
import { onConfig } from '@abide/abide/server'

onConfig(() => ({ APP_NAME: 'Faster' }), {
    schema: {
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: (value) =>
                value.API_KEY === undefined
                    ? { issues: [{ message: 'API_KEY is required' }] }
                    : { value },
        },
    },
})
</script>

<slot />
`,
        })
        const into = await workspace()
        const built = await spawned(
            ['bun', BIN, 'native', '--root', `${app}/src`],
            {
                cwd: into,
                env: { ...process.env, ABIDE_UPDATE_KEY: await newUpdateKey() },
            },
        )
        expect(built.stderr).not.toContain('error')
        expect(built.exitCode).toBe(0)
        const plist = await Bun.file(
            `${into}/Faster.app/Contents/Info.plist`,
        ).text()
        const entry = (key: string): string | undefined =>
            new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(
                plist,
            )?.[1]
        expect(entry('CFBundleName')).toBe('Faster')
        for (const [key, use] of [
            ['NSCameraUsageDescription', 'the camera'],
            ['NSMicrophoneUsageDescription', 'the microphone'],
            ['NSLocationUsageDescription', 'your location'],
            ['NSLocationWhenInUseUsageDescription', 'your location'],
        ])
            expect(entry(key as string)).toBe(
                `Faster uses ${use} when a page of it asks.`,
            )
        expect(entry('CFBundleDisplayName')).toBe('Faster')
        expect(entry('CFBundleExecutable')).toBe('faster-app')
        expect(entry('CFBundleIdentifier')).toBe('abide.app.faster-app')
        expect(
            await Bun.file(
                `${into}/Faster.app/Contents/MacOS/faster-app`,
            ).exists(),
        ).toBe(true)
    },
    120_000,
)
