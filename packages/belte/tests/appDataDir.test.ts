import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { appDataDir } from '../src/lib/shared/appDataDir.ts'

test('returns an absolute, cwd-independent path ending in the program name', () => {
    const dir = appDataDir('chill')
    expect(dir.startsWith('/') || /^[A-Za-z]:\\/.test(dir)).toBe(true)
    expect(dir.endsWith('chill')).toBe(true)
})

test('roots under the platform-standard per-user data location', () => {
    const dir = appDataDir('chill')
    const expectedRoot =
        process.platform === 'darwin'
            ? join(homedir(), 'Library', 'Application Support')
            : process.platform === 'win32'
              ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
              : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'))
    expect(dir).toBe(join(expectedRoot, 'chill'))
})
