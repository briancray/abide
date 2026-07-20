import { DELETE } from "abide/server/DELETE"

// A mutating RPC (DELETE).
export default DELETE(({ id = "" }: { id?: string }) => ({
  id,
  verb: "DELETE",
  deleted: true,
}))
