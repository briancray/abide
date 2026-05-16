import { isDebugEnabled } from './isDebugEnabled.ts'

const useColor = Bun.enableANSIColors
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'

function paint(color: string, text: string): string {
    if (!useColor) {
        return text
    }
    return `${Bun.color(color, 'ansi-256')}${text}${RESET}`
}

function dim(text: string): string {
    if (!useColor) {
        return text
    }
    return `${DIM}${text}${RESET}`
}

function formatError(value: unknown): string {
    if (value instanceof Error) {
        return value.stack ?? value.message
    }
    return String(value)
}

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

// console.* is the side effect — logging is intentionally impure
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
        if (!isDebugEnabled(scope)) {
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
