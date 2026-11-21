---
"@abide/abide": patch
---

The OTLP exporter's 4,096-record bound now holds while a collector is slow: one send is out at a time and what waits for it stays in the bounded queue, where before each batch was chained behind the last and none were dropped. A send the collector has not answered in 10 seconds is given up, so a hung collector no longer holds a stop (RULEBOOK 36.23).
