import { networkInterfaces } from 'node:os' // bun exposes no network interface list of its own
import { useColor } from '#shared/log.ts'
import type { AppPackage } from './config.ts'
import { paint as painted } from './paint.ts'

/**
 * What `start` and `dev` print once the app is listening: the app, and every address it answers at.
 *
 * THE LOCAL ADDRESS IS THE FIRST URL PRINTED, because a harness reading the output takes the first
 * `http://` it finds (`addressOf` in the tests). The network rows follow it unconditionally: neither
 * `listen` nor `serveDev` names a hostname, and `Bun.serve` given none binds every interface —
 * whatever `url` says.
 */
export function banner(
    host: string,
    command: string,
    identity: AppPackage,
    server: Bun.Server<unknown>,
): string {
    const color = useColor()
    const paint = (code: string, text: string): string =>
        painted(color, code, text)
    const local = server.url.href
    const title = `${paint('1;36', host)} ${paint('1', command)}`
    const named =
        identity.name === undefined
            ? ''
            : `  ${paint('2', `${identity.name}${identity.version === undefined ? '' : ` ${identity.version}`}`)}`
    let text = `\n  ${title}${named}\n\n  ${paint('32', '➜')}  ${paint('1', 'Local:')}    ${paint('36', local)}\n`
    for (const address of networkAddresses())
        text += `  ${paint('32', '➜')}  ${paint('1', 'Network:')}  ${paint('36', `${server.url.protocol}//${address}:${server.port}/`)}\n`
    return text
}

/** This machine's external IPv4 addresses. */
function networkAddresses(): string[] {
    const addresses: string[] = []
    for (const entries of Object.values(networkInterfaces()))
        for (const entry of entries ?? [])
            if (entry.family === 'IPv4' && !entry.internal)
                addresses.push(entry.address)
    return addresses
}
