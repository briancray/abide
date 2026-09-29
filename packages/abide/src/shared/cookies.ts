// SECTION 22 — `cookies`, on both sides: the request's cookies on a server, the document's in a
// browser, each a jar shaped as bun's `CookieMap`. A read by name tracks THAT name (22.4) and a write
// wakes that name's readers alone (22.5): a version per name, bumped on a write, is what a read
// subscribes to — the values themselves are a plain map.
//
// WHERE THE JAR COMES FROM IS A SLOT the server fills (`#server/requestScope.ts`), for `TRACE`'s
// reason: this seam cannot name the request scope, and a browser bundle must not reach it.

import { decodedOrKept } from './decodedOrKept.ts'
import { type Reactive, reactive } from './reactive/index.ts'

type CookieInit = Bun.CookieInit
type CookieStoreDeleteOptions = Bun.CookieStoreDeleteOptions

/**
 * A cookie jar shaped as bun's `CookieMap`, whose reads track the name they read (22.4, 22.5).
 */
export class Cookies implements Iterable<[string, string]> {
    held: Map<string, string>
    versions: Map<string, Reactive<number>>
    /** Any change at all, for a reader of the whole jar — `size`, the iterators, `toJSON`. */
    every: Reactive<number>
    /** Where a write goes: onto the response on a server, into `document.cookie` in a browser. */
    sink: (serialized: string) => void
    writes: string[]
    inBrowser: boolean

    constructor(
        header: string,
        sink: (serialized: string) => void,
        inBrowser: boolean,
    ) {
        this.held = parseCookies(header)
        this.versions = new Map()
        this.every = reactive(0)
        this.sink = sink
        this.writes = []
        this.inBrowser = inBrowser
    }

    /** The named cookie's value, or `null` — a read that tracks that name (22.4). */
    get(name: string): string | null {
        this.versionOf(name)()
        return this.held.get(name) ?? null
    }

    has(name: string): boolean {
        this.versionOf(name)()
        return this.held.has(name)
    }

    set(name: string, value: string, options?: CookieInit): void
    set(options: CookieInit): void
    set(
        first: string | CookieInit,
        value?: string,
        options?: CookieInit,
    ): void {
        const init: CookieInit =
            typeof first === 'string'
                ? { ...options, name: first, value: value ?? '' }
                : first
        const name = init.name ?? ''
        if (name === '')
            throw new Error('abide: cookies().set was given no name.')
        const expired =
            init.maxAge !== undefined && init.maxAge <= 0
                ? true
                : init.expires !== undefined &&
                  new Date(init.expires).getTime() <= Date.now()
        if (expired) this.held.delete(name)
        else this.held.set(name, init.value ?? '')
        this.write(name, init)
    }

    delete(name: string): void
    delete(options: CookieStoreDeleteOptions): void
    delete(name: string, options: Omit<CookieStoreDeleteOptions, 'name'>): void
    delete(
        first: string | CookieStoreDeleteOptions,
        options?: Omit<CookieStoreDeleteOptions, 'name'>,
    ): void {
        const given =
            typeof first === 'string' ? { ...options, name: first } : first
        this.held.delete(given.name)
        const expired: CookieInit = { name: given.name, value: '', expires: 0 }
        if (given.path !== undefined) expired.path = given.path
        if (given.domain !== undefined && given.domain !== null)
            expired.domain = given.domain
        this.write(given.name, expired)
    }

    get size(): number {
        this.every()
        return this.held.size
    }

    toJSON(): Record<string, string> {
        this.every()
        return Object.fromEntries(this.held)
    }

    /**
     * The `set-cookie` lines this jar has written, in order — a server's alone.
     *
     * A browser's jar lives as long as the page and its writes went into the document, so it keeps
     * none: held, they grew one line per write with nothing to read them.
     */
    toSetCookieHeaders(): string[] {
        return [...this.writes]
    }

    entries(): IterableIterator<[string, string]> {
        this.every()
        return this.held.entries()
    }

    keys(): IterableIterator<string> {
        this.every()
        return this.held.keys()
    }

    values(): IterableIterator<string> {
        this.every()
        return this.held.values()
    }

    forEach(
        callback: (value: string, key: string, map: Cookies) => void,
    ): void {
        this.every()
        for (const [key, value] of this.held) callback(value, key, this)
    }

    [Symbol.iterator](): IterableIterator<[string, string]> {
        return this.entries()
    }

    versionOf(name: string): Reactive<number> {
        let version = this.versions.get(name)
        if (version === undefined) {
            version = reactive(0)
            this.versions.set(name, version)
        }
        return version
    }

    /** Wakes that name's readers, and the whole jar's (22.5). */
    changed(name: string): void {
        const version = this.versions.get(name)
        if (version !== undefined) version.set((version.peek() ?? 0) + 1)
        this.every.set((this.every.peek() ?? 0) + 1)
    }

    write(name: string, init: CookieInit): void {
        const serialized = serializeCookie(init, this.inBrowser)
        if (!this.inBrowser) this.writes.push(serialized)
        this.sink(serialized)
        this.changed(name)
    }
}

/**
 * Whether a cookie is `Secure` when its options do not say.
 *
 * 22.3 — `secure` DEFAULTS FROM `NODE_ENV` on a server; a browser has no environment, and the page's
 * own protocol is the same question asked of the one thing it does have.
 */
function secureByDefault(inBrowser: boolean): boolean {
    if (inBrowser) return location.protocol === 'https:'
    return (
        typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
    )
}

/** One `set-cookie` line for a write, with 22.3's defaults filled in. */
export function serializeCookie(init: CookieInit, inBrowser: boolean): string {
    let line = `${init.name}=${encodeURIComponent(init.value ?? '')}`
    line += `; Path=${init.path ?? '/'}`
    if (init.domain !== undefined) line += `; Domain=${init.domain}`
    if (init.expires !== undefined)
        line += `; Expires=${new Date(init.expires).toUTCString()}`
    if (init.maxAge !== undefined) line += `; Max-Age=${init.maxAge}`
    if (init.secure ?? secureByDefault(inBrowser)) line += '; Secure'
    // A page's own script cannot set an `HttpOnly` cookie, and a browser drops the whole line that
    // asks to — so the attribute is a server's alone.
    if (init.httpOnly === true && !inBrowser) line += '; HttpOnly'
    line += `; SameSite=${capitalised(init.sameSite ?? 'lax')}`
    if (init.partitioned === true) line += '; Partitioned'
    return line
}

function capitalised(sameSite: string): string {
    return sameSite.charAt(0).toUpperCase() + sameSite.slice(1)
}

/**
 * A `Cookie` header, or `document.cookie`, as a map of decoded values.
 *
 * THE JAR HOLDS VALUES DECODED, whichever path fills it: `serializeCookie` encodes, and the header,
 * `document.cookie` and a `cookieStore` change all carry the encoded text.
 */
function parseCookies(header: string): Map<string, string> {
    const parsed = new Map<string, string>()
    for (const pair of header.split(';')) {
        const at = pair.indexOf('=')
        if (at === -1) continue
        const name = pair.slice(0, at).trim()
        if (name === '') continue
        parsed.set(name, decodedOrKept(pair.slice(at + 1).trim()))
    }
    return parsed
}

/**
 * The slot `cookies()` reads its jar through: the document's by default, the request's once the
 * server fills it (`#server/requestScope.ts`).
 */
export const COOKIES: { current: () => Cookies } = {
    current: browserCookies,
}

let documentJar: Cookies | undefined

/**
 * The document's jar, one per page, built on first ask.
 *
 * 22.6 — where the browser reports a change made outside this jar
 * (another tab, a server's `set-cookie`), that name's readers wake; 22.7 — where it does not, nothing
 * does, and the jar is what it last read.
 */
function browserCookies(): Cookies {
    if (documentJar !== undefined) return documentJar
    if (typeof document === 'undefined')
        throw new Error(
            'abide: cookies() was called outside a request, and on a server it reads the request being served. RULEBOOK 22.8.',
        )
    const jar = new Cookies(
        document.cookie,
        (serialized) => {
            // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is asynchronous and missing from some browsers, and a read of the jar is synchronous.
            document.cookie = serialized
        },
        true,
    )
    documentJar = jar
    const store = (globalThis as { cookieStore?: EventTarget }).cookieStore
    store?.addEventListener('change', (event) => {
        const { changed = [], deleted = [] } = event as unknown as {
            changed?: { name: string; value?: string }[]
            deleted?: { name: string }[]
        }
        for (const cookie of changed) {
            const value = decodedOrKept(cookie.value ?? '')
            if (jar.held.get(cookie.name) === value) continue
            jar.held.set(cookie.name, value)
            jar.changed(cookie.name)
        }
        for (const cookie of deleted) {
            if (!jar.held.has(cookie.name)) continue
            jar.held.delete(cookie.name)
            jar.changed(cookie.name)
        }
    })
    return jar
}

/** The cookies of the request being served, or of the document (22.2). */
export function cookies(): Cookies {
    return COOKIES.current()
}
