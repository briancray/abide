/*
Path of the CLI install endpoint: the bare path returns the platform-detecting
install script, `${CLI_PATH}/<platform>` the platform tarball. Shared so the
server mount (createServer) and the script the install endpoint emits
(installScript) agree on the path.
*/
export const CLI_PATH = '/__abide/cli'
