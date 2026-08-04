import { socket } from 'abide/server/socket'

// A standalone topic owned solely by the done() probe demo. Because no other demo touches it, its
// client proxy starts IDLE — so `done()` genuinely reads `true` until the demo opens a subscription.
// (The shared chat topic already has a subscription open from the live/chunks demos above, which would
// mask the idle state.)
// #demo socket-pulse
export default socket<{ tick: number }>({ channel: { tail: 4 } })
// #enddemo
