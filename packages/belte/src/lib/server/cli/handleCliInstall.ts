import { NO_STORE } from '../../shared/cacheControlValues.ts'
import { installScript } from './installScript.ts'

/*
The request host is reflected verbatim into a shell script the user pipes
to `sh`, so it's constrained to the strict authority charset: letters,
digits, `.`, `-`, `_`, `:` (port + IPv6 separators), and IPv6 `[` `]`
brackets. That set excludes every character that could break out of the
interpolated `URL="…"` line in installScript (`"`, `$`, backtick, `\`,
whitespace), neutralising shell injection via a crafted Host header
regardless of how lenient the upstream URL parser is.
*/
const SAFE_HOST = /^[A-Za-z0-9._:[\]-]+$/

/*
Handles GET /__belte/cli — returns the platform-detecting shell script.
Authoritative URL for the tarball is derived from the inbound request
(so the script's curl line points at whatever host the user reached us
on). Program name is the bundler-emitted `belte:cli-name` value.
*/
export function handleCliInstall(request: Request, programName: string): Response {
    const url = new URL(request.url)
    if (!SAFE_HOST.test(url.host)) {
        return new Response('Bad Request', {
            status: 400,
            headers: { 'Cache-Control': NO_STORE },
        })
    }
    const appUrl = url.origin
    const script = installScript(appUrl, programName)
    return new Response(script, {
        headers: {
            'Content-Type': 'text/x-shellscript; charset=utf-8',
            'Cache-Control': NO_STORE,
        },
    })
}
