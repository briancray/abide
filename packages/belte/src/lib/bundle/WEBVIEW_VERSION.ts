/*
Upstream `webview/webview` release the vendored `native/webview.h` is taken
from (https://github.com/webview/webview, MIT). Used to namespace the build
cache so bumping the header naturally bypasses any previously built library.
Bump this whenever `native/webview.h` is re-vendored.
*/
export const webviewVersion = '0.12.0'
