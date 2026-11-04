// 44.34 — A SIGN-IN OR SIGN-OUT, heard by whatever on this server follows a browser across one — the
// bridge relay's status streams — without `principal.set` and `principal.clear` knowing what does.

type SignInListener = (caller: string, now: string, signedIn: string) => void

const LISTENERS: SignInListener[] = []

/** Runs `listener` on every sign-in or sign-out this process answers. */
export function onSignInChanged(listener: SignInListener): void {
    LISTENERS.push(listener)
}

/** Tells every listener that the browser at `caller` is `now`, signed in as `signedIn` (`signedInAs`). */
export function signInChanged(
    caller: string,
    now: string,
    signedIn: string,
): void {
    for (const listener of LISTENERS) listener(caller, now, signedIn)
}
