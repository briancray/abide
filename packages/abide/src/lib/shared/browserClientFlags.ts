import type { ClientFlags } from './types/ClientFlags.ts'

/*
Client surface flags for a browser-emitted RPC/socket stub. The bundler only
emits the browser proxy when clients.browser is true, so browser is always true
here; mcp/cli are server-only discovery state with no meaning in the browser
bundle, defaulted false so the public RemoteFunction/Socket shape matches the
server side. Single source shared by remoteProxy and socketProxy.
*/
export const browserClientFlags: ClientFlags = { browser: true, mcp: false, cli: false }
