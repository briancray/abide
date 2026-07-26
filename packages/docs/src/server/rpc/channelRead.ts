import { GET } from 'abide/server/GET'
import { notes, type RoomNote } from '$shared/roomChannel'

// Read ONE room through the shared read surface — the same `peek` / `chunks` vocabulary a memo exposes,
// here over a channel's lossy hub. `memo: false` so every read reflects the live hub rather than a
// retained slot (this is pub/sub state, not a memoized fetch).
// #demo channelRead
export default GET(
    ({ room }: { room: string }) => ({
        room,
        latest: notes.peek({ room }) ?? null,
        tail: (notes.chunks({ room }) ?? []) as RoomNote[],
    }),
    { memo: false },
)
// #enddemo
