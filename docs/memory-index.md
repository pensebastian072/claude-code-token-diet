# Trimming the memory index

Claude Code's auto-memory keeps one file per memory and an index, `MEMORY.md`,
that is loaded into **every** session. Every API call in that session carries it.
Mine had grown to 18.2K characters (~4.8K tokens). Condensed, it is 10.7K
(~2.8K tokens), with all 71 memory files still linked.

The memory files themselves only load when they are relevant, so detail costs
nothing there. Only the index is paid on every call.

## Rules I used

1. **One line per memory.** Link, then a hook of a few words. Detail lives in the file.
2. **Keep the rules in the line.** If a memory holds a "never do X" or a hard user
   rule, the short form of that rule stays in the index line, so it is in context
   even when the file is not opened.
3. **Fold resolved and retired items into one History line.** A list of links with
   two or three words each. They are still findable, they just stop costing a line each.
4. **Group by area** (always-on user rules, each project area, infra, history) so
   the model can find the right file without reading every line.
5. **Keep a backup** of the old index before you rewrite it, and diff the link list
   afterwards: every memory file should still be linked exactly once.

## Check it

```bash
wc -c ~/.claude/projects/*/memory/MEMORY.md
```

After a change, start a new session and run `node audit/token-audit.js` with a
`--change` at the time you made it. The "Startup cost per session" row should drop.

## Same idea, other files

`CLAUDE.md` files load on every call too. The caveman project ships a
`caveman-compress` skill that rewrites a memory or instructions file into
compressed prose. I have not measured it here, so it is not in the results.
