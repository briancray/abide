// What the process was told, typed, with the app's own defaults under it.
//
// Three layers and the order is the whole thing: abide's FLOOR, then the app's DEFAULTS, then what
// the operator DECLARED. The app's layer LOSING to the environment is what makes it a default — a
// value that beat `PORT` would be a knob that does nothing — and that is the opposite of how
// `onHealth` and `onIdentity` merge, deliberately. Those are the app asserting something it knows
// better than the framework does; a config field is the app requesting something an operator may
// overrule.
//
// This is the one ambient with no wire face. `health()` and `identity()` are isomorphic because a
// browser is allowed both answers; half of this document is `ABIDE_IDENTITY_SECRET` and
// `ABIDE_APP_TOKEN`, so there is no `GET /__abide/config` and there is no browser half to fetch one.
// An app that wants a public subset publishes it through an rpc, which is one line and is a decision
// somebody made on purpose.

import { log, memo } from 'abide'
import { appDataDir, appName, boot, type Config, config, onConfig } from 'abide/server'
import { loopback, suite } from 'abide-kit'
import { button, row, stage } from './dom.ts'
import { DECLARABLE, withEnv } from './env.ts'
import { LADDER } from './fixtures/config/ladder.ts'
import { META } from './SUITES.ts'

/** The remote feed's address, which is what a `logs` default is asserted against. */
const LOGS = '/__abide/logs'

/** What the app half of this demo declares, so `config<Extra>()` has something to be typed by. */
interface Extra {
    CHECKOUT_URL: string
    POOL: number
}

/** The NAME a read refused with, which is the thing a caller asks about rather than the class. */
function caught(): string {
    try {
        config()
    } catch (refusal) {
        return (refusal as Error).name
    }
    return 'nothing was refused'
}

export default suite({
    ...META.config,
    examples: LADDER,
    cases: [
        {
            title: 'every knob abide reads, as the type it actually is',
            note: 'The one place the environment table exists as code. A field is never absent — a floor fills in whatever nobody declared — so a reader asks one question rather than writing the `?? 3000` half of them forget, which is the rule `identity()` is never null by. `PORT` is a number and not the string held, `ABIDE_LOGS` is a boolean and not "is the variable there", and `ABIDE_MAX_REQUEST_BODY_SIZE` is `Infinity` rather than a `null` every caller has to branch on.',
            run({ is }) {
                const settings = config()

                is('a port, typed', typeof settings.PORT, 'number')
                is('a flag, typed', typeof settings.ABIDE_LOGS, 'boolean')
                is(
                    'unset means no limit, not null',
                    settings.ABIDE_MAX_REQUEST_BODY_SIZE,
                    Number.POSITIVE_INFINITY,
                )
                // `null` for a thing that was genuinely not said, where a NUMBER's absence has a
                // number to mean it. A secret that defaulted to a string would be a signing key.
                is('a secret nobody declared is null', settings.ABIDE_IDENTITY_SECRET, null)
                // The derived facts are NOT fields — they are conclusions, and keeping one here
                // would be a second spelling of the same answer. Two of them have their own export
                // on `abide/server`, asserted below; `NODE_ENV`'s conclusion is drawn internally by
                // `identity.ts` and is not public, so what an app gets is the variable.
                is('a name is an accessor, not a field', typeof appName(), 'string')
                is('and so is the data directory', typeof appDataDir(), 'string')
            },
        },

        {
            title: 'onConfig sets DEFAULTS — under what the operator declared',
            note: 'The middle layer. `onConfig(() => ({ PORT: 8080 }))` says "8080 unless somebody set `PORT`", and the environment wins where it named the same field, because a default that overruled an operator is not a default. The hook receives the typed environment already assembled, so a default may be computed from one — the floors are filled in, which is why it can branch on `NODE_ENV` without a null check of its own.',
            async run({ is }) {
                const off = onConfig((env) => ({
                    PORT: 8080,
                    POOL: env.NODE_ENV === 'production' ? 20 : 2,
                    CHECKOUT_URL: `${appName()}/checkout`,
                }))

                // The type argument is how an app's own fields get one — the same spelling
                // `server<WebSocketData>()` uses, and for the same reason: only the caller knows.
                const settings = config<Extra>()
                is('the app’s default stands where nothing declared one', settings.PORT, 8080)
                // The RELATION rather than either number: which lane this is decides `NODE_ENV`, and
                // the claim is that the hook branched on the environment it was handed.
                is(
                    'and its own fields ride along',
                    settings.POOL,
                    settings.NODE_ENV === 'production' ? 20 : 2,
                )
                is('computed off an accessor', settings.CHECKOUT_URL, `${appName()}/checkout`)

                if (DECLARABLE) {
                    await withEnv({ PORT: '9123' }, () => {
                        is('what the operator declared wins', config<Extra>().PORT, 9123)
                    })
                    // `PORT` is the one field where ZERO is an answer, enumerated rather than
                    // inferred: every other number abide reads is a size, a ring or a deadline, and
                    // zero there would disable the thing it was meant to size. `0` is the kernel's
                    // own spelling of "whatever is free", which is what `abide start --port 0` asks
                    // for and what a container with a port mapped in front of it means.
                    await withEnv({ PORT: '0' }, () => {
                        is('zero is a port, not nonsense', config<Extra>().PORT, 0)
                    })
                    // And checked as a PORT rather than as a number: `70000` is a typo, and abide's
                    // floor is a better answer than a bind failing at a number nothing in the
                    // document admits to. The FLOOR rather than the app's 8080, because the variable
                    // WAS declared — that is the same rule every number abide owns follows, and it
                    // is why `PORT=nonsense` is 3000 rather than `NaN`.
                    await withEnv({ PORT: '70000' }, () => {
                        is('a number that is not a port falls to the floor', config<Extra>().PORT, 3000)
                    })
                    await withEnv({ PORT: '3000.5' }, () => {
                        is('and neither is a fraction', config<Extra>().PORT, 3000)
                    })
                    // The APP's own field, overridden by a variable of the SAME NAME — the half that
                    // has no entry in abide's table and would otherwise be the app's last word.
                    await withEnv({ CHECKOUT_URL: 'https://pay.test/go' }, () => {
                        is(
                            'and an app’s own field is overridable too',
                            config<Extra>().CHECKOUT_URL,
                            'https://pay.test/go',
                        )
                    })
                    // Coerced to the type of the DEFAULT it overrides, because that is the only thing
                    // here that says what the field IS: an environment carries only strings.
                    await withEnv({ POOL: '30' }, () => {
                        is('coerced to the default’s type', config<Extra>().POOL, 30)
                    })
                    await withEnv({ POOL: 'nonsense' }, () => {
                        is('and an unreadable one keeps the default', config<Extra>().POOL, 2)
                    })
                }

                off()
                is('off again is the floor', config().PORT, 3000)

                // The RANGE is the document's, not the variable's. An operator is not the only one
                // who can name a number, so a default an app wrote out of range gets the same answer
                // `PORT=70000` does — which is what makes `config().PORT` a port for every reader,
                // rather than a number each of them floors its own way on the way to a socket.
                const wrong = onConfig(() => ({ PORT: 70000 }))
                is('an app’s own default is checked as a port too', config().PORT, 3000)
                wrong()
            },
        },

        {
            title: 'a derived fact is not a field — but the variable under it is',
            note: 'A name, a version and a data directory are CONCLUSIONS rather than variables. `appName()` is `ABIDE_APP_NAME`, else the nearest package.json — which knows more about what this app is called than a fallback written inside it — and `appDataDir()` is `ABIDE_DATA_DIR` resolved against the directory the PLATFORM chose. Keeping either conclusion in the document would be a second spelling of an answer that already has an export, and two spellings is how they come to disagree. So the ACCESSOR is not a field and the VARIABLE it reads is — and the accessor reads that field out of the document like every other knob abide reads, because a `config()` that published `ABIDE_DATA_DIR` while the app wrote somewhere else is exactly the disagreement an operator has no way to catch. Defaulting the variable moves the conclusion; the climb underneath it is not a knob and there is nothing there to default.',
            run({ is }) {
                const climbed = appName()
                const off = onConfig(() => ({ ABIDE_APP_NAME: 'renamed' }))

                is('the field takes the app’s default', config().ABIDE_APP_NAME, 'renamed')
                // The half that makes the field worth publishing: a default nothing honoured would be
                // a document naming this app one thing while every log line named it another.
                is('and the accessor over it resolves the same answer', appName(), 'renamed')

                off()
                // The conclusion is not itself a field, so with nothing declared it is the climb again
                // rather than a floor written into the table.
                is('off again is what the package.json says', appName(), climbed)
                is('and the accessor was never in the document', 'appName' in config(), false)
            },
        },

        {
            title: 'resolved ONCE, because an operator’s answer is a process fact',
            note: 'A question about the PROCESS rather than about a caller, like `appDataDir()` and unlike `request()` — it does not differ between two callers, so it is read once and answered synchronously forever after. A config you have to await is a config every reader has to await. `invalidate()` is how a rotated environment is seen, and registering a hook drops what was resolved on its own, so the order of an app’s own imports cannot decide whether its defaults were read.',
            async run({ is }) {
                let asked = 0
                const off = onConfig(() => {
                    asked++
                    return { POOL: asked }
                })

                is('the first ask resolves', config<Extra>().POOL, 1)
                is('the second does not', config<Extra>().POOL, 1)
                is('the hook ran once', asked, 1)

                config.invalidate()
                is('until it is invalidated', config<Extra>().POOL, 2)

                // Taking the disposer first is what makes a re-registration deliberate. A SECOND
                // hook over a live one is the mistake — two modules that did not know about each
                // other — and abide warns rather than quietly answering with the survivor's floor.
                off()
                const again = onConfig(() => ({ POOL: 99 }))
                is('registering again applies to the next ask', config<Extra>().POOL, 99)
                again()
            },
        },

        {
            title: 'the document is the SOURCE — a default reaches the path',
            note: '`config()` is what every knob abide reads is answered from, rather than a report beside paths that read `Bun.env` themselves. That is what makes a default a default: `onConfig(() => ({ ABIDE_LOGS: true }))` opens the actual feed, not a `true` nothing honours. Two seams carry it the whole way. `$shared` may not import `$server`, so the three ceilings ask through `useConfigSource` — the same inversion `useLogSink` is — which is why a browser build keeps its floor and a card asserts that. And an rpc’s `timeout` and `maxBodySize` resolve at the DOOR rather than at the declaration, because a declaration runs at import and could never have seen a hook registered after it. The logger reads across that same seam — its gate, its line shape and the app’s name are all fields — and it is the one reader `config()` itself needs, so a hook that logs would re-enter the resolve that is running it. A read taken DURING a resolve is answered from the layer already assembled, which is what makes the cycle a null check rather than a stack overflow.',
            async run({ is }) {
                const wire = loopback()
                is(
                    'closed with nothing declared and no hook',
                    (await wire.fetch(LOGS, { method: 'GET' })).status,
                    404,
                )

                // A `$shared` ceiling, watched the way the ceilings suite watches one: in BODY RUNS,
                // because a cache that evicted the wrong row still answers every question correctly.
                let runs = 0
                const rows = memo(
                    ({ id }: { id: string }) => {
                        runs++
                        return id.padEnd(100, 'x')
                    },
                    { global: true },
                )
                for (const id of ['a', 'b', 'c']) rows({ id })()
                rows({ id: 'a' })()
                is('unbounded, nothing is evicted', runs, 3)

                const off = onConfig(() => ({ ABIDE_LOGS: true, ABIDE_MAX_GLOBAL_CACHE_SIZE: 250 }))
                is('the app’s default publishes', config().ABIDE_LOGS, true)

                // The endpoint rather than the field: publishing `true` and answering 404 is exactly
                // the disagreement this case exists to rule out.
                const opened = await wire.fetch(LOGS, { method: 'GET' })
                is('and the feed it names is open', opened.status, 200)
                // The body never ends — it is a live tail — so it is dropped rather than read.
                await opened.body?.cancel()

                // The `$shared` half, over the seam a ceiling could not otherwise be reached across.
                // Rows admitted UNDER the ceiling, and that is the mechanism rather than a detail:
                // unbounded, `admit` untracks everything it was holding, so what was cached before a
                // ceiling existed is not what a ceiling set afterwards can evict. 250 bytes holds
                // two of these, so the third is what puts the first out.
                for (const id of ['p', 'q', 'r']) rows({ id })()
                const loaded = runs
                rows({ id: 'p' })()
                is('and a ceiling in $shared evicts, so the oldest reloads', runs, loaded + 1)

                off()
                is('off again is closed', (await wire.fetch(LOGS, { method: 'GET' })).status, 404)

                // The seam's own cycle, and the reason a read taken DURING a resolve is answered from
                // the layer already assembled: the logger's three knobs are fields, so a hook that
                // writes a line asks the document that is still being built. Counted in HOOK RUNS
                // rather than in output, because the wrong implementation logs the right line — from
                // inside a second resolve, then a third.
                let resolves = 0
                const logging = onConfig(() => {
                    resolves++
                    log(`resolving as ${appName()}`)
                    return { ABIDE_APP_NAME: 'renamed-by-the-hook' }
                })
                is('the accessor over the field it set', appName(), 'renamed-by-the-hook')
                is('and the hook that read it ran once', resolves, 1)
                logging()
            },
        },

        {
            title: 'a hook that throws is a process that cannot be configured — and boot refuses',
            note: 'Unlike `onHealth`, which fails soft because a reporter that throws is still an account of the app, this fails hard: the safe reading of "I could not work out my configuration" is not "serve anyway with a hole in it". `boot` asks BEFORE it binds, so a missing key is a process that never listens rather than a 500 on whichever request happened to need it — long after the deploy that shipped without it looked like it had worked.',
            async run({ is, throws, rejects }) {
                const off = onConfig(() => {
                    throw new Error('STRIPE_KEY is required')
                })

                throws('the read carries it', () => config(), 'STRIPE_KEY is required')

                let bound = false
                await rejects(
                    'and the boot with it',
                    boot(() => {
                        bound = true
                        return 'the socket'
                    }),
                    'STRIPE_KEY is required',
                )
                is('so nothing bound', bound, false)

                off()
                is(
                    'with the hook off, the boot is the ordinary one',
                    await boot(() => 'the socket'),
                    'the socket',
                )
            },
        },

        {
            title: 'the same Schema a transport takes, over the assembled document',
            note: 'A second shape language for the same job would be a second thing to learn and a second validator to keep in step, so this is the `Schema` an rpc declares: a JSON Schema, a plain function, or a Standard Schema. It runs LAST, over the whole document — a shape that ran before the merge would be checking a layer rather than the answer — and it is the one door config has. A document is left OPEN by every shape abide derives, so a schema naming `POOL` and nothing else lets abide’s own fields through untouched: a config schema describes what the APP needs, not the environment table.',
            async run({ is, throws }) {
                // The NATIVE form. It refuses and publishes; what it deliberately does not do is
                // coerce — a shape that quietly turned `"3"` into `3` would be a lie in the one
                // document a machine reads before it acts.
                const refuses = onConfig(() => ({ POOL: 'four' }), {
                    schema: {
                        type: 'object',
                        properties: { POOL: { type: 'number' } },
                        required: ['POOL'],
                    },
                })
                throws('a field of the wrong type is refused', () => config(), 'POOL')
                // The NAME rather than the class, which is the question that outlives a constructor
                // — the same one `fn.isError(e, 'AbideSchemaError')` asks after a trip over a wire.
                is('under the one name every shape refusal travels by', caught(), 'AbideSchemaError')
                refuses()

                // A missing field, which is the whole reason to declare one: the deploy that shipped
                // without the key fails at the boot rather than on the request that needed it.
                const missing = onConfig(null, {
                    schema: {
                        type: 'object',
                        properties: { STRIPE_KEY: { type: 'string' } },
                        required: ['STRIPE_KEY'],
                    },
                })
                throws('a required field nobody set', () => config(), 'STRIPE_KEY')
                is('the same refusal, so one catch covers both', caught(), 'AbideSchemaError')
                missing()

                // The FUNCTION form returns what it accepts, so it normalises as well as refuses —
                // which is what turns an app's raw environment reads into the numbers its own code
                // expects. `null` defaults: this app declared a shape and nothing else.
                const normalises = onConfig(() => ({ POOL: '8' }), {
                    schema: (value) => {
                        const held = value as { POOL: unknown }
                        const pool = Number(held.POOL)
                        if (!Number.isFinite(pool)) throw new Error('POOL must be a number')
                        return { ...held, POOL: pool } as never
                    },
                })
                is('the document is what the shape RETURNED', config<Extra>().POOL, 8)
                is('and abide’s own fields came through it', typeof config().PORT, 'number')
                normalises()

                // A Standard Schema may validate asynchronously, and this is the one place in abide
                // that cannot wait for one. Refused by NAME rather than by taking the promise as a
                // value, which would put a `Promise` in a field somebody was about to read.
                const waits = onConfig(null, {
                    schema: {
                        '~standard': {
                            version: 1,
                            vendor: 'demo',
                            validate: (value: unknown) => Promise.resolve({ value: value as Config }),
                        },
                    },
                })
                throws(
                    'an async validator is refused, and says what to do instead',
                    () => config(),
                    'onStart',
                )
                waits()
            },
        },

        {
            title: 'interact — read the document this page is running under',
            interact({ host, log }) {
                let off: (() => void) | null = null
                const show = (): void => {
                    const settings = config()
                    const lines: string[] = []
                    for (const field of Object.keys(settings).sort()) {
                        const held = settings[field]
                        // The two credentials, refused by name. Everything else prints, because a
                        // document you cannot read is one nobody checks.
                        const secret = field === 'ABIDE_IDENTITY_SECRET' || field === 'ABIDE_APP_TOKEN'
                        lines.push(
                            `${field} = ${secret && held !== null ? '<declared>' : JSON.stringify(held)}`,
                        )
                    }
                    log.live('config', lines.join('\n'))
                }

                host.append(
                    stage(
                        row(
                            button('read it', show),
                            button('default { POOL: 8 }', () => {
                                // Shouted, like every other field: a lowercase one here would teach the
                                // opposite of the rule this page is about.
                                off?.()
                                off = onConfig(() => ({ POOL: 8 }))
                                show()
                            }),
                            button('stop defaulting', () => {
                                off?.()
                                off = null
                                config.invalidate()
                                show()
                            }),
                        ),
                    ),
                )
                log('config', '—')
            },
        },
    ],
})
