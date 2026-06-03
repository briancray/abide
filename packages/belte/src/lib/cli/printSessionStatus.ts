import { probeBelteServer } from '../bundle/probeBelteServer.ts'
import type { CliTarget } from './types/CliTarget.ts'

/*
Prints the session's connection line. A local instance (spawned child) reads as
"running a local instance"; a remote one reads as "connected to <name>", using the
name the target already carries from its resolve-time probe and only re-probing
when it doesn't. No target → the not-connected hint listing the verbs.
*/
export async function printSessionStatus(target: CliTarget | undefined): Promise<void> {
    if (!target) {
        console.log('(not connected — /connect <url> or /start)')
        return
    }
    if (target.child) {
        console.log(`running a local instance at ${target.url}`)
        return
    }
    const name = target.name ?? (await probeBelteServer(target.url))?.name ?? target.url
    console.log(`connected to ${name} at ${target.url}`)
}
