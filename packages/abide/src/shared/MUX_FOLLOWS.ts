/**
 * The browser's mux as a handler abide mounts itself reaches it, as slots `#ui/socketWire.ts` fills
 * where it is loaded: a follow of a copy over the mux (18.3), and its end.
 *
 * A leaf, for `RPC_SERVER`'s reason: `pairing` is isomorphic, and the server must not load what
 * fills these.
 */
export const MUX_FOLLOWS: {
    follow:
        | ((
              address: string,
              args: unknown,
              version: number | undefined,
              lifeMs: number | undefined,
              entry: () => unknown,
          ) => void)
        | null
    unfollow: ((address: string, args: unknown) => void) | null
} = { follow: null, unfollow: null }
