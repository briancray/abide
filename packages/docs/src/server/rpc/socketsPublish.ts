import { POST } from "abide/server/POST"
import socketsChat, { type ChatMessage } from "../sockets/socketsChat"

// A mutating RPC that publishes to the chat socket from the SERVER. `socket.publish` bypasses the
// socket handler (unlike a client publish), so the message keeps `via: "server"`. Every live
// subscriber — the browser's SSE/WS subscription — receives it live and fans it into the DOM.
// #demo publish-rpc
export default POST(({ text }: { text: string }): { published: ChatMessage } => {
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    text: String(text ?? "").trim() || "(empty)",
    via: "server",
  }
  socketsChat.publish(message)
  return { published: message }
})
// #enddemo
