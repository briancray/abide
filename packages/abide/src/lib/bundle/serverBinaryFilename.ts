/*
Filename of the embedded server binary that ships beside the launcher
inside a bundle. Both the bundler (which writes it) and the launcher
(which spawns it) derive the name here so they can't drift apart.
*/
export function serverBinaryFilename(platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? 'server.exe' : 'server'
}
