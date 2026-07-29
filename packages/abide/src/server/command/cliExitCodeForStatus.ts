// Map an HTTP status onto the CLI failure class it exits with (MS3.4). One status must never exit two
// different ways depending on which caller noticed it, so every non-2xx path routes through here.

import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'

export function cliExitCodeForStatus(status: number): number {
    if (status === 422) return CLI_EXIT_CODES.validation
    if (status === 401 || status === 403) return CLI_EXIT_CODES.unauthorized
    if (status === 404) return CLI_EXIT_CODES.notFound
    if (status === 504) return CLI_EXIT_CODES.timeout
    if (status >= 500) return CLI_EXIT_CODES.serverError
    if (status >= 400) return CLI_EXIT_CODES.clientError
    return CLI_EXIT_CODES.failed
}
