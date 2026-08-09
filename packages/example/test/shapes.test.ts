// The second speed: what the real CHECKER can say about a shape that the token scanner cannot.
//
// A test file rather than a demo case, for the same reason the wire test is one: this spawns Node,
// which spawns `tsgo`, and opens the whole project. A browser card cannot do any of that, and the
// claim is exactly about the lane that can.
//
// Two things are asserted, and the second is the one that matters. First, that the checker resolves
// the types syntax cannot — `Omit`, `Pick`, an `enum`, a generic alias. Second, that the token pass
// is still HONEST about not knowing them: it publishes nothing rather than a guess, so the upgrade is
// an upgrade rather than a correction.

import { expect, test } from 'bun:test'
import { elide } from 'abide/compiler'
import { NAMED_FORMATS } from 'abide/compiler/assemble'
import { deriveShapes } from 'abide/compiler/shapes'
import { validateJson } from 'abide/server'

const FIXTURE = new URL('../types/checker/server/rpc/computed.ts', import.meta.url).pathname

// `cwd` and `tsconfig` named EXPLICITLY rather than left to default off `process.cwd()`: they are
// what lets a caller point the checker at a project it is not being run from, and the fixture tree
// has a config of its own. Defaulted, this passes only because `bun test` happens to run from the
// workspace root — which is a property of the runner, not of the pass.
const CHECKER_ROOT = new URL('../', import.meta.url).pathname
const CHECKED = await deriveShapes({
    roots: [new URL('../types/checker/', import.meta.url).pathname],
    cwd: CHECKER_ROOT,
    tsconfig: `${CHECKER_ROOT}tsconfig.json`,
})
const SYNTAX = elide(await Bun.file(FIXTURE).text(), { filename: FIXTURE })

function syntaxFor(name: string): { input?: unknown; output?: unknown } {
    return (SYNTAX?.endpoints ?? []).find((one) => one.name === name) ?? {}
}

test('`Omit` resolves, and the token pass says nothing rather than guessing', () => {
    expect(syntaxFor('create').input).toBeUndefined()
    expect(CHECKED['computed/create']?.input).toEqual({
        type: 'object',
        properties: {
            name: { type: 'string' },
            secret: { type: 'string' },
            tag: { type: 'string' },
        },
        // `tag` is optional in `Full`, and `Omit` keeps it that way.
        required: ['name', 'secret'],
    })
})

test('an enum resolves to the closed set it is, and `Pick` to its members', () => {
    // The scanner sees a member it cannot read and leaves the SLOT empty rather than dropping it —
    // which is what makes the upgrade a merge rather than a rewrite.
    expect(syntaxFor('byRole').input).toEqual({
        type: 'object',
        properties: { role: {}, only: {} },
        required: ['role', 'only'],
    })
    expect(CHECKED['computed/byRole']?.input).toEqual({
        type: 'object',
        properties: {
            role: { type: 'string', enum: ['admin', 'user'] },
            only: {
                type: 'object',
                properties: { id: { type: 'number' }, name: { type: 'string' } },
                required: ['id', 'name'],
            },
        },
        required: ['role', 'only'],
    })
})

test('a generic alias resolves at the instantiation', () => {
    expect(syntaxFor('boxed').input).toBeUndefined()
    expect(CHECKED['computed/boxed']?.input).toEqual({
        type: 'object',
        properties: { value: { type: 'string' }, count: { type: 'number' } },
        required: ['value', 'count'],
    })
})

test('an output nobody annotated is read off the declaration', () => {
    // None of these handlers annotates a return type, so the token pass has nothing to read. The
    // checker has the declaration's own `Rpc<Args, T>`, which is where both directions already live.
    expect(syntaxFor('boxed').output).toBeUndefined()
    expect(CHECKED['computed/boxed']?.output).toEqual({ type: 'string' })
})

test('the app’s own endpoints are covered, and the addresses are the same ones', async () => {
    const app = await deriveShapes({ roots: [new URL('../', import.meta.url).pathname] })
    // The addresses come from `endpointId`, so a checker answer lands on the endpoint it is about —
    // this is the join, and a rename on either side breaks it here rather than silently.
    expect(Object.keys(app)).toContain('users/getUser')
    expect(Object.keys(app)).toContain('feed/ticks')
    // `Omit` again, in the real app: the one endpoint whose shape needs this pass.
    expect(app['users/add']?.input).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
    })
}, 30_000)

// --- the two derivations are one answer ----------------------------------------
//
// There are two of them and there have to be: one reads TOKENS and one reads a checker's `Type`, from
// different inputs, in different processes. What they must never differ about is the ANSWER — a shape
// whose spelling depends on whether a build step ran is a document nobody can diff.
//
// They did differ, and `assemble.ts` is what stopped it: every decision that turns parts into a
// schema is made once, and each derivation only supplies the parts. This is the test that keeps it
// true, and it is the reason the fixture beside it holds types BOTH passes can read.

const BOTH = new URL('../types/checker/server/rpc/both.ts', import.meta.url).pathname
const CHANNELS = new URL('../types/checker/server/sockets/channels.ts', import.meta.url).pathname

async function agrees(file: string, address: string): Promise<void> {
    const syntax = elide(await Bun.file(file).text(), { filename: file })
    const endpoints = syntax?.endpoints ?? []
    expect(endpoints.length).toBeGreaterThan(1)

    for (const endpoint of endpoints) {
        const tokens = (endpoint as { input?: unknown }).input
        const checked = CHECKED[`${address}/${endpoint.name}`]?.input
        // Both must KNOW it — a fixture either pass stopped reading is one that stopped comparing.
        expect(tokens, `the token pass derived nothing for ${endpoint.name}`).toBeDefined()
        expect(checked, `the checker derived nothing for ${endpoint.name}`).toBeDefined()
        expect(checked, `${endpoint.name} differs between the two derivations`).toEqual(tokens as never)
    }
}

test('the token pass and the checker pass agree on every type both can read', async () => {
    await agrees(BOTH, 'both')
})

// The socket case is separate because it is the one where the two halves read the message out of
// DIFFERENT positions: `socket<T, Args>` puts it first and `KeyedChannel<Args, T>` puts it second, so
// each derivation hard-codes an order the other cannot see. Reversing either one publishes the room
// shape as the message gate, which refuses publishes that were correct.
test('a socket message is the same shape from both derivations, either way round', async () => {
    await agrees(CHANNELS, 'channels')
})

test('every format the compiler publishes is one the validator accepts', () => {
    // The third copy this could have grown. `src/server/schema.ts` cannot import the compiler and the
    // compiler cannot import the server, so the two lists are asserted to agree rather than shared:
    // a format published but not accepted refuses the in-process caller who passed the real thing.
    const local: Record<string, unknown> = {
        'date-time': new Date(),
        uri: new URL('http://abide.test'),
        binary: new Blob(['x']),
    }
    for (const [name, schema] of Object.entries(NAMED_FORMATS)) {
        const format = schema.format as string
        expect(local[format], `${name} publishes ${format}, which this test does not cover`).toBeDefined()
        expect(validateJson(schema, local[format] as never), `${format} is published but refused`).toBeNull()
    }
})
