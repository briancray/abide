/*
Renders the `Info.plist` for a macOS `.app` bundle. CFBundleExecutable
must match the launcher's filename in `Contents/MacOS/` or the app won't
launch. `icon` is the filename (without extension) of an `.icns` under
`Contents/Resources/`; omitted when the project ships no icon. The
identifier is synthesized from the program name; a real distribution would
override it with a registered reverse-DNS id.
*/
export function infoPlist({
    name,
    version,
    icon,
}: {
    name: string
    version: string
    icon?: string
}): string {
    /* Interpolated values ride inside plist `<string>` elements, so any `&`/`<`/`>` in a
       project name would otherwise emit malformed XML that codesign/Gatekeeper reject. */
    const escapeXml = (value: string): string =>
        value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const safeName = escapeXml(name)
    const safeVersion = escapeXml(version)
    const iconEntry = icon
        ? `    <key>CFBundleIconFile</key>
    <string>${escapeXml(icon)}</string>
`
        : ''
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${safeName}</string>
    <key>CFBundleDisplayName</key>
    <string>${safeName}</string>
    <key>CFBundleExecutable</key>
    <string>${safeName}</string>
    <key>CFBundleIdentifier</key>
    <string>com.abide.${safeName}</string>
    <key>CFBundleVersion</key>
    <string>${safeVersion}</string>
    <key>CFBundleShortVersionString</key>
    <string>${safeVersion}</string>
${iconEntry}    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
`
}
