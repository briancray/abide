import { suffix } from 'bun:ffi'

/*
Native webview shared-library filename for a platform. `suffix` is Bun's
host shared-library extension (`dylib`/`so`/`dll`). The bundler copies a
file under this name and the loader looks for it under the same name, so
both derive it here.
*/
export function webviewLibName(platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? `webview.${suffix}` : `libwebview.${suffix}`
}
