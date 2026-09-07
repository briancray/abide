---
title: Writing styles
nav: Writing styles
intent: Two guides written seven ways each, so a page's shape is a choice rather than an inheritance.
---

Every page in these docs is written the same way: a problem opens it, a mechanism is named, and
each section deepens the one above it. That shape was never decided. It was set by the first page
written and copied forward, which is how a house style usually happens.

This section is where it gets tested. Two guides are rewritten below in the same seven established
documentation styles, each named at the top of its own page. The subject matter is identical to the
guide it comes from and the example behind it is the same directory on disk, so what differs is
only the shape.

There are two subjects rather than one because a style that suits a single primitive is not thereby
a style. The first subject is `state` — one function, two members, one options bag. The second is
caching, which is five mechanisms with no single name over them: a key, a scope, a cross-caller
variant, a derived response header, and a tag. A style has to survive both to be a candidate.

Nothing here is a proposal. It is a spread to read against each other.

## The controls

The shipped pages are [Local state](../values/show-a-value-that-changes.md) and
[Caching](../values/load-once-per-set-of-arguments.md). Read those first — every page in this
section is one of them, rearranged.

## One primitive: `state`

| Style | Origin | What it optimises for | What it gives up |
| --- | --- | --- | --- |
| [Inverted pyramid](inverted-pyramid.md) | Newspaper wire copy | A reader who stops after two sentences | The build of an argument |
| [Wire copy](wire-copy.md) | The same, in AP prose | A reader who has to be told everything once | Every compound claim the house voice is made of |
| [Example as the page](example-as-page.md) | Nothing standard | A reader who would rather click than read | Search, skimming, and every reader who arrives from a query |
| [MDN reference](mdn-reference.md) | Web platform docs | Looking one fact up | Anyone who does not know the name yet |
| [Tutorial](tutorial.md) | Diátaxis | A first success, guaranteed | Completeness, and every edge case |
| [Cookbook](cookbook.md) | O'Reilly Cookbook | Somebody with a task in hand | The shape of the whole |
| [FAQ](faq.md) | Support desks | The question actually asked | Order, and anything nobody asks |
| [Normative spec](normative-spec.md) | RFC 2119 | Two implementations agreeing | Every reader who is not implementing |
| [README quickstart](readme-quickstart.md) | Package READMEs | Time to first line of code | The why, entirely |

## One system: caching

| Style | How it holds up | Where it strains |
| --- | --- | --- |
| [Caching, inverted pyramid](caching-inverted-pyramid.md) | Best of the seven — the lede is the claim, and ten independent rules is exactly what descending order is for | Nothing in it says the five mechanisms are one design |
| [Caching, wire copy](caching-wire-copy.md) | Defining each term on first mention is what a system page needed anyway | Ten sections of flat assertion, and the reasoning that joins them has nowhere to go |
| [Caching, example as the page](caching-example-as-page.md) | The strongest page in this section — every claim is a request count, shown while it is claimed | A reader who wanted one fact has to click six times to reach it |
| [Caching, MDN reference](caching-mdn-reference.md) | Every option gets a home, and the key derivation table belongs here | It has to invent a subject — there is no `cache()`, so the page becomes `memo()` and the reader must already suspect that |
| [Caching, tutorial](caching-tutorial.md) | The request counter makes every step visible, which no other subject here can claim | Five of the seven mechanisms cannot appear without breaking the one path |
| [Caching, cookbook](caching-cookbook.md) | Five mechanisms are five tasks; the fit is almost suspicious | The two costs of `global` are stated twice, in two recipes, because neither recipe may assume the other |
| [Caching, FAQ](caching-faq.md) | Catches the questions the guide's order buries — coalescing, `pending()` on the result | No place for why the request-ambient refusal is what makes the header trustworthy |
| [Caching, normative spec](caching-normative-spec.md) | The subject that most rewards it: eight clause groups, and the interactions become cross-references | Unreadable by anyone deciding whether to use it |
| [Caching, README quickstart](caching-readme-quickstart.md) | Three tables carry more than three pages of prose would | The gotchas list is the page, and a gotcha with no mechanism behind it is a rule to memorise |

## What to compare

Read the first two sentences of each and stop. That is the only test most pages ever get, and it
separates these fourteen more than anything further down does.

Then look for the connective tissue: `so far`, `already`, `as we saw above`. A style that
tolerates it is a style that assumes a reader who started at the top. Three of the seven forbid it
outright, and rewriting under that rule is what costs the most.

Then read [Inverted pyramid](inverted-pyramid.md) against [Wire copy](wire-copy.md), and the two
caching pages the same way. Those pairs hold the section order fixed and change only the prose, so
what moves between them is voice alone. The first pass conflated the two: it adopted the inverted
pyramid's ordering and kept the house sentence, which is most of why it read as half-applied.

Then read the two subjects against each other in one style. The pair is the instrument: a style
that reads well on `state` and badly on caching is a style that was being carried by a subject with
one name, and four of the seven are.

Two of the fourteen put the prose inside the running page rather than beside it, and those are
the ones that change what an example is FOR. A tip on a state is not a caption: it is the sentence
the guide would have written, standing on the state it is about, which is why the claim and its
evidence cannot come apart. The cost is that nothing in them is searchable and nothing is skimmable.

Last, count what each style cannot say. The spec cannot motivate anything. The tutorial cannot
admit an exception. The FAQ has no place for a fact nobody thinks to ask about, and that is exactly
where `Accepted` and `Stored` coming apart would have gone — and, on the caching side, where the
build error that makes `cache-control` trustworthy would have.
