/**
 * The key a jsonl line carries a continuation under (16.97): the token the rest of an early-called
 * stream is taken by over the socket mux. The server writes it, a browser's wire reads it.
 */
export const CONTINUE_KEY = '$continue'
