// The other law's declaration, in the directory that says which law it is. Served at
// `/__abide/socket/feed/ticks`.

import { socket } from '../../sockets.ts'

export const ticks = socket<{ n: number }>()
