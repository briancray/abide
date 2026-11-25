---
"@abide/abide": minor
---

Breaking: a job's run is handed what runNow was called with rather than a signal — job({ run: (signal) => … }) becomes job({ run: (input) => … }) with abortSignal() read in the run for its signal, runNow(input?) hands its input on, a run the schedule starts is handed undefined, and a runNow that joins a run in flight leaves its input unread; job and Job take the input's type as Input — 54.20, 54.26, 54.39
