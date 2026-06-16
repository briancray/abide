# Kitchen-sink

Any file dropped under `src/mcp/resources/` is exposed over MCP at
`abide://resources/<path>`. Text files (like this one) are returned inline as
UTF-8; binary files are returned base64-encoded.

This file backs the `resources/read` button on the `/mcp` page.
