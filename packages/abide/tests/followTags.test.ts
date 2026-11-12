// 13.15 — A SWEEP BY TAG REACHES A FOLLOW BY THE TAGS ITS ARGS COMPUTE. A `GET` declaring `tags` as a
// function of its args carries none to the browser (18.4), so a server sweep matches each follow by
// what that function answers for the args the follow names — over the mux and over an event stream
// (18.20) alike, both of which follow through `Followers.follow`.

import { expect, test } from 'bun:test'

import { Followers, Frame, type Peer } from '#server/Followers.ts'
import type { FollowedHandler } from '#server/mountHandlers.ts'
import { inOpenScope, scopeFor } from '#server/requestScope.ts'
import { reactive, refresh } from '#shared/reactive/index.ts'
import { GET } from '#shared/rpc.ts'

// The function form on the `GET`'s own options, on a value handed to it, and the list form beside.
const stage = GET(({ home }: { home: string }) => ({ home }), {
    tags: ({ home }) => ['access', `home:${home}`],
})
const visits = GET(
    reactive(({ id }: { id: number }) => ({ id }), {
        tags: ({ id }) => ['access', `visit:${id}`],
    }),
)
const fixed = GET(() => ({ fixed: true }), { tags: ['access'] })

function rowOf(handler: unknown, address: string): FollowedHandler {
    ;(handler as { address: string }).address = address
    return {
        address,
        rungs: [],
        handler: handler as FollowedHandler['handler'],
    }
}

const PEER_OF = (sent: string[]): Peer => ({
    send(id: number, frame: Frame) {
        sent.push(`${frame.op} ${id}`)
    },
    close() {},
})

const sweep = (tags: string[]): void =>
    inOpenScope(
        scopeFor(new Request('http://app.test/write'), undefined, undefined),
        () => refresh({ tags }),
    )

// THE REVERT: give a follower `tags: typeof tags === 'function' ? undefined : tags` in
// `Followers.follow` — the function form left the server's alone, as it was; the sweep over `access`
// reaches 1 follow where 4 are due and no event stream, and the one over `home:b` reaches 0 where 1 is.
test('a sweep by tag reaches a follow by what its args compute — 13.15', async () => {
    const followers = new Followers()
    const sent: string[] = []
    const peer = PEER_OF(sent)
    const stops = [
        followers.follow(
            peer,
            1,
            rowOf(stage, '/stage'),
            { home: 'a' },
            undefined,
            true,
        ),
        followers.follow(
            peer,
            2,
            rowOf(stage, '/stage'),
            { home: 'b' },
            undefined,
            true,
        ),
        followers.follow(
            peer,
            3,
            rowOf(visits, '/visits'),
            { id: 7 },
            undefined,
            true,
        ),
        followers.follow(
            peer,
            4,
            rowOf(fixed, '/fixed'),
            undefined,
            undefined,
            true,
        ),
    ]
    // 18.20 — the event stream's follow, the lane a reader with no socket takes.
    const stream = followers
        .events(rowOf(stage, '/stage'), { home: 'c' }, undefined)
        .getReader()
    await stream.read()

    sweep(['access'])
    sweep(['home:b'])
    sweep(['nobody'])

    // Enqueued as the sweep ran, so read in a turn — or nothing was.
    const event = await Promise.race([
        stream.read(),
        Bun.sleep(0).then(() => ({ value: undefined })),
    ])
    expect(new TextDecoder().decode(event.value)).toStartWith('event: refresh')
    expect(sent).toEqual([
        'refresh 1',
        'refresh 2',
        'refresh 3',
        'refresh 4',
        'refresh 2',
    ])
    for (const stop of stops) stop()
    await stream.cancel()
})
