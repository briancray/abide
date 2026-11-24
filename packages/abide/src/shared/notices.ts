// 50.12 — A LIST OF NOTICES, oldest first, shown where the app spreads its `host`. `toasts` is one built
// with no options; an app builds another for a banner of announcements, seeded with `initial`, its
// dismissals remembered in a `store` for `ttl` (50.68-50.73).
//
// The list is one per request on a server, as every `reactive` without `global` is (11.32), and
// `notify` never writes it there (50.16): one visitor's notice cannot reach another's page by either.

import { hashText } from './hashText.ts'
import { isServer } from './isServer.ts'
import { type Live, live } from './live.ts'
import { type Reactive, reactive, type Store } from './reactive/index.ts'
import { standing } from './standing.ts'

/** One notice in a `notices` list: what it says, its tone, and the action it offers, where it offers one. */
export type Notice = {
    /** What `notify` handed back for it, and what `dismiss` takes. */
    id: number
    /** What a dismissal is remembered by: a hash of what the list's `key` answers for it (50.71). */
    key: string
    /** What it says, written in the `text` part. */
    text: string
    /** Written as `data-tone` on the notice. */
    tone: 'info' | 'success' | 'error'
    /** The button it offers, written in the `action` part, where it offers one. */
    action: { label: string; run: () => unknown } | undefined
    /** Written onto the notice's element, `{}` where it was given none (50.41). */
    attributes: Record<string, string>
    /** The moment it stops showing, in epoch milliseconds; `Infinity` where it was given none. */
    expires: number
}

/** Why a notice left its list, as its `onclose` is told. */
export type CloseReason = 'timeout' | 'dismissed' | 'action'

/** How a notice reads, how long it stays, and what it offers. */
export type NotifyOptions = {
    /** `'info'`, `'success'` or `'error'`, written as `data-tone` on the notice. Default `'info'`. */
    tone?: Notice['tone']
    /** Milliseconds before it takes itself down; `Infinity` keeps it until it is dismissed. Default the list's `timeout`. */
    timeout?: number
    /** The moment it stops showing, wherever it is rendered — a server's render included (50.72). */
    expires?: Date | number
    /** A button on the notice that takes the notice down and calls `run`: an undo, a retry, or `report({ trace }).open()` for a failed call. */
    action?: { label: string; run: () => unknown }
    /** Written onto the notice's element: a `data-` attribute an analytics tag reads, say (50.41). */
    attributes?: Record<string, string>
    /** Called once as the notice leaves, told whether its timeout, a dismissal or its action took it (50.42). */
    onclose?: (reason: CloseReason) => void
}

/** What a `notices` list starts with, where it remembers its dismissals, and how long its notices stay. */
export type NoticesOptions = {
    /** The notices it starts with, on a server's render too, less those its `store` remembers (50.70). */
    initial?: readonly (string | ({ text: string } & NotifyOptions))[]
    /** A notice's `timeout` where it names none. Default `3000`, and `10000` for an error (50.14). */
    timeout?: number
    /** Where a dismissal is remembered, by key, as the moment it is forgotten (50.69). */
    store?: Store<Record<string, number>>
    /** How long a dismissal is remembered, in milliseconds. Default `Infinity`. */
    ttl?: number
    /** What makes two notices the same one, kept hashed. Default the notice as JSON (50.71). */
    key?: (notice: Omit<Notice, 'id' | 'key'>) => string
}

/** What the region is called. */
export type NoticesHostOptions = {
    /** The region's accessible name. `'Notices'` by default; read live where a function is given. */
    label?: Live<string>
}

/** One notice's parts: its element, its text, its action and close buttons, and what runs its action or closes it. */
export type NoticeParts = {
    /** The notice's element: the attributes it was handed, and its tone as `data-tone`. */
    readonly notice: Record<string, unknown>
    /** The element holding the notice's text. */
    readonly text: Record<string, unknown>
    /** The notice's action button, which closes the notice and runs the action. */
    readonly action: Record<string, unknown>
    /** The notice's close button. */
    readonly close: Record<string, unknown>
    /** Closes the notice and runs its action, for markup that calls it rather than spreading `action`. */
    act(): void
    /** Closes the notice, for markup that calls it rather than spreading `close`. */
    dismiss(): void
}

/** The parts a list's `host` hands back: `<div {...shown.region}>`, a notice per `shown.notices`. */
export type NoticesHost = {
    /** The live region: its role, its politeness and its name. */
    readonly region: Record<string, unknown>
    /** The notices to render, oldest first: none where another host of the list shows them. */
    get notices(): readonly Notice[]
    /** One notice's parts. */
    notice(notice: Notice): NoticeParts
}

/** A list of notices: what adds one and takes one down, the list itself, and where it shows. */
export type Notices = {
    /** Shows a notice where the list's `host` is spread, handing back its id for `dismiss`. */
    notify(text: string, options?: NotifyOptions): number
    /** Takes a notice down before its timeout; a notice already gone leaves the list as it is (50.15). */
    dismiss(id: number): void
    /** The notices added and not yet closed, oldest first. */
    readonly list: Reactive<Notice[]>
    /** The live region the list shows in, as parts to spread, from the script of the one component that shows it. */
    host(options?: NoticesHostOptions): NoticesHost
}

const TIMEOUT_MS = 3000
// An error's notice stays long enough to reach its action.
const ERROR_TIMEOUT_MS = 10_000
// The longest delay `setTimeout` keeps; a later one fires at once. A notice due past it is left to
// the `expires` filter of the next render.
const LONGEST_TIMER_MS = 2 ** 31 - 1

// A counter rather than `crypto.randomUUID`, which a page served over plain http does not have; one
// for every list, so `dismiss` on the wrong list finds nothing (50.15).
let lastId = 0

// 50.71 — the notice as JSON, without the `id` a page load mints afresh: its action's label, and not
// its `run`, which JSON leaves out.
const asJson = (notice: Omit<Notice, 'id' | 'key'>): string =>
    JSON.stringify(notice)

/** A list of notices, shown where the app spreads its `host` (50.12). */
export function notices(options: NoticesOptions = {}): Notices {
    // 50.36 — this list's hosts standing: the last shows its notices.
    const hosts = standing('a notices host()', 'abide:notices')
    // 50.42 — each notice's `onclose`, by its id, until the notice leaves. Off the `Notice`, which is
    // what `host` shows and an app reads, and a callback is neither.
    const closers = new Map<number, (reason: CloseReason) => void>()
    // 50.69 — key → the moment its dismissal is forgotten. Built with a `store` alone, so `toasts`
    // reads and writes nothing.
    const remembered =
        options.store === undefined
            ? undefined
            : reactive<Record<string, number>>({}, { store: options.store })
    const rememberTtl = options.ttl ?? Infinity
    const keyOf = options.key ?? asJson

    const build = (
        text: string,
        given: NotifyOptions,
        started: number,
    ): Notice => {
        lastId += 1
        const id = lastId
        if (given.onclose !== undefined) closers.set(id, given.onclose)
        const tone = given.tone ?? 'info'
        const expires = given.expires === undefined ? Infinity : +given.expires
        // 50.13, 50.72 — whichever of its timeout and its expiry comes first takes it down, in a
        // browser alone: a server renders once, and drops what has expired by the filter in `host`.
        if (!isServer()) {
            const timeout =
                given.timeout ??
                options.timeout ??
                (tone === 'error' ? ERROR_TIMEOUT_MS : TIMEOUT_MS)
            const due = Math.min(timeout, expires - started)
            if (due <= LONGEST_TIMER_MS)
                setTimeout(() => close(id, 'timeout'), Math.max(due, 0))
        }
        const content = {
            text,
            tone,
            action: given.action,
            attributes: given.attributes ?? {},
            expires,
        }
        // Hashed whatever `key` answers, so the store holds a short key however long the words.
        return { id, key: hashText(keyOf(content)), ...content }
    }

    const seeded: Notice[] = []
    const now = Date.now()
    for (const entry of options.initial ?? [])
        seeded.push(
            typeof entry === 'string'
                ? build(entry, {}, now)
                : build(entry.text, entry, now),
        )
    const list = reactive<Notice[]>(seeded, { by: 'id' })

    // 50.15, 50.42, 50.69 — takes the notice holding `id` out of the list, remembers a dismissal or
    // an action in the store, and tells its `onclose` why.
    const close = (id: number, reason: CloseReason): void => {
        const held = list.peek() ?? []
        const at = held.findIndex((notice) => notice.id === id)
        if (at === -1) return
        const { key } = held[at] as Notice
        list.patch((notices) => {
            notices.splice(at, 1)
        })
        if (remembered !== undefined && reason !== 'timeout') {
            const closedAt = Date.now()
            // 50.73 — what has been forgotten leaves with this write, so the store holds only what
            // is still remembered.
            const kept: Record<string, number> = {}
            for (const [held, forgotten] of Object.entries(
                remembered.peek() ?? {},
            ))
                if (forgotten > closedAt) kept[held] = forgotten
            // JSON has no `Infinity` (8.28), so forever is the furthest moment a number holds exactly.
            kept[key] = Math.min(
                closedAt + rememberTtl,
                Number.MAX_SAFE_INTEGER,
            )
            remembered.set(kept)
        }
        const onclose = closers.get(id)
        if (onclose === undefined) return
        closers.delete(id)
        onclose(reason)
    }

    const dismiss = (id: number): void => close(id, 'dismissed')

    return {
        notify(text, given = {}) {
            if (isServer())
                throw new Error(
                    'notify shows a notice to a person, and a server has none to show it to. RULEBOOK 50.16.',
                )
            hosts.asked()
            const notice = build(text, given, Date.now())
            list.patch((notices) => {
                notices.push(notice)
            })
            return notice.id
        },
        dismiss,
        list,
        host(hostOptions = {}) {
            // 50.36 — this host, among the list's standing; the last renders the notices.
            const shows = hosts.stand()
            const act = (notice: Notice): void => {
                close(notice.id, 'action')
                notice.action?.run()
            }
            return {
                region: {
                    role: 'status',
                    'data-notices': 'region',
                    'aria-live': 'polite',
                    get 'aria-label'() {
                        return live(hostOptions.label) ?? 'Notices'
                    },
                },
                get notices() {
                    if (!shows()) return []
                    const all = list()
                    const forgets = remembered?.() ?? {}
                    const at = Date.now()
                    // 50.70, 50.72 — the common list, nothing remembered and nothing expiring, is
                    // the list itself.
                    let showing: Notice[] | undefined
                    for (let index = 0; index < all.length; index += 1) {
                        const notice = all[index] as Notice
                        const hidden =
                            notice.expires <= at ||
                            (forgets[notice.key] ?? 0) > at
                        if (hidden && showing === undefined)
                            showing = all.slice(0, index)
                        else if (!hidden && showing !== undefined)
                            showing.push(notice)
                    }
                    return showing ?? all
                },
                notice: (notice) => ({
                    notice: {
                        ...notice.attributes,
                        'data-notices': 'notice',
                        'data-tone': notice.tone,
                    },
                    text: { 'data-notices': 'text' },
                    action: {
                        type: 'button',
                        'data-notices': 'action',
                        onclick: () => act(notice),
                    },
                    close: {
                        type: 'button',
                        'data-notices': 'close',
                        'aria-label': 'Dismiss',
                        onclick: () => dismiss(notice.id),
                    },
                    act: () => act(notice),
                    dismiss: () => dismiss(notice.id),
                }),
            }
        },
    }
}
