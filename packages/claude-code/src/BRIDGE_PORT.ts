/* Fixed loopback port the serve bridge listens on and the browser connects to.
Fixed rather than scanned so the page can reach a running bridge at a known
address — presence is just whether the WebSocket opens. */
export const BRIDGE_PORT = 8787
