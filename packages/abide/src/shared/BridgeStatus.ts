/**
 * Whether this browser's bridge is connected, the tools it asked for that the bridge cannot give, and
 * the command and the link that pair one — in place of the one connected, where one is — with the
 * command that installs what opens the link.
 *
 * In #shared because both seams hold one: the server's `claudeCode.bridge` yields it, and a browser's
 * `pairing` reads it.
 */
export type BridgeStatus = {
    paired: boolean
    missing: string[]
    command: string
    link: string
    install: string
}
