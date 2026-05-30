---
"@briancray/belte": minor
---

Bundle (macOS webview): support file downloads. The webview now installs a
navigation + download delegate, so `<a download>`, blob:/data: links, and
`Content-Disposition: attachment` responses save a real file to the user's
Downloads folder and reveal it in Finder — previously the bare WKWebView set no
navigation delegate and silently dropped them. No-op on macOS before 11.3.
