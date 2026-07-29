// health() — the ISOMORPHIC health probe (CO2.4). Same call, same document, both sides.
//
// SERVER: composed in-proc — the framework baseline (`reachable`, the running abide `version`), the
// bind clock (`startedAt`/`uptime`), and the app's `onHealth` fields merged over it. `/__abide/health`
// is a thin wrapper around this call: it chooses the status code and nothing else, so the route and an
// in-proc caller cannot describe the same app differently.
// CLIENT: `await health()` fetches `/__abide/health` and returns that document verbatim.
//
// It used to be asymmetric — the server resolved `{ reachable, version }` and the ROUTE composed the
// rest — which meant `health()` could not tell a server-side caller whether the app was healthy, only
// that it existed. That was also why the return type had to be an index-signature bag: with the fields
// present on one side and absent on the other, nothing but `unknown` was true of both.
//
// THE TYPE IS GENERATED, not declared. `HealthAugmentation` is an augmentation seam that the generated
// `src/.abide/health.d.ts` fills in with the app's own `onHealth` return type, so `(await health()).db`
// is typed in the app that declares it and a compile error in the app that does not.
//
// A NAMED json import keeps the client bundle from inlining the rest of package.json.

import { version } from '../../package.json'
import { HEALTH_ROUTE } from './internal/HEALTH_ROUTE.ts'
import { healthSource } from './internal/healthSource.ts'
import { isBrowser } from './internal/isBrowser.ts'
import { log } from './log.ts'

// The fields every abide app answers with, whoever asks and from whichever side.
export interface HealthDocument {
    reachable: boolean
    version: string
    startedAt: string
    uptime: number
}

// THE AUGMENTATION SEAM. Empty here; the generated `src/.abide/health.d.ts` declares
//
//     declare module 'abide/shared/health' {
//         interface HealthAugmentation { onHealth: Awaited<ReturnType<typeof onHealth>> }
//     }
//
// A member on an interface rather than the more obvious `interface HealthFields extends <app type>`,
// because `extends` demands an object type with statically known members: an `onHealth` returning a
// union of two shapes — the ordinary way to write `healthy | degraded` — would generate a file that
// does not compile. Carrying the type as a MEMBER accepts anything, and the projection below is what
// decides whether it can contribute fields.
// biome-ignore lint/suspicious/noEmptyInterface: an INTERFACE is the mechanism, not a style choice — `declare module` can only merge into an interface, and the equivalent `type X = {}` the autofix prefers is unaugmentable, which silently unplugs every generated companion.
export interface HealthAugmentation {}

// The app's own fields, or `unknown` when nothing was generated (`T & unknown` is `T`, so the document
// stays exactly the baseline). A non-object `onHealth` return contributes nothing for the same reason
// the route ignores one at runtime.
export type HealthFields = HealthAugmentation extends { onHealth: infer Fields }
    ? Fields extends object
        ? Fields
        : unknown
    : unknown

export async function health(): Promise<HealthDocument & HealthFields> {
    if (isBrowser) {
        const response = await fetch(HEALTH_ROUTE)
        return (await response.json()) as HealthDocument & HealthFields
    }
    const source = healthSource()
    // No bound app (a bare script, a test importing the primitive): the process start is the honest
    // clock, and there is no hook to ask.
    const startedAt = source?.startedAt ?? performance.timeOrigin
    const document: HealthDocument = {
        reachable: true,
        version,
        startedAt: new Date(startedAt).toISOString(),
        uptime: Date.now() - startedAt,
    }
    const onHealth = source?.onHealth
    if (onHealth === undefined) return document as HealthDocument & HealthFields
    try {
        const fields = await onHealth()
        // A non-object return is ignored rather than spread — `{...'nope'}` would splat a string into
        // index keys and answer with a document nobody wrote.
        if (fields === null || typeof fields !== 'object')
            return document as HealthDocument & HealthFields
        return { ...document, ...fields } as HealthDocument & HealthFields
    } catch (caught) {
        // Fail CLOSED: a hook that throws is evidence of an unhealthy app, and the caller learns that
        // rather than the reason (the route turns this into a 503; the detail stays in the log).
        log.channel('abide:health').error('onHealth threw:', caught)
        return { ...document, reachable: false } as HealthDocument & HealthFields
    }
}
