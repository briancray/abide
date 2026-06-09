import type { PermissionMode } from './PermissionMode.ts'

/* Permission policy for a local-Claude run: the session mode plus allow/ask/deny
tool-rule lists (same shape as .claude/settings.json's `permissions`). The CLI
engine maps `defaultMode` to `--permission-mode` and the rules to `--settings`. */
export type ClaudePermissions = {
    defaultMode?: PermissionMode
    allow?: string[]
    ask?: string[]
    deny?: string[]
}
