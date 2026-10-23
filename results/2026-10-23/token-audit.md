# Token audit: ~\.claude\projects

Sessions started since 2026-09-22. A period runs from its change to the next one.

| metric | Before (from 2026-09-22) | 200K compact cap (from 2026-10-15) | 225K + skill/memory trims (from 2026-10-23) | change, first to last |
|---|---:|---:|---:|---:|
| Sessions (subagent runs) | 32 (13) | 15 (6) | 3 (1) |  |
| Your messages | 186 | 92 | 8 |  |
| API calls | 4046 | 3571 | 140 |  |
| Active days | 20 | 9 | 1 |  |
| **Weighted tokens per message** | **1.05M** | **1.03M** | **0.38M** | -63% |
| Weighted tokens per API call | 48.2K | 26.5K | 22.0K | -54% |
| Raw tokens processed per message | 6.51M | 4.81M | 2.02M | -69% |
| Startup cost per session (median first-call context) | 62.8K | 73.9K | 69.1K | 10% |
| Skill list size (chars) | 23360 | 24989 | 14844 | -36% |
| Context per call, median / p90 / max | 271.3K / 629.6K / 960.3K | 125.7K / 157.9K / 187.2K | 107.5K / 171.1K / 189.8K |  |
| Calls over 200K context | 65% | 0% | 0% |  |
| Spend on calls over 200K | 78% | 0% | 0% |  |
| Auto-compactions per 100 calls | 0.3 | 2.9 | 0.0 | -100% |
| Spend split: cache read / cache write / output | 60% / 27% / 13% | 44% / 37% / 18% | 50% / 29% / 21% |  |
| Subagent share of spend | 3.8% | 2.2% | 17.0% |  |

## Week by week

| week of | period | messages | weighted per message | calls over 200K | compactions per 100 calls |
|---|---|---:|---:|---:|---:|
| 2026-09-21 | before | 20 | 1.01M | 52% | 0.0 |
| 2026-09-28 | before | 54 | 1.22M | 74% | 0.0 |
| 2026-10-05 | before | 73 | 0.84M | 62% | 0.4 |
| 2026-10-12 | before + 200K compact cap | 86 | 1.22M | 18% | 2.0 |
| 2026-10-19 | 200K compact cap + 225K + skill/memory trims | 53 | 0.75M | 0% | 3.3 |

## Heaviest sessions (main sessions, by weighted tokens)

| started | period | messages | API calls | peak context | weighted | share of all |
|---|---|---:|---:|---:|---:|---:|
| 2026-09-28 13:52 | before | 8 | 503 | 814.5K | 30.04M | 10.3% |
| 2026-10-18 11:17 | 200K compact cap | 15 | 940 | 168.5K | 27.41M | 9.4% |
| 2026-09-29 14:58 | before | 16 | 249 | 654.7K | 19.01M | 6.5% |
| 2026-10-09 12:50 | before | 4 | 269 | 960.3K | 17.98M | 6.1% |
| 2026-10-14 01:03 | before | 5 | 217 | 804.5K | 17.66M | 6.0% |
| 2026-09-22 21:12 | before | 9 | 336 | 643.8K | 14.53M | 5.0% |
| 2026-10-10 22:47 | before | 28 | 198 | 781.9K | 14.42M | 4.9% |
| 2026-10-22 12:19 | 200K compact cap | 5 | 433 | 171.8K | 13.91M | 4.8% |
