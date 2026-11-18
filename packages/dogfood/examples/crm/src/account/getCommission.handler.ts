import { GET, signedIn } from '@abide/abide/server'

/** What the member signed in has earned this quarter. */
export default GET(() => ({ amount: '$6,200' }), {
    middleware: [signedIn],
    description: "The signed-in member's commission this quarter.",
})
