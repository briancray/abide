// `bun run fleet` — this app and every demo app, on one origin.
//
// `bun run dev` serves this app alone, which is the right default: it is the one being worked on, and
// booting four processes to look at a docs page is a tax on every edit. The fleet is for the other
// half — the demo apps are REAL applications with their own shells and their own headers, and the only
// way to reach several of them from one origin is a proxy in front. `harness/fleet.ts` is that proxy;
// this is the table it forwards by, plus the processes behind it.
//
// Here rather than at the repo root because the root package has no `harness` to import — workspace
// links are per-package — and because the composition is this app's: it is the site that SHOWS the
// demos, and `/demos` reads the same `APPS` list this does.
//
// Ports are FIXED and deliberate (4400 door, 4401 here, 4402+ per app). A dev server that hops on
// collision is fine alone and impossible in a fleet: the door would forward to a port nothing is on,
// and the failure arrives as a 502 from an app that is running perfectly well somewhere else.

import { frontDoor } from 'harness/fleet'
import { LISTENING, readLines, spawn } from 'harness/spawn'
import { APPS, DOOR, HOST } from '#shared/demos/APPS.ts'
import { APP_ROOT } from './PATHS.ts'

const BINARY = Bun.resolveSync('abide/cli', import.meta.dir)

interface Child {
    label: string
    process: ReturnType<typeof spawn>
}

const children: Child[] = []

/**
 * One app, told where it lives.
 *
 * `APP_URL` is the whole of how an app learns its own base — it is not a second knob, it is the one
 * an operator has already set. Everything the app serves and every href it writes carries it.
 */
function boot(label: string, cwd: string, port: number, base: string | null): Child {
    const child = spawn([BINARY, 'dev', '--port', String(port)], {
        cwd,
        env: {
            ...process.env,
            ...(base === null ? {} : { APP_URL: `http://localhost:${DOOR}${base}` }),
        },
    })
    const started: Child = { label, process: child }
    children.push(started)
    return started
}

/** Its own line, prefixed, so four processes on one terminal are still readable. */
async function relay(child: Child): Promise<void> {
    for await (const line of readLines(child.process.stdout)) console.log(`${child.label} · ${line}`)
}

/** Resolved once it says it is listening, so the door is not opened onto ports nothing answers on. */
async function listening(child: Child): Promise<void> {
    for await (const line of readLines(child.process.stdout)) {
        console.log(`${child.label} · ${line}`)
        if (line.includes(LISTENING)) return
    }
}

const here = boot('dogfood', APP_ROOT, HOST, null)
const demos = APPS.map((app) => ({ app, child: boot(app.name, `${APP_ROOT}/../${app.name}`, app.port, app.prefix) }))

// In parallel: the apps do not depend on each other, and the dogfood build is the long one.
await Promise.all([listening(here), ...demos.map(({ child }) => listening(child))])

const door = frontDoor(
    DOOR,
    demos.map(({ app }) => ({ prefix: app.prefix, port: app.port })),
    HOST,
)

console.log(`\nfleet · ${door.url}`)
for (const { app } of demos) console.log(`fleet ·   ${door.url}${app.prefix}${app.entry} — ${app.title}`)
console.log('')

// Whatever they say from here on, still prefixed. Not awaited: this is the tail of the run.
void Promise.all([relay(here), ...demos.map(({ child }) => relay(child))])

/** One signal, one teardown. A child left running holds the port the next boot needs. */
const stop = (): never => {
    door.stop()
    for (const child of children) child.process.kill()
    process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
