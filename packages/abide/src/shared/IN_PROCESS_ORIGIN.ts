// The origin a request made in process is addressed to, where no listener names a real one: an
// rpc's `raw` answered by the app this process holds, a CLI command asking the app it booted, and
// an `App.run` given a principal and no request (42.19). A leaf, because the server and the shared
// rpc both build one.
export const IN_PROCESS_ORIGIN = 'http://app.internal'
