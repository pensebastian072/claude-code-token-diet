# Compact-window what-if: 50 sessions, 7110 API calls since 2026-09-22

Measured from your logs: compaction fires ~35K below the window, context right after it ~92K, summary ~5K tokens, ~36K stays cached through it, each compaction waits ~64 s.
Calibration: the replay at each session's real setting gives 292.7M weighted vs 287.8M logged (1.7%).

| autoCompactWindow | weighted tokens | vs no cap | compactions | time spent compacting |
|---:|---:|---:|---:|---:|
| 150K | 273.3M | -31% | 776 | 832 min |
| 175K | 222.7M | -44% | 348 | 373 min |
| 200K | 214.4M | -46% | 216 | 232 min |
| 225K | 217.0M | -45% | 156 | 167 min |
| 250K | 219.4M | -45% | 116 | 124 min |
| 300K | 231.2M | -42% | 77 | 83 min |
| 400K | 259.4M | -35% | 44 | 47 min |
| none (1M) | 397.5M | 0% | 5 | 5 min |

Trimming 5.3K tokens of fixed setup at a 225K window: 217.0M -> 212.2M weighted (-2.2%), compactions 156 -> 148.
