/**
 * The port an app listens on where neither `--port` nor `PORT` names one: `Bun.serve`'s own default,
 * so `abide start`'s, the first `abide dev` tries (38.64), and the one a command reaching the local
 * app calls.
 */
export const DEFAULT_PORT = 3000
