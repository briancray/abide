// 18.2 — A SOCKET, AS A BROWSER HOLDS IT. What a page imported as `chat` is, in the bundle,
// `socketWire('/__abide/socket/chat')`: a call per args handing back a subscriber's copy, fed over the
// one web socket every socket on the page shares.
//
// THE COPY IS BUSY UNTIL ITS FIRST PRODUCTION ARRIVES (9.29), and each production after it lands
// through the copy's own `publish`, numbered by the owner rather than by the copy (9.14): the owner's
// sequence number and epoch are held beside it for a reconnect to resume from (18.13). A publish the
// page makes is sent to the owner rather than applied here — it arrives back as a production like any
// other, once the owner has taken it (18.6).
//
// NOT HERE YET: 18.15's reset of a `{#for}` over the copy, which is the compiler's; a reset here
// publishes the owner's ring into the copy.

import { canonicalKey } from '#shared/reactive/canonicalKey.ts'
import { type Reactive, reactive } from '#shared/reactive/index.ts'
import { failed, isFailedNamed } from '#shared/Failed.ts'
import { SOCKET_ADDRESS } from '#shared/SOCKET_ADDRESS.ts'
import { HYDRATE_LOG } from './Mismatch.ts'

// How many productions a subscriber's copy retains for a cursor to replay.
const COPY_HISTORY = 100
const RETRY_CEILING_MS = 10_000

type Subscription = {
    id: number
    address: string
    args: unknown
    copy: Reactive<unknown>
    publish: (value: unknown) => unknown
    first: ((value: unknown) => void) | null
    refuse: ((error: unknown) => void) | null
    seq: number | undefined
    epoch: string | undefined
}

type Frame = {
    op: 'prod' | 'reset' | 'error'
    id: number
    seq?: number
    epoch?: string
    value?: unknown
    ring?: [number, unknown][]
    error?: { name: string; status: number; message: string; data: unknown }
}

class Mux {
    url: string
    socket: WebSocket | null
    subscriptions: Map<number, Subscription>
    pending: string[]
    nextId: number
    retry: number

    constructor(url: string) {
        this.url = url
        this.socket = null
        this.subscriptions = new Map()
        this.pending = []
        this.nextId = 1
        this.retry = 250
    }

    send(frame: unknown): void {
        const text = JSON.stringify(frame)
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(text)
        else {
            this.pending.push(text)
            this.connect()
        }
    }

    // A subscription is never queued: `onopen` sends every one standing, so one registered before
    // the socket opens goes out with them.
    subscribe(subscription: Subscription): void {
        this.subscriptions.set(subscription.id, subscription)
        if (this.socket?.readyState === WebSocket.OPEN)
            this.socket.send(JSON.stringify(subscribeFrame(subscription)))
        else this.connect()
    }

    connect(): void {
        if (this.socket !== null) return
        const socket = new WebSocket(this.url)
        this.socket = socket
        socket.onopen = () => {
            this.retry = 250
            // 18.13 — every subscription again, carrying where it stood.
            for (const each of this.subscriptions.values())
                socket.send(JSON.stringify(subscribeFrame(each)))
            const queued = this.pending
            this.pending = []
            for (const text of queued) socket.send(text)
        }
        socket.onmessage = (event) =>
            this.receive(JSON.parse(String(event.data)) as Frame)
        socket.onclose = () => {
            this.socket = null
            if (this.subscriptions.size === 0) return
            setTimeout(() => this.connect(), this.retry)
            this.retry = Math.min(this.retry * 2, RETRY_CEILING_MS)
        }
    }

    receive(frame: Frame): void {
        const subscription = this.subscriptions.get(frame.id)
        if (subscription === undefined) return
        if (frame.op === 'error') {
            const error = frame.error
            const refusal =
                error === undefined
                    ? undefined
                    : failed(
                          error.name,
                          error.status,
                          error.message,
                          error.data,
                      )
            if (subscription.refuse !== null) {
                subscription.refuse(refusal)
                subscription.first = null
                subscription.refuse = null
            } else HYDRATE_LOG.warning('a socket refused', refusal)
            return
        }
        subscription.epoch = frame.epoch
        if (frame.op === 'reset') {
            for (const [seq, value] of frame.ring ?? []) {
                subscription.seq = seq
                deliver(subscription, value)
            }
            return
        }
        subscription.seq = frame.seq
        deliver(subscription, frame.value)
    }
}

function subscribeFrame(subscription: Subscription): unknown {
    return {
        op: 'sub',
        id: subscription.id,
        address: subscription.address,
        args: subscription.args,
        seq: subscription.seq,
        epoch: subscription.epoch,
    }
}

function deliver(subscription: Subscription, value: unknown): void {
    if (subscription.first !== null) {
        subscription.first(value)
        subscription.first = null
        subscription.refuse = null
        return
    }
    subscription.publish.call(subscription.copy, value)
}

const MUXES = new Map<string, Mux>()

// The mux a socket's address is carried over: the address up to and including `SOCKET_ADDRESS`,
// so an app under a sub-path opens its own.
function muxFor(address: string): Mux {
    const at = address.indexOf(SOCKET_ADDRESS)
    const path = address.slice(0, at + SOCKET_ADDRESS.length)
    const url = new URL(path, location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    let mux = MUXES.get(url.href)
    if (mux === undefined) {
        mux = new Mux(url.href)
        MUXES.set(url.href, mux)
    }
    return mux
}

export function socketWire(address: string): unknown {
    const copies = new Map<string, Reactive<unknown>>()
    const call = (args?: unknown): Reactive<unknown> => {
        const key = canonicalKey(args)
        const standing = copies.get(key)
        if (standing !== undefined) return standing
        const mux = muxFor(address)
        let first: ((value: unknown) => void) | null = null
        let refuse: ((error: unknown) => void) | null = null
        const landed = new Promise<unknown>((resolve, reject) => {
            first = resolve
            refuse = reject
        })
        const copy = reactive<unknown>(landed, {
            history: COPY_HISTORY,
        }) as Reactive<unknown>
        const subscription: Subscription = {
            id: mux.nextId++,
            address,
            args,
            copy,
            publish: copy.publish,
            first,
            refuse,
            seq: undefined,
            epoch: undefined,
        }
        // 18.6 — A PUBLISH FROM HERE GOES TO THE OWNER, which admits it or refuses it; what it admits
        // comes back as a production.
        ;(
            copy as unknown as { publish: (message: unknown) => number }
        ).publish = (message) => {
            mux.send({ op: 'pub', id: subscription.id, address, args, message })
            return subscription.seq ?? 0
        }
        copies.set(key, copy)
        mux.subscribe(subscription)
        return copy
    }
    return Object.assign(call, { address, isError: isFailedNamed })
}
