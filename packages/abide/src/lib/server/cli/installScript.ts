import { CLI_PATH } from '../../shared/CLI_PATH.ts'

/*
The shell script returned by `GET /__abide/cli` (no platform). Detects
uname OS + arch, normalises common arch aliases, then curls the right
platform-specific tarball and extracts it into `$ABIDE_INSTALL_DIR`
(default `~/.local/bin`). The tarball already contains the `.env` next
to the binary — no separate config write step in the script.

The script is rendered server-side so `<ABIDE_APP_URL>` is the request's own
origin and the embedded curl URL needs no escaping or quoting beyond
basic shell hygiene.
*/
export function installScript(appUrl: string, programName: string): string {
    return `#!/usr/bin/env sh
set -e
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$(uname -m)" in
  x86_64|amd64)   ARCH=x64 ;;
  aarch64|arm64)  ARCH=arm64 ;;
  *)              echo "unsupported architecture: $(uname -m)" >&2 ; exit 1 ;;
esac
INSTALL_DIR="\${ABIDE_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"
URL="${appUrl.replace(/\/$/, '')}${CLI_PATH}/\${OS}-\${ARCH}"
echo "installing ${programName} from $URL into $INSTALL_DIR"
curl -fsSL "$URL" | tar -xz -C "$INSTALL_DIR"
echo "installed: $INSTALL_DIR/${programName}"
echo "ensure $INSTALL_DIR is in your PATH"
`
}
