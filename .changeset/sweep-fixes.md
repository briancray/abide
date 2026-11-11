---
'@abide/abide': patch
---

Because a signed-in pairing holder is now base64url text (44.63), a bridge's existing "always allow" for a signed-in visitor no longer matches, and they are asked once more. A load's `timeout` timer no longer holds the process open.
