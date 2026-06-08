import { dirname } from 'node:path'
import { log } from '../shared/log.ts'
import { WEBVIEW_VERSION } from './WEBVIEW_VERSION.ts'
import { webviewCachePath } from './webviewCachePath.ts'

// Vendored upstream amalgamation; the host compiler turns it into a lib.
const HEADER = new URL('./native/webview.h', import.meta.url).pathname

// belte's own native shim, linked into the same dylib on macOS to add the
// standard application menu bar the upstream webview omits.
const MAC_MENU_SOURCE = new URL('./native/belteMenu.mm', import.meta.url).pathname

/*
Linux GTK/WebKit pkg-config module sets, newest first. The vendored header
auto-selects the GTK4 or GTK3 backend from GTK_MAJOR_VERSION in the include
path, so supplying the right cflags/libs is all that's needed — no backend
macro. The first set whose packages are installed wins.
*/
const LINUX_PKG_SETS = [
    ['gtk4', 'webkitgtk-6.0'],
    ['gtk+-3.0', 'webkit2gtk-4.1'],
    ['gtk+-3.0', 'webkit2gtk-4.0'],
]

/*
Compiles the vendored webview header into a native shared library for the
host platform and caches it (webviewCachePath), so `belte bundle` needs
no prebuilt binary and no third-party webview package — just
the platform's C++ toolchain. Returns the cached path. Throws actionable
guidance when the toolchain or native webview dev packages are missing,
rather than letting the compiler fail opaquely.
*/
export async function buildWebviewLib(): Promise<string> {
    const outfile = webviewCachePath()
    await Bun.$`mkdir -p ${dirname(outfile)}`.quiet()
    log.info(`building webview ${WEBVIEW_VERSION} for ${process.platform}-${process.arch}…`)

    if (process.platform === 'darwin') {
        await compileDarwin(outfile)
    } else if (process.platform === 'linux') {
        await compileLinux(outfile)
    } else {
        /*
        Windows needs MSVC + the WebView2 SDK header (WebView2.h), which
        isn't a turnkey shell invocation. Until that build path lands,
        point Windows users at the explicit-path escape hatch.
        */
        throw new Error(
            `[belte] building the webview library on ${process.platform} isn't supported yet. ` +
                'Set BELTE_WEBVIEW_LIB to a prebuilt webview library to continue.',
        )
    }

    log.success(`built webview library: ${outfile}`)
    return outfile
}

// macOS: clang against the WebKit + Cocoa frameworks (always present with the
// Command Line Tools), linking belte's Objective-C++ menu shim into the same
// dylib. The `-x` flags switch the input language per file: the vendored
// header compiles as C++ (it uses the C objc runtime, not objc syntax), the
// shim as Objective-C++. Maps a missing compiler to the install hint.
async function compileDarwin(outfile: string): Promise<void> {
    try {
        await Bun.$`clang++ -std=c++17 -DWEBVIEW_BUILD_SHARED -fvisibility=hidden -shared -framework WebKit -framework Cocoa -x c++ ${HEADER} -x objective-c++ ${MAC_MENU_SOURCE} -o ${outfile}`.quiet()
    } catch (error) {
        throw new Error(
            '[belte] failed to compile the webview library. Install the Xcode Command ' +
                'Line Tools with `xcode-select --install` and try again.\n' +
                describeShellError(error),
        )
    }
}

// Linux: detect an installed GTK/WebKit set via pkg-config, then compile a
// position-independent shared object. Maps missing packages to install hints.
async function compileLinux(outfile: string): Promise<void> {
    const flags = await linuxPkgFlags()
    try {
        await Bun.$`c++ -std=c++17 -DWEBVIEW_BUILD_SHARED -fvisibility=hidden -fPIC -shared -x c++ ${HEADER} ${flags} -o ${outfile}`.quiet()
    } catch (error) {
        throw new Error(
            '[belte] failed to compile the webview library. Ensure a C++ compiler ' +
                '(e.g. `build-essential`) is installed.\n' +
                describeShellError(error),
        )
    }
}

// Returns combined cflags + libs for the first available GTK/WebKit set, or
// throws with the package names to install when none resolve.
async function linuxPkgFlags(): Promise<string[]> {
    for (const modules of LINUX_PKG_SETS) {
        const probe = await Bun.$`pkg-config --exists ${modules}`.nothrow().quiet()
        if (probe.exitCode === 0) {
            const flags = await Bun.$`pkg-config --cflags --libs ${modules}`.quiet().text()
            return flags.trim().split(/\s+/)
        }
    }
    throw new Error(
        '[belte] no GTK/WebKit development packages found. Install one set, e.g. ' +
            '`libgtk-4-dev libwebkitgtk-6.0-dev` or `libgtk-3-dev libwebkit2gtk-4.1-dev`, ' +
            'or set BELTE_WEBVIEW_LIB to a prebuilt webview library.',
    )
}

// Surfaces the compiler's own stderr when a Bun shell command throws.
function describeShellError(error: unknown): string {
    const stderr = (error as { stderr?: Uint8Array }).stderr
    return stderr ? new TextDecoder().decode(stderr) : String(error)
}
