// `boot` and `shutdown` — the half of the lifecycle that is a claim about a PROCESS.
//
// Not a demo, and deliberately, for the reason `serve.test.ts` is not one: a demo case runs both
// headless and inside a browser card, and a card cannot bind a socket, receive a SIGTERM or observe
// an exit code. The onions themselves — `onStart` wrapping the bind, the middleware chain, the
// deliberate/unexpected split — ARE card-showable and live in `demos/lifecycle.ts`.
//
// Spawned rather than run in-process, because `boot` installs the signal handlers: doing that under
// `bun test` would take Ctrl-C away from the runner.

import { expect, test } from 'bun:test'
import { EXAMPLE_ROOT, type Reading, reading } from './spawned.ts'

const APP = `${import.meta.dir}/lifecycle-app.ts`

function start(mode?: string, declared?: Record<string, string | undefined>): Reading {
    return reading(['bun', APP, ...(mode === undefined ? [] : [mode])], {
        // The example package rather than the repo root, because `name` is the NEAREST package.json
        // above the working directory — from the root it would be the workspace's, which is a
        // different app with the same files under it.
        cwd: EXAMPLE_ROOT,
        env: declared,
    })
}

test('boot binds inside onStart, serves through handle, and drains on SIGTERM', async () => {
    const app = start()

    const listening = await app.until('')
    expect(listening).toStartWith('listening http://')
    const url = listening.slice('listening '.length)

    // The socket is real, and what answers on it is the app's route with abide's pipeline in front.
    const answered = await fetch(`${url}orders/9`)
    expect(answered.status).toBe(200)
    expect(await answered.json()).toEqual({ path: '/orders/9' })
    // Every response abide builds names the operation that answered it, and `handle` opened the
    // request scope that makes one answerable.
    expect(answered.headers.get('traceresponse')).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/)

    // `/__abide/**` is served in front of the app's routes without the app mounting anything.
    const health = await fetch(`${url}__abide/health`)
    expect(health.status).toBe(200)
    expect(((await health.json()) as { reachable: boolean }).reachable).toBe(true)

    app.child.kill('SIGTERM')
    expect(await app.until('')).toBe('draining')
    expect(await app.until('')).toBe('drained')

    // The exit is abide's: adding a handler is what stops SIGTERM from terminating, so a process
    // that only drained would sit there ignoring its own signal.
    expect(await app.child.exited).toBe(0)
    expect(await new Response(app.child.stderr).text()).toBe('')
})

test('a hook that skips stop() still leaves a closed socket behind', async () => {
    const app = start('backstop')

    expect(await app.until('')).toStartWith('listening http://')
    expect(await app.until('')).toBe('drained')
    // The claim, and the reason this is a spawned process: the hook never called `stop()`, and the
    // app's own port no longer answers. A backstop that only ran the hook would print the other one.
    expect(await app.until('')).toBe('after shutdown: closed')
    expect(await app.child.exited).toBe(0)
})

test('a breakout never binds, and boot says so', async () => {
    const app = start('breakout')

    expect(await app.until('')).toBe('refusing to start')
    expect(await app.until('')).toBe('boot answered null')
    expect(await app.child.exited).toBe(0)

    // Said once, and never gated: the `DEBUG` gate controls volume rather than breakage, and a
    // process that decided not to serve is the one thing an operator has to be told.
    expect(await new Response(app.child.stderr).text()).toContain('onStart returned without calling start()')
})

// `demos/config.ts` owns the resolution ORDER and covers more of it than this does — coercion, the
// port floor, the app-field override. What a spawn shows that `withEnv` cannot is the two halves
// that are not in-process: `tag` comes from `appName()` climbing to the nearest package.json above
// the cwd, which is why `start()` passes one, and the operator's value arrives across a process
// boundary rather than from a write into this test's own `Bun.env`.
test('config layers a real environment over the app’s defaults over abide’s floor', async () => {
    // Nothing declared: the app's own default stands, and it was computed off the environment it was
    // handed — `name` came from the package.json climb, which is a fact no default may overrule.
    const defaulted = start('config', { PORT: undefined })
    expect(JSON.parse(await defaulted.until('')) as unknown).toEqual({ port: 8080, tag: 'example-tag' })
    expect(await defaulted.child.exited).toBe(0)

    // Declared: the operator wins, which is the whole of what makes the app's layer a DEFAULT rather
    // than a knob that does nothing.
    const declared = start('config', { PORT: '9123' })
    expect(JSON.parse(await declared.until('')) as unknown).toEqual({ port: 9123, tag: 'example-tag' })
    expect(await declared.child.exited).toBe(0)
})

test('a config the declared shape refuses is a process that never listens', async () => {
    // The deploy that shipped without the key. The socket is real and was never reached: `boot`
    // resolves the config first, so this is an exit code rather than a 500 on whichever request
    // happened to need `stripeKey`.
    const missing = start('requires', { STRIPE_KEY: undefined })
    expect(await missing.until('')).toBe('refused AbideSchemaError: listening=false')
    expect(await missing.child.exited).toBe(1)

    const declared = start('requires', { STRIPE_KEY: 'sk_test_1' })
    expect(await declared.until('')).toBe('booted')
    expect(await declared.child.exited).toBe(0)
})
