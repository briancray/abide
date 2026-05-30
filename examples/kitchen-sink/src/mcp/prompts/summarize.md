---
description: Draft a request to summarize a topic.
arguments:
  - name: topic
    description: the subject to summarize
    required: true
  - name: tone
    description: optional voice for the summary (e.g. playful, formal)
    required: false
---
Write a concise summary of {{topic}} in a {{tone}} tone.
