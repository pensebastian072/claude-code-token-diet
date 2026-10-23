# caveman A/B: same 10 prompts, rules on vs off

Run 2026-10-23 with `claude -p`, no tools, empty folder, 2 reps per arm, arm order alternated. Token counts are medians of the 2 reps.

Model claude-opus-5-5, effort xhigh, 40 runs, 10 prompts.

| prompt | normal visible | caveman visible | change | normal thinking | caveman thinking |
|---|---:|---:|---:|---:|---:|
| py-mutable-default | 408 | 270 | -34% | 64 | 0 |
| cors-error | 1052.5 | 878.5 | -17% | 415 | 125.5 |
| sql-n-plus-one | 1342.5 | 1023 | -24% | 285 | 27.5 |
| debounce-js | 557 | 497.5 | -11% | 60.5 | 26 |
| review-path-traversal | 977 | 872 | -11% | 693 | 840.5 |
| git-undo-commit | 468.5 | 357 | -24% | 375 | 359.5 |
| tcp-vs-udp | 1076 | 865.5 | -20% | 103 | 28.5 |
| cache-invalidation | 1361 | 1276.5 | -6% | 639 | 705 |
| regex-email | 1323 | 900 | -32% | 2339.5 | 948.5 |
| docker-layer-cache | 985.5 | 666.5 | -32% | 446.5 | 136.5 |

Visible answer tokens, all runs: normal 19102 -> caveman 15213 (-20.4%)
Thinking tokens, all runs:       normal 10841 -> caveman 6395
All output tokens, all runs:     normal 29943 -> caveman 21608 (-27.8%)
Per-prompt visible change: median -22%, range -34% to -6%, 10 of 10 prompts shorter
Answer chars, all runs:          normal 51131 -> caveman 37144

## Notes

- Visible answer tokens are what caveman targets: -20% overall, 10 of 10 prompts shorter, per-prompt -6% to -34%. Characters fell more (-27%) than tokens: short words cost about as many tokens as long ones.
- Thinking fell 41%, but one prompt (regex-email) is 63% of that drop. Without it thinking fell 27%. Two reps per arm is too few to call the thinking result; treat it as unproven.
- These are standalone questions with no tools: the best case for caveman. In my agentic sessions the prose answer is about 2.4% of output tokens.
- caveman's own rules also ride along on every call: about 1,250 characters injected at session start and 125 per message.
