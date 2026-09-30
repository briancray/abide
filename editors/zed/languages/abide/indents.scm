(start_tag
  ">" @end) @indent

(self_closing_tag
  "/>" @end) @indent

(element
  (start_tag) @start
  (end_tag)? @end) @indent

; A block's body is indented under its opening, each arm under its own.
(if_block
  (if_start) @start
  (if_end)? @end) @indent

(else_if_clause) @indent

(else_clause) @indent

(for_block
  (for_start) @start
  (for_end)? @end) @indent

(try_block
  (try_start) @start
  (try_end)? @end) @indent

(catch_clause) @indent

(finally_clause) @indent
