/**
 * The header marking a request as the client router asking whether it may navigate.
 *
 * 30.15 — the server answers it without rendering (30.16). A leaf because the router writes it and
 * the server reads it.
 */
export const NAVIGATION_HEADER = 'abide-navigation'
