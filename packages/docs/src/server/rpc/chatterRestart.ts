import { POST } from 'abide/server/POST'
import { restart, transcript } from '$server/chatterLoop'

// Re-enter the `for await` loop after it broke out — a fresh subscription on the same channel. The
// transcript is process-global, so this resets the card for the next visitor too.
export default POST(() => {
    restart()
    return transcript()
})
