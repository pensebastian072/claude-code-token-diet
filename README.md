# claude-code-token-diet

Measure where your Claude Code tokens go, then cut them. Three settings and one
third-party plugin, each measured on 30 days of my own session logs
(50 sessions, about 7,100 API calls, Opus with the 1M context window).

The scripts only read the logs Claude Code already keeps in `~/.claude/projects`.
No dependencies, nothing leaves your machine.

## Results

| lever | what it is | measured effect |
|---|---|---|
| **Compact cap** | `"autoCompactWindow": 200000` | **−46%** weighted tokens on the same work (replay of 30 days). Real cost per API call 48.2K → 26.5K (**−45%**). |
| **225K instead of 200K** | `"autoCompactWindow": 225000` | About +1% cost, but **28% fewer compactions** (216 → 156) and ~65 min less waiting per month. |
| **Trim the fixed context** | unused skills listed by name only, memory index condensed | ~5.3K tokens off every call. **−2.2%** on the same work. |
| **caveman** (not mine, [link](https://github.com/JuliusBrussee/caveman)) | rules that make answers terse | **−20%** answer tokens on Q&A prompts (A/B, 10 prompts). In agentic coding about **0.1%** of spend, roughly what its own rules cost to carry. |

"Weighted tokens" price each kind of token the way the API does, relative to one
fresh input token: cache read 0.1, 5-minute cache write 1.25, 1-hour cache write 2,
output 5. Subscription limits are not published per token, so read it as a cost
index, not an exact share of your plan.

## The one thing to know: context size is the bill

Every API call re-sends the whole conversation. Cached tokens are cheap (0.1x),
but an agentic session makes hundreds of calls, so a big context gets paid for
over and over. At 600K of context, each call costs about 60K input tokens
before the model writes a word.

Before the cap, with the 1M window:

- median context per call was **271K**, p90 **630K**, max **960K**
- **65%** of calls ran above 200K, and those calls were **78%** of all spend

After the 200K cap: median **126K**, max **187K**, 0% of calls above 200K.

Output length matters much less than it feels like. In my agentic sessions,
output tokens were 13 to 21% of spend, and only about 2.4% of output tokens were
the prose answer. The rest was tool calls (code edits, commands) and thinking.

## Why not cap lower?

Each compaction costs something: a summary call that reads the whole context,
a cache rewrite on the next call, and about 64 seconds of waiting. Below 175K you
compact so often that those costs win:

| autoCompactWindow | weighted tokens | vs no cap | compactions | time compacting |
|---:|---:|---:|---:|---:|
| 150K | 273.3M | −31% | 776 | 832 min |
| 175K | 222.7M | −44% | 348 | 373 min |
| 200K | 214.4M | −46% | 216 | 232 min |
| **225K** | **217.0M** | **−45%** | **156** | **167 min** |
| 250K | 219.4M | −45% | 116 | 124 min |
| 300K | 231.2M | −42% | 77 | 83 min |
| 400K | 259.4M | −35% | 44 | 47 min |
| none (1M) | 397.5M | 0% | 5 | 5 min |

The bottom of the curve is flat from 175K to 250K. I run 225K: almost the same
cost as 200K, and a quarter fewer interruptions.

Compaction fires about 35K tokens below the window you set, so 225K compacts at
about 190K.

## caveman

[caveman](https://github.com/JuliusBrussee/caveman) tells the model to answer
like a terse caveman: no filler, no pleasantries, fragments OK, code untouched.
I had it on for all 30 days, so my logs have no before/after. Instead
`bench/caveman-ab.js` asks the same 10 developer questions with and without
the rules, 2 reps each, through `claude -p` (Opus, effort xhigh, no tools).

| | normal | caveman | change |
|---|---:|---:|---:|
| Answer tokens (visible) | 19,102 | 15,213 | **−20%** |
| Answer characters | 51,131 | 37,144 | −27% |
| Thinking tokens | 10,841 | 6,395 | −41% (noisy, see below) |
| All output tokens | 29,943 | 21,608 | −28% |

Every one of the 10 prompts got shorter, by 6% to 34% (median 22%). Full table:
[results/2026-10-23/caveman-ab.md](results/2026-10-23/caveman-ab.md).

The project's own README claims 65 to 75%. On this model I measured 20% of
tokens and 27% of characters. Characters fall faster than tokens: swapping a
long word for a short one saves characters but often not a token, and code,
which caveman leaves alone, is a bigger share of what remains.

**What it means for your bill depends on what you use Claude Code for.**

- **Q&A and chat:** the answer is most of the output, so −20 to −28% of output
  tokens is real.
- **Agentic coding:** in my sessions the prose answer is about 2.4% of output
  tokens; tool calls and thinking are the rest. Output is about 18% of spend.
  A 20% cut on 2.4% of 18% is **about 0.1% of total spend**. caveman's own rules
  ride along on every call too (about 1,250 characters at session start plus 125
  per message), which costs about the same. On cost, it is a wash.
- **Thinking:** this is the part that could matter. Thinking tokens fell 41%
  with caveman on, but one prompt is 63% of that drop (27% without it), and 2
  reps is too few to trust. If it held in agentic work it would be worth a few
  percent. Not proven here.

So keep caveman because you like reading it, not for the bill. The bill is the
compact window.

## What these numbers do and do not show

- **My first estimate was wrong.** I first reported −62% per message. That
  script only counted typed messages and missed about 40% of turns (voice and
  phone messages are stored differently). Corrected, cost per message barely
  moved: 1.05M → 1.03M.
- **Per message is the wrong yardstick anyway.** After the cap I gave longer
  tasks: API calls per message went from 21.8 to 38.8. So I compare cost per API
  call, and I replay the same 30 days of work under each setting
  (`cap-whatif.js`). Both say about −45%.
- **The replay is a model, not a measurement.** It keeps every call fixed and
  does not model the model re-reading a file it lost in a compaction. Checked
  against what the logs say I actually spent, it lands within 1.7% overall, but
  individual sessions can be off by 30 to 47% (some old sessions compacted early
  for reasons the replay does not know about).
- **The trims have little data yet.** Startup context went from a median of
  75.4K (6 sessions) to 69.1K (3 sessions). The 5.3K figure is an estimate from
  the size of what I removed (11.0K characters of skill list and 7.5K of memory
  index). In `results/2026-10-23/token-audit.md` the last column is 8 messages:
  ignore its per-message numbers.
- **One person, one machine, one model.** Your mix of work is different. Run
  the scripts on your own logs.

## Run it on your own logs

Needs Node 18 or newer.

```bash
# Where do my tokens go? Split into periods at the times you changed settings.
node audit/token-audit.js --since 2026-09-22 \
    --change "2026-10-15T03:29Z=200K compact cap" \
    --change "2026-10-23T01:31Z=225K + trims"

# What would each compact window have cost on the work I actually did?
node audit/cap-whatif.js --since 2026-09-22 \
    --cap-set-at 2026-10-15T03:29Z --cap-set-to 200000

# Same, plus: what if I trimmed 5,300 tokens of fixed context?
node audit/cap-whatif.js --since 2026-09-22 --floor-cut 5300 --floor-cap 225000

# Which skills sit in my context every call and never get used?
node audit/unused-skills.js --days 30 --keep skill-i-want-described

# caveman A/B: same prompts, with and without the caveman rules
git clone https://github.com/JuliusBrussee/caveman ../caveman
node bench/caveman-ab.js --rules ../caveman/skills/caveman/SKILL.md --reps 2 \
    --out bench/results/run.jsonl
node bench/caveman-ab.js --summary bench/results/run.jsonl
```

The benchmark runs `claude -p` with your normal login, from an empty folder,
with no tools and no session saved. It costs real usage: 10 prompts x 2 arms x
2 reps = 40 runs.

## Apply the settings

Merge `settings/token-diet.settings.json` into `~/.claude/settings.json`:

```json
{
  "autoCompactEnabled": true,
  "autoCompactWindow": 225000,
  "skillOverrides": {
    "example-skill-you-never-use": "name-only"
  }
}
```

- Fill `skillOverrides` from the block `unused-skills.js` prints. A skill listed
  `name-only` still works when you ask for it by name; it just stops carrying
  its description into every call. Keep descriptions on for skills you need the
  model to reach for on its own (safety rules, for example).
- Condensing the memory index: see [docs/memory-index.md](docs/memory-index.md).
- Settings apply when a session starts. Start a new one to see the change.

## Files

| path | what it does |
|---|---|
| `audit/token-audit.js` | Cost per message, per call, startup size, context spread, compactions, week by week, heaviest sessions |
| `audit/cap-whatif.js` | Replays your sessions under different `autoCompactWindow` values, same work |
| `audit/unused-skills.js` | Skills you never use and what their descriptions cost, plus a paste-ready `skillOverrides` block |
| `bench/caveman-ab.js` | A/B benchmark: caveman rules on vs off |
| `bench/prompts.json` | The 10 benchmark prompts |
| `results/2026-10-23/` | My saved outputs |
| `settings/` | The settings above |
| `docs/memory-index.md` | How I cut the memory index from 18.2K to 10.7K characters |

## Credits

[caveman](https://github.com/JuliusBrussee/caveman) is by Julius Brussee, MIT
licensed. None of its code is in this repo; the benchmark reads its rules from
your own clone.

## License

MIT. See [LICENSE](LICENSE).
