---
"@abide/abide": patch
---

A mutation whose `refreshes` fails — its function throwing or rejecting, or a refresh it asks for — answers as its handler returned rather than with a 500, and warns once on `abide:reactive` naming the handler. RULEBOOK 16.102.
