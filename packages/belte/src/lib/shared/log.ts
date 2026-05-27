import { isDebugEnabled } from './isDebugEnabled.ts'

const hasBun = typeof Bun !== 'undefined'
const useColor = hasBun && Bun.enableANSIColors
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'

// Wraps `text` in a Bun-resolved ANSI color escape; no-op when colors are disabled or unavailable (browser).
function paint(color: string, text: string): string {
    if (!useColor) {
        return text
    }
    return `${Bun.color(color, 'ansi-256')}${text}${RESET}`
}

// Applies the ANSI dim attribute; no-op when colors are disabled.
function dim(text: string): string {
    if (!useColor) {
        return text
    }
    return `${DIM}${text}${RESET}`
}

// Prefers a full stack trace when the value is an Error so logs include the call site.
function formatError(value: unknown): string {
    if (value instanceof Error) {
        return value.stack ?? value.message
    }
    return String(value)
}

// Maps an HTTP status code to a color that matches the usual server-log convention.
function colorStatus(status: number): string {
    if (status >= 500) {
        return paint('red', String(status))
    }
    if (status >= 400) {
        return paint('yellow', String(status))
    }
    if (status >= 300) {
        return paint('cyan', String(status))
    }
    return paint('green', String(status))
}

// Maps an HTTP method to a color so the request log line is easy to scan.
function colorMethod(method: string): string {
    const upper = method.toUpperCase()
    if (upper === 'GET') {
        return paint('green', upper)
    }
    if (upper === 'POST') {
        return paint('blue', upper)
    }
    if (upper === 'PUT' || upper === 'PATCH') {
        return paint('yellow', upper)
    }
    if (upper === 'DELETE') {
        return paint('red', upper)
    }
    return paint('magenta', upper)
}

const BELTE = useColor ? `${BOLD}${Bun.color('magenta', 'ansi-256')}[belte]${RESET}` : '[belte]'

// Browser console already has its own DEBUG storage convention, but for the shared logger
// we honor the same DEBUG env. In the browser `process.env.DEBUG` may not exist.
const debugEnv = typeof process !== 'undefined' ? process.env.DEBUG : undefined

/*
Shared logger used by both the build pipeline and the request handler.
Wraps console.* with ANSI coloring, a `[belte]` prefix, and a per-method/
per-status palette for `request()`. console.* is the side effect — logging
is intentionally impure.
*/
export const log = {
    info(message: string): void {
        console.log(`${BELTE} ${message}`)
    },
    warn(message: string): void {
        console.warn(`${BELTE} ${paint('yellow', message)}`)
    },
    error(value: unknown): void {
        console.error(`${BELTE} ${paint('red', formatError(value))}`)
    },
    success(message: string): void {
        console.log(`${BELTE} ${paint('green', message)}`)
    },
    detail(message: string): void {
        console.log(dim(message))
    },
    debug(scope: string, message: string): void {
        if (!isDebugEnabled(scope, debugEnv)) {
            return
        }
        console.log(`${dim(`[${scope}]`)} ${dim(message)}`)
    },
    request(method: string, path: string, status: number, durationMs: number): void {
        console.log(
            `${colorMethod(method)} ${path} ${colorStatus(status)} ${dim(`${durationMs.toFixed(2)}ms`)}`,
        )
    },
}
