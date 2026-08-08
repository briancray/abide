// A booted app, spawned, for `test/lifecycle.test.ts`.
//
// Everything here is a claim about a PROCESS — which signal it answers, what it prints on the way
// out, whether the socket is really shut — so none of it can be made in a browser card and none of it
// can be made in the test runner's own process either: `boot` takes SIGINT away from whoever owned
// it, which under `bun test` is the runner. The card-showable half is `demos/lifecycle.ts`.
//
// One binary, three modes, because the three differ only in which hook is registered — a second file
// per mode would be three copies of the same boot.

import {
    appName,
    boot,
    config,
    handle,
    json,
    onConfig,
    onStart,
    onStop,
    shutdown,
    websocket,
} from 'abide/server'

const mode = Bun.argv[2] ?? 'serve'

if (mode === 'config') {
    // The three layers against a REAL environment rather than one a test wrote into its own process:
    // `PORT` is the operator, `8080` is the app, and `3000` is abide's floor under both.
    onConfig(() => ({ PORT: 8080, TAG: `${appName()}-tag` }))
    console.log(JSON.stringify({ port: config().PORT, tag: config<{ TAG: string }>().TAG }))
    process.exit(0)
}

if (mode === 'requires') {
    // A key this app cannot work without, declared as the same `Schema` an rpc takes. The default
    // only carries the field when the environment named it, so "unset" is genuinely a MISSING member
    // rather than one present and undefined — which is the difference `required` is about.
    onConfig(() => (Bun.env.STRIPE_KEY === undefined ? null : { STRIPE_KEY: Bun.env.STRIPE_KEY }), {
        schema: {
            type: 'object',
            properties: { STRIPE_KEY: { type: 'string' } },
            required: ['STRIPE_KEY'],
        },
    })
    let listening = false
    try {
        await boot(() => {
            listening = true
            return bind()
        })
    } catch (refusal) {
        console.log(`refused ${(refusal as Error).name}: listening=${listening}`)
        process.exit(1)
    }
    console.log('booted')
    process.exit(0)
}

if (mode === 'breakout') {
    // A hook that decided this process should not serve. Nothing binds, and `boot` says so.
    onStart(() => {
        console.log('refusing to start')
    })
    const bound = await boot(() => bind())
    console.log(`boot answered ${bound === null ? 'null' : 'a server'}`)
    process.exit(0)
}

if (mode === 'backstop') {
    // Drains and returns WITHOUT calling `stop()`. The socket has to close anyway, which is a claim
    // only a real socket can settle: the app asks its own port afterwards and prints what it found.
    onStop(() => {
        console.log('drained')
    })
    const running = await boot(() => bind())
    const url = running?.url.href ?? ''
    console.log(`listening ${url}`)
    await shutdown()
    const after = await fetch(url).then(
        () => 'still listening',
        () => 'closed',
    )
    console.log(`after shutdown: ${after}`)
    process.exit(0)
}

// The default: bind, print the URL, and wait to be signalled. `onStop` drains around the close, and
// the exit is abide's — adding a SIGINT handler is what stops the default from terminating.
onStop(async (stop) => {
    console.log('draining')
    await stop()
    console.log('drained')
})

const running = await boot(() => bind())
console.log(`listening ${running?.url.href ?? ''}`)

function bind(): ReturnType<typeof Bun.serve> {
    return Bun.serve({
        port: 0,
        fetch: handle((request) => json({ path: new URL(request.url).pathname })),
        websocket,
    })
}
