// 54.35-54.37 — A CALLER NAMED BY THE PROXY IN FRONT OF THE APP: a single sign-on gateway that has
// already authenticated whoever it forwards, and says who in a header. The header is believed only
// on a request whose PEER is one of the proxies — `request.ip`, the socket's address, never a header
// anyone can write — and the claims are presumed for that request alone, as `App.run`'s are, with no
// cookie sealed.
import { BlockList } from 'node:net' // bun has no subnet matcher of its own

import type { Middleware } from '#shared/Middleware.ts'

import { presumePrincipal } from './principal.ts'
import { request } from './requestScope.ts'

/**
 * A rung signing in the caller a trusted proxy names in `header`, as the claims `claims` makes of the
 * header's value; a request from anywhere else, or carrying no such header, passes as it came.
 */
export function trustedIdentity(options: {
    /** The header the proxy names the caller in: `'x-forwarded-user'`, say. */
    header: string
    /** The proxies' addresses, each an address or a subnet: `'10.0.0.0/8'`, `'::1'`. */
    proxies: readonly string[]
    /** The claims the caller is signed in as, made of the header's value. */
    claims: (value: string) => Record<string, unknown>
}): Middleware {
    const trusted = new BlockList()
    for (const proxy of options.proxies) {
        const [address = '', bits] = proxy.split('/')
        const family = address.includes(':') ? 'ipv6' : 'ipv4'
        if (bits === undefined) trusted.addAddress(address, family)
        else trusted.addSubnet(address, Number(bits), family)
    }
    return (next, { request: asked }) => {
        const value = asked.headers.get(options.header)
        // 54.36 — a header any caller can write is read only from a peer that is a proxy.
        const peer = request.ip()
        if (
            value !== null &&
            value !== '' &&
            peer !== null &&
            peer !== 'in-process' &&
            trusted.check(
                peer.address,
                peer.family === 'IPv6' ? 'ipv6' : 'ipv4',
            )
        )
            presumePrincipal(options.claims(value))
        return next()
    }
}
