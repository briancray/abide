(("<" @open
  "/>" @close)
  (#set! rainbow.exclude))

(("<" @open
  ">" @close)
  (#set! rainbow.exclude))

(("</" @open
  ">" @close)
  (#set! rainbow.exclude))

(("\"" @open
  "\"" @close)
  (#set! rainbow.exclude))

((element
  (start_tag) @open
  (end_tag) @close)
  (#set! newline.only)
  (#set! rainbow.exclude))

(expression
  "{" @open
  "}" @close)

(spread
  "{" @open
  "}" @close)

; A block's opening and its end, matched as a pair.
((if_block
  (if_start) @open
  (if_end) @close)
  (#set! newline.only))

((for_block
  (for_start) @open
  (for_end) @close)
  (#set! newline.only))

((try_block
  (try_start) @open
  (try_end) @close)
  (#set! newline.only))
