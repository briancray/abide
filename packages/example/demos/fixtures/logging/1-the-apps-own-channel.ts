import { log } from 'abide'

/** The app talking to whoever started it. Always written — an app whose own output needs an env var set
 *  to appear is an app nobody reads. */
export function serving(port: number): void {
    log(`listening on ${port}`)
}

/** Never gated, on any channel. A warning an operator cannot turn off is the point of a warning. */
export function refused(sku: string, why: string): void {
    log.warning(`refused ${sku}: ${why}`)
}
