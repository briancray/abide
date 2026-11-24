// 58.2, 58.4, 58.9, 58.12, 58.13 — A LEDGER IN REDIS, AGAINST A REAL SERVER: four connections appending at
// once take every number from 1 with none left out and none taken twice, a key appended from two of
// them is kept once, the log reads back in order, and an append through one connection moves a
// ledger on another. A recording client cannot show any of this — what is claimed is what the server
// does with the script — so this runs where `ABIDE_REDIS_URL` names a server (one started with
// `--notify-keyspace-events KEA` for 58.12), and is skipped where none is named.

import { expect, test } from 'bun:test'

import { RedisClient } from 'bun'

import { store } from '#server'
import { ledger } from '#shared'

const URL = process.env.ABIDE_REDIS_URL

test.skipIf(URL === undefined)(
    'appends from four connections at once are numbered with no gap and no repeat, a key kept once — 58.2, 58.4, 58.9, 58.13',
    async () => {
        const name = `ledger-redis-${Date.now()}`
        const clients = [0, 1, 2, 3].map(() => new RedisClient(URL as string))
        const faces = clients.map((client) => store.redis(client, name))
        const APPENDS = 200
        const appended: Promise<number>[] = []
        for (let n = 0; n < APPENDS; n += 1)
            for (const [index, face] of faces.entries())
                // Every tenth item is appended by all four under one key: one entry, four answers.
                appended.push(
                    face.append(
                        { from: index, n },
                        n % 10 === 0 ? `shared-${n}` : `own-${index}-${n}`,
                        Date.now(),
                    ) as Promise<number>,
                )
        const numbers = await Promise.all(appended)
        const distinct = new Set(numbers)
        const expected = APPENDS * 4 - (APPENDS / 10) * 3
        const read: number[] = []
        for (let from = 0; ;) {
            const page = await faces[0]?.since(from)
            if (page === undefined || page.length === 0) break
            for (const entry of page) read.push(entry.seq)
            from = page[page.length - 1]?.seq ?? from
        }
        let gapless = true
        for (let index = 0; index < read.length; index += 1)
            if (read[index] !== index + 1) gapless = false
        expect(
            `kept: ${distinct.size}, read: ${read.length}, last: ${await faces[1]?.last()}, in order with no gap: ${gapless}`,
        ).toBe(
            `kept: ${expected}, read: ${expected}, last: ${expected}, in order with no gap: true`,
        )
        for (const client of clients) client.close()
    },
)

test.skipIf(URL === undefined)(
    'a ledger on one connection hears an append made through another — 58.12',
    async () => {
        const name = `ledger-redis-watch-${Date.now()}`
        const one = new RedisClient(URL as string)
        const two = new RedisClient(URL as string)
        const reading = ledger<string>({
            store: store.redis(one, name),
        })
        const writing = ledger<string>({
            store: store.redis(two, name),
        })
        await Bun.sleep(50)
        await writing.append('moved')
        const deadline = Date.now() + 2_000
        while ((reading.peek()?.length ?? 0) !== 1 && Date.now() < deadline)
            await Bun.sleep(10)
        expect(`kept: ${reading.peek()?.length}`).toBe('kept: 1')
        one.close()
        two.close()
    },
)

test.skipIf(URL === undefined)(
    'a trim lets a key go with its entry, on the server — 58.16, 58.10, 58.13',
    async () => {
        const name = `ledger-redis-trim-${Date.now()}`
        const client = new RedisClient(URL as string)
        const recent = ledger<string>({
            store: store.redis(client, name),
            retain: 1,
        })
        const first = await recent.append('save d2', { key: 'k1' })
        await recent.append('save d3')
        const again = await recent.append('save d2', { key: 'k1' })
        // While entry 3 is kept, a resend under its key is that entry.
        const resent = await recent.append('save d2', { key: 'k1' })
        expect(`first: ${first}, again: ${again}, resent: ${resent}`).toBe(
            'first: 1, again: 3, resent: 3',
        )
        client.close()
    },
)
