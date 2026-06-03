---
"@briancray/belte": patch
---

With no `PORT` set, the server now scans upward from 3000 at bind time, binding the listener that wins the port instead of probing a throwaway server and releasing it first. This closes the gap where the chosen port could be stolen between probe and bind, which crashed boot on `EADDRINUSE` rather than stepping to the next port. A configured `PORT` still binds that exact port and surfaces a collision loudly.
