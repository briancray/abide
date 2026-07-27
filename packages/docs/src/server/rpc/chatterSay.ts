import { POST } from 'abide/server/POST'
import { say } from '$server/chatterLoop'

// Publish into the channel the server-side `for await` loop is subscribed to. Nothing here knows about
// the loop — `publish` appends to the topic and the hub fans it out to whoever is iterating.
// #demo chatterSay
export default POST(({ text }: { text: string }) => {
    say(text)
    return { published: text }
})
// #enddemo
