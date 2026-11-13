// 38.143, 38.146, 38.147 — THE FEED A DESKTOP APP UPDATES FROM: `abide bundle` writes it beside the
// `.app`, signed, and the app reads it back through the public key the bundle built into it.
//
// SIGNED, AND NOT ONLY HASHED: the digest rides in the feed, so a host that can rewrite the zip can
// rewrite the digest beside it. The signature is over every field the app acts on — `required` and
// `notes` among them — so none can be changed apart from the rest.

import { chmod, mkdir, readdir, rm } from 'node:fs/promises' // bun exposes no permission change, directory creation, listing or removal of its own
import { basename, dirname } from 'node:path' // bun has no path utilities of its own

import { isRecord } from '#shared/isRecord.ts'

import { dataDirectory } from './config.ts'

/** What a feed says, signed. */
export type UpdateFeed = {
    version: string
    /** The zipped `.app`, relative to the feed. */
    file: string
    sha256: string
    required: boolean
    notes: string | null
    signature: string
}

/** The feed's address below what `onLauncher`'s `update` names. */
export const FEED_FILE = 'latest.json'

/** The text a feed's signature is over: every field but the signature, in one order. */
function signedText(
    feed: Omit<UpdateFeed, 'signature'>,
): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(
        JSON.stringify([
            feed.version,
            feed.file,
            feed.sha256,
            feed.required,
            feed.notes,
        ]),
    )
}

const base64 = (bytes: ArrayBuffer): string =>
    Buffer.from(bytes).toString('base64')

/** A new signing key, as the PKCS #8 text `ABIDE_UPDATE_KEY` holds. */
export async function newUpdateKey(): Promise<string> {
    const pair = (await crypto.subtle.generateKey('Ed25519', true, [
        'sign',
        'verify',
    ])) as CryptoKeyPair
    return base64(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
}

/** The public half of `privateKey`, as the text the executable is built with. */
export async function publicKeyOf(privateKey: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'pkcs8',
        Buffer.from(privateKey, 'base64'),
        'Ed25519',
        true,
        ['sign'],
    )
    const { x } = await crypto.subtle.exportKey('jwk', key)
    return Buffer.from(x as string, 'base64url').toString('base64')
}

/**
 * 38.147 — the key an app's updates are signed with: `ABIDE_UPDATE_KEY`, or the file the first
 * bundle made for the app under `keys`, which `made` names where this call made it.
 */
export async function updateKey(
    appName: string,
    keys: string = `${dataDirectory('abide')}/update-keys`,
): Promise<{ privateKey: string; made: string | undefined }> {
    const given = process.env.ABIDE_UPDATE_KEY?.trim()
    if (given) return { privateKey: given, made: undefined }
    const path = `${keys}/${appName}.key`
    const file = Bun.file(path)
    if (await file.exists())
        return { privateKey: (await file.text()).trim(), made: undefined }
    const privateKey = await newUpdateKey()
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, `${privateKey}\n`)
    // Readable by its owner alone: it is what every installed copy trusts.
    await chmod(path, 0o600)
    return { privateKey, made: path }
}

/**
 * 38.146 — zips the `.app` at `app` into `directory` and writes the feed naming it, signed with
 * `privateKey`; answers the feed. A zip of an earlier bundle of the same app is removed.
 */
export async function publishUpdate(
    app: string,
    directory: string,
    release: { version: string; required: boolean; notes: string | null },
    privateKey: string,
): Promise<UpdateFeed> {
    const name = basename(app, '.app')
    const file = `${name}-${release.version}.zip`
    await mkdir(directory, { recursive: true })
    for (const entry of await readdir(directory))
        if (entry.startsWith(`${name}-`) && entry.endsWith('.zip'))
            await rm(`${directory}/${entry}`)
    // `ditto` rather than a zip of our own: it keeps the bundle's symlinks, modes and extended
    // attributes, which the code signature covers.
    await ran([
        'ditto',
        '-c',
        '-k',
        '--keepParent',
        app,
        `${directory}/${file}`,
    ])
    const sha256 = new Bun.CryptoHasher('sha256')
        .update(await Bun.file(`${directory}/${file}`).bytes())
        .digest('hex')
    const unsigned = { ...release, file, sha256 }
    const key = await crypto.subtle.importKey(
        'pkcs8',
        Buffer.from(privateKey, 'base64'),
        'Ed25519',
        false,
        ['sign'],
    )
    const feed: UpdateFeed = {
        ...unsigned,
        signature: base64(
            await crypto.subtle.sign('Ed25519', key, signedText(unsigned)),
        ),
    }
    await Bun.write(
        `${directory}/${FEED_FILE}`,
        `${JSON.stringify(feed, null, 4)}\n`,
    )
    return feed
}

/**
 * 38.143 — the feed `answered` is, where `publicKey` signed it; otherwise the refusal naming what
 * is wrong with it.
 */
export async function verifiedFeed(
    answered: unknown,
    publicKey: string,
): Promise<UpdateFeed | string> {
    if (
        !isRecord(answered) ||
        typeof answered.version !== 'string' ||
        typeof answered.file !== 'string' ||
        typeof answered.sha256 !== 'string' ||
        typeof answered.required !== 'boolean' ||
        (answered.notes !== null && typeof answered.notes !== 'string') ||
        typeof answered.signature !== 'string'
    )
        return 'the update feed is not one `abide bundle` writes'
    const feed = answered as UpdateFeed
    const key = await crypto.subtle.importKey(
        'raw',
        Buffer.from(publicKey, 'base64'),
        'Ed25519',
        false,
        ['verify'],
    )
    const signed = await crypto.subtle
        .verify(
            'Ed25519',
            key,
            Buffer.from(feed.signature, 'base64'),
            signedText(feed),
        )
        .catch(() => false)
    return signed
        ? feed
        : 'the update feed is not signed by the key this app was bundled with'
}

/** Runs `command`, throwing with what it said where it fails. */
export async function ran(command: string[]): Promise<void> {
    const child = Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe' })
    const [code, said] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
    ])
    if (code !== 0)
        throw new Error(
            `${command[0]} failed: ${said.trim() || `exit ${code}`}`,
        )
}
