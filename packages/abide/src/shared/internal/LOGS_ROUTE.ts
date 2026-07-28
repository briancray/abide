// The framework route that streams this process's log records — the transport half of a compiled
// binary's `logs` subcommand.
//
// Named once because the router serves it and the CLI dials it. Unlike its neighbours under
// `/__abide/`, it is OFF unless the deployment opts in (`ABIDE_LOGS`): every other generated route
// discloses something the caller could already reach by other means, and this one discloses whatever
// the app happened to log.
export const LOGS_ROUTE = '/__abide/logs'
