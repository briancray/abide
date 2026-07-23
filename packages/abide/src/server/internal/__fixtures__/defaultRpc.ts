// Fixture for deriveSchema.test.ts — the canonical `export default GET(...)` RPC shape every
// file-based RPC uses. The deriver must unwrap the ExportAssignment to the inner handler and read the
// handler's SINGLE arg object (not the Rpc callable's parameter tuple).

import { GET } from "abide/server/GET";

export default GET(({ key = "alpha" }: { key?: string }) => ({ key, runs: 1 }));
