# @belte/claude-code

## 0.2.0

### Minor Changes

- [`d23c7ec`](https://github.com/briancray/belte/commit/d23c7ec542c180e611dd47c663cfc65319cb23ad) - `engine(config)` now controls Claude Code's posture with a single `permissionMode` option (`'default'` | `'acceptEdits'` | `'plan'` | `'dontAsk'` | `'bypassPermissions'`), replacing the `permission` allow/deny lists; `'bypassPermissions'` is wired with the SDK's required `allowDangerouslySkipPermissions` flag
