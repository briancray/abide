/*
Mount path of the framework's socket multiplex: the single ws upgrade point,
with the per-socket HTTP face under `${SOCKETS_PATH}/<name>`. Shared so the
server mount (createServer), the browser channel's dial (socketChannel), and
the REST face advertised to the CLI/MCP (socketOperations) agree on the path.
*/
export const SOCKETS_PATH = '/__abide/sockets'
