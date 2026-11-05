// 38.71-38.75 — WHAT THE DESKTOP WINDOW SHOWS, apart from the window: the app booted here, one
// connected to elsewhere, or neither — and what the launcher did last, kept across launches.

import { mkdir } from 'node:fs/promises' // bun exposes no directory creation of its own

import { isFailed } from '#shared/Failed.ts'

import { configuredMount } from './config.ts'
import type { App } from './createApp.ts'
import { reportUnexpected } from './hooks.ts'
import type { Launcher } from './launcherOptions.ts'
import type { Launch } from './launcherPage.ts'
import { LISTENING } from './requestScope.ts'

/** What the launcher did last, and what its forms held, kept across launches. 38.73. */
type Remembered = {
    last: { start: Record<string, string> } | { connect: string } | null
    values: Record<string, string>
    url: string
    port: number
}

type Failure = NonNullable<Launch['failure']>

const LOOPBACK = '127.0.0.1'
const CONNECT_TIMEOUT_MILLISECONDS = 5000

/**
 * The launcher's state machine: start an app here, connect to one elsewhere, disconnect, and
 * remember which in `desktop.json` under `directory`.
 *
 * `boot` boots the app a start serves — `bootEntered` in the executable, anything an `App` in a test.
 */
export class DesktopSession {
    private readonly stateFile: string
    private readonly directory: string
    private readonly boot: () => Promise<App>
    readonly remembered: Remembered
    /** What the window shows: the app served here, one elsewhere, or neither. */
    private current: { url: string; app: App | undefined } | undefined
    /** The last start or connect that was refused, until the page shows it. */
    private failure: Failure | undefined

    private constructor(
        directory: string,
        boot: () => Promise<App>,
        remembered: Remembered,
    ) {
        this.directory = directory
        this.stateFile = `${directory}/desktop.json`
        this.boot = boot
        this.remembered = remembered
        this.current = undefined
        this.failure = undefined
    }

    /** The session `directory`'s `desktop.json` remembers, or a fresh one where there is none. */
    static async open(
        directory: string,
        boot: () => Promise<App>,
    ): Promise<DesktopSession> {
        const remembered: Remembered = {
            last: null,
            values: {},
            url: '',
            port: 0,
            ...(await Bun.file(`${directory}/desktop.json`)
                .json()
                .catch(() => ({}))),
        }
        return new DesktopSession(directory, boot, remembered)
    }

    /** The address the window shows, `undefined` where it shows the launcher. */
    get shown(): string | undefined {
        return this.current?.url
    }

    /** The refusal the page has yet to show, handed over once. */
    takeFailure(): Failure | undefined {
        const shown = this.failure
        this.failure = undefined
        return shown
    }

    // 38.72 — the form's values are the environment the app is booted under, so 27.8 coerces them
    // and 27.7's schema refuses them as it would any other.
    async start(values: Record<string, string>): Promise<Failure | undefined> {
        await this.disconnect()
        this.remembered.values = values
        for (const [name, value] of Object.entries(values))
            if (value === '') delete process.env[name]
            else process.env[name] = value
        let app: App
        try {
            app = await this.boot()
        } catch (thrown) {
            return this.refuse(refused('start', thrown))
        }
        try {
            await app
                // 38.75.
                .listen({ hostname: LOOPBACK, port: this.remembered.port })
                // The port the last launch served on, so the app's origin — and its storage with
                // it — is the one it had; any free one where that is taken.
                .catch(() => app.listen({ hostname: LOOPBACK, port: 0 }))
        } catch (thrown) {
            await app.stop().catch(reportUnexpected)
            return this.refuse(refused('start', thrown))
        }
        const server = LISTENING.server as Bun.Server<unknown>
        this.remembered.port = server.port ?? 0
        this.remembered.last = { start: values }
        this.current = {
            url: `${server.url.origin}${configuredMount()}/`,
            app,
        }
        await this.remember()
        return undefined
    }

    async connect(given: string): Promise<Failure | undefined> {
        const text = given.trim()
        this.remembered.url = text
        const url = URL.parse(
            /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`,
        )
        if (
            url === null ||
            (url.protocol !== 'http:' && url.protocol !== 'https:')
        )
            return this.refuse({
                form: 'connect',
                message: `${text} is not an address.`,
                issues: {},
            })
        try {
            await fetch(url, {
                method: 'HEAD',
                redirect: 'manual',
                signal: AbortSignal.timeout(CONNECT_TIMEOUT_MILLISECONDS),
            })
        } catch {
            return this.refuse({
                form: 'connect',
                message: `Nothing answered at ${url.origin}.`,
                issues: {},
            })
        }
        await this.disconnect()
        this.remembered.last = { connect: url.href }
        this.current = { url: url.href, app: undefined }
        await this.remember()
        return undefined
    }

    /** Stops the app served here, if one is, and shows neither. */
    async disconnect(): Promise<void> {
        const leaving = this.current
        this.current = undefined
        if (leaving?.app !== undefined)
            await leaving.app.stop().catch(reportUnexpected)
    }

    /** 38.74 — disconnects, and forgets what was done last so the next launch does not redo it. */
    async forget(): Promise<void> {
        this.remembered.last = null
        await Promise.all([this.remember(), this.disconnect()])
    }

    /** 38.73 — WHAT IT DID LAST, done again, where the launcher still offers it. */
    async resume(options: Launcher): Promise<void> {
        const last = this.remembered.last
        if (options.start && last !== null && 'start' in last)
            await this.start(last.start)
        else if (options.connect && last !== null && 'connect' in last)
            await this.connect(last.connect)
    }

    private refuse(failure: Failure): Failure {
        this.failure = failure
        return failure
    }

    private async remember(): Promise<void> {
        await mkdir(this.directory, { recursive: true })
        await Bun.write(
            this.stateFile,
            JSON.stringify(this.remembered, null, 4),
        )
    }
}

/** A refusal as the form it came back to: 27.7's issues by field, or the error's message. */
function refused(form: 'start' | 'connect', thrown: unknown): Failure {
    if (
        isFailed(thrown) &&
        thrown.data !== null &&
        typeof thrown.data === 'object'
    )
        return {
            form,
            message: 'The configuration was refused.',
            issues: Array.isArray(thrown.data)
                ? { '': thrown.data as string[] }
                : (thrown.data as Record<string, string[]>),
        }
    return {
        form,
        message: thrown instanceof Error ? thrown.message : String(thrown),
        issues: {},
    }
}
