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
    const iconEntry = icon
        ? `    <key>CFBundleIconFile</key>
    <string>${icon}</string>
`
        : ''
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${name}</string>
    <key>CFBundleDisplayName</key>
    <string>${name}</string>
    <key>CFBundleExecutable</key>
    <string>${name}</string>
    <key>CFBundleIdentifier</key>
    <string>com.abide.${name}</string>
    <key>CFBundleVersion</key>
    <string>${version}</string>
    <key>CFBundleShortVersionString</key>
    <string>${version}</string>
${iconEntry}    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
`
}
