// The log feed's own contract: the ring, the opt-in, and the two hazards that make it worth a test —
// re-entrancy (a listener that logs) and the zero-cost-when-off guarantee.

import { afterEach, expect, test } from 'bun:test'
import { log } from '../log.ts'
import { logFeed } from './logFeed.ts'

afterEach(() => {
    logFeed.disable()
    delete Bun.env.DEBUG
})

function publish(message: string, channel = 'app', level = 'log'): void {
    logFeed.publish(level, channel, message, undefined, new Date())
}

test('disabled by default: publish buffers nothing and notifies nobody', () => {
    expect(logFeed.enabled).toBe(false)
    let seen = 0
    logFeed.subscribe(() => {
        seen++
    })
    publish('dropped')
    expect(seen).toBe(0)
    expect(logFeed.backlog(10)).toEqual([])
})

test('enabled: records buffer for a subscriber that arrives LATER', () => {
    logFeed.enable(10)
    publish('before you connected')
    const backlog = logFeed.backlog(10)
    expect(backlog).toHaveLength(1)
    expect(backlog[0]?.message).toBe('before you connected')
})

test('the ring evicts oldest-first and backlog returns oldest-to-newest', () => {
    logFeed.enable(3)
    for (const message of ['a', 'b', 'c', 'd', 'e']) publish(message)
    expect(logFeed.backlog(10).map((record) => record.message)).toEqual(['c', 'd', 'e'])
    // A smaller request takes the NEWEST n, not the oldest.
    expect(logFeed.backlog(2).map((record) => record.message)).toEqual(['d', 'e'])
    expect(logFeed.backlog(0)).toEqual([])
})

test('sequence numbers keep counting through eviction, so a gap is detectable', () => {
    logFeed.enable(2)
    publish('a')
    publish('b')
    publish('c')
    const seqs = logFeed.backlog(10).map((record) => record.seq)
    expect(seqs).toHaveLength(2)
    expect(seqs[1]).toBe((seqs[0] as number) + 1)
})

test('a listener that logs does not recurse', () => {
    logFeed.enable(50)
    let delivered = 0
    logFeed.subscribe((record) => {
        delivered++
        // The hazard: the transport itself logging while delivering. Must not feed back.
        if (record.message !== 'from the listener') publish('from the listener')
    })
    publish('original')
    expect(delivered).toBe(1)
    // The nested line is dropped entirely rather than buffered un-fanned.
    expect(logFeed.backlog(10).map((record) => record.message)).toEqual(['original'])
})

test('a throwing listener does not break the emit path or its peers', () => {
    logFeed.enable(50)
    let reached = 0
    logFeed.subscribe(() => {
        throw new Error('broken subscriber')
    })
    logFeed.subscribe(() => {
        reached++
    })
    expect(() => publish('still fine')).not.toThrow()
    expect(reached).toBe(1)
    expect(logFeed.backlog(10)).toHaveLength(1)
})

test('unsubscribe stops delivery', () => {
    logFeed.enable(50)
    let seen = 0
    const unsubscribe = logFeed.subscribe(() => {
        seen++
    })
    publish('one')
    unsubscribe()
    publish('two')
    expect(seen).toBe(1)
    expect(logFeed.subscriberCount()).toBe(0)
})

test('log() feeds the ring, and a DEBUG-GATED channel still reaches it', () => {
    logFeed.enable(50)
    // No DEBUG set, so `abide:rpc` is suppressed on stdout — but the feed is fanned out BEFORE that
    // gate, which is what lets `logs --debug abide:rpc` light a channel on a live deployment.
    expect(Bun.env.DEBUG).toBeUndefined()
    log.channel('abide:rpc').info('gated line')
    const messages = logFeed.backlog(10).map((record) => record.message)
    expect(messages).toContain('gated line')
})

test('log() records carry the channel and level the reader filters on', () => {
    logFeed.enable(50)
    log.channel('abide:rpc').warn('a warning')
    const record = logFeed.backlog(10).at(-1)
    expect(record?.channel).toBe('abide:rpc')
    expect(record?.level).toBe('warn')
})
