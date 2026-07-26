// IDENTITY SEALING — auth.md AU5/AU9. A sealed identity is an AES-GCM-encrypted, opaque blob
// carrying { p: principal, exp } — the SAME seal for the auto-managed `abide-identity` cookie
// and for per-user bearer tokens (they differ only by transport). Output is base64url(iv +
// ciphertext); the GCM auth tag makes tampering unrecoverable (unseal returns undefined), and a
// mandatory `exp` makes expired blobs unrecoverable too.
//
// Key management: with ABIDE_IDENTITY_SECRET set, the AES key is SHA-256(secret) — stable across
// restarts / instances, and rotating the secret invalidates every token and cookie at once
// (AU9.6 "nuclear"). Without it, a process-ephemeral key is generated once (dev/anonymous only,
// not restart- or multi-instance-stable) and a one-time warning is logged to the `abide:identity`
// channel (off unless `DEBUG=abide:identity`).

import { log } from '../../shared/log.ts'
import type { Principal } from './scope.ts'

const TTL_DEFAULT_MS = 30 * 24 * 60 * 60 * 1000 // 30 days (AU5.4 / AU9.3)
const MAX_SEALED_BYTES = 4096 // ~4KB cookie ceiling (AU3.5 / AU5.2)
const IV_BYTES = 12 // AES-GCM standard nonce length

export interface SealedPayload {
    p: Principal
    exp: number
}

// Derived keys are memoized per secret value so switching ABIDE_IDENTITY_SECRET (e.g. rotation,
// or between tests) picks up the new key rather than a stale one.
const derivedKeys = new Map<string, Promise<CryptoKey>>()
let ephemeralKey: Promise<CryptoKey> | undefined
let ephemeralWarned = false

// TTL in milliseconds from ABIDE_IDENTITY_TTL, default 30 days. Shared by seal (exp) and the
// cookie/token Max-Age (auth.ts).
export function ttlMs(): number {
    const raw = Bun.env.ABIDE_IDENTITY_TTL
    if (raw !== undefined && raw.length > 0) {
        const parsed = Number(raw)
        if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
    return TTL_DEFAULT_MS
}

async function deriveKeyFromSecret(secret: string): Promise<CryptoKey> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
    ])
}

function currentKey(): Promise<CryptoKey> {
    const secret = Bun.env.ABIDE_IDENTITY_SECRET
    if (secret !== undefined && secret.length > 0) {
        let key = derivedKeys.get(secret)
        if (key === undefined) {
            key = deriveKeyFromSecret(secret)
            derivedKeys.set(secret, key)
        }
        return key
    }
    if (ephemeralKey === undefined) {
        if (!ephemeralWarned) {
            log.channel('abide:identity').warn(
                'ABIDE_IDENTITY_SECRET is not set — using a process-ephemeral identity key. Sealed identities will not survive a restart and are not stable across instances. Set ABIDE_IDENTITY_SECRET for secure authenticated identity in production.',
            )
            ephemeralWarned = true
        }
        ephemeralKey = crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
            'encrypt',
            'decrypt',
        ])
    }
    return ephemeralKey
}

export async function seal(principal: Principal): Promise<string> {
    const payload: SealedPayload = { p: principal, exp: Date.now() + ttlMs() }
    const plaintext = new TextEncoder().encode(JSON.stringify(payload))
    const key = await currentKey()
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
    )

    const combined = new Uint8Array(iv.length + ciphertext.length)
    combined.set(iv, 0)
    combined.set(ciphertext, iv.length)
    const token = combined.toBase64({ alphabet: 'base64url', omitPadding: true })

    if (token.length > MAX_SEALED_BYTES) {
        throw new Error(
            `abide: sealed identity is ${token.length} bytes, exceeding the ~${MAX_SEALED_BYTES}-byte ceiling. The identity payload is too large to seal into a cookie or token.`,
        )
    }
    return token
}

export async function unseal(token: string): Promise<Principal | undefined> {
    return (await unsealPayload(token))?.p
}

// `unseal` plus the payload's `exp`. The router needs the expiry to decide whether the rolling cookie
// is due for a rewrite — re-sealing on every response costs an AES-GCM encrypt per reply for a value
// that only has to change occasionally.
export async function unsealPayload(token: string): Promise<SealedPayload | undefined> {
    try {
        const combined = Uint8Array.fromBase64(token, { alphabet: 'base64url' })
        if (combined.length <= IV_BYTES) return undefined
        const iv = combined.subarray(0, IV_BYTES)
        const ciphertext = combined.subarray(IV_BYTES)
        const key = await currentKey()
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
        const payload = JSON.parse(new TextDecoder().decode(plaintext)) as SealedPayload
        if (payload === null || typeof payload !== 'object') return undefined
        if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
            log.channel('abide:identity').trace('unseal rejected — token expired')
            return undefined
        }
        if (payload.p === null || typeof payload.p !== 'object') return undefined
        return payload
    } catch {
        // Tampered ciphertext (GCM tag mismatch), malformed base64, or non-JSON plaintext all land
        // here — a sealed blob we cannot trust resolves to "no identity". Log the outcome only, never
        // the token or its plaintext.
        log.channel('abide:identity').trace('unseal rejected — tampered or malformed token')
        return undefined
    }
}
