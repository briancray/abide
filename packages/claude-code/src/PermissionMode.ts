/* Session permission mode — the values Claude Code's `--permission-mode` accepts.
Mirrors the SDK's PermissionMode without importing it, so the CLI-driven faces
(serve/launch) don't pull @anthropic-ai/claude-agent-sdk. */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
