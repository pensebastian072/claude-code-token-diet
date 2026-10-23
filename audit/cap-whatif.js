#!/usr/bin/env node
// cap-whatif: what would a different auto-compact window have cost on the work
// you actually did? Re-prices your logged Claude Code sessions under several
// `autoCompactWindow` values, keeping the work (every API call, every output
// token) fixed. That removes the "my tasks were different that week" problem
// a plain before/after comparison has.
//
// Usage:
//   node audit/cap-whatif.js [--since 2026-09-22] [--caps 150000,200000,225000,300000,1000000]
//                            [--until 2026-10-23T00:00Z] [--dir ~/.claude/projects]
//   Calibration: tell it when you changed the window and to what, so the replay
//   at your real setting can be checked against what the logs say you spent:
//                            [--cap-set-at 2026-10-15T03:29Z --cap-set-to 200000] [--calib]
//   Fixed-cost what-if: how much would trimming N tokens of startup context save?
//                            [--floor-cut 5300 --floor-cap 225000]
//
// How it works:
//   1. Rebuild each session's context as if it had never compacted: add back
//      every token a compaction dropped.
//   2. Replay the session under a cap C: when context passes C, compact down to
//      the post-compaction size seen in your own logs, pay the summary call, and
//      rewrite the cache on the next call.
//   3. Price every call the way the API does (see token-audit.js).
//
// Assumptions, stated plainly:
//   - The work does not change with the cap. In reality a compaction can make
//     the model re-read a file it lost, or stay on track better; neither is modeled.
//   - The summary call is not in the logs. Its cost is estimated from the
//     summary length and the context it read.
//   - "1000000" means no practical cap: the model's own 1M window.
// The script first replays each session at the setting it actually ran with and
// checks the result against the logged cost, so you can see how far to trust it.

const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : d; };
const root = opt('dir', path.join(os.homedir(), '.claude', 'projects'));
const since = new Date(opt('since', new Date(Date.now() - 30 * 864e5).toISOString()));
const until = new Date(opt('until', '2100-01-01'));
const caps = opt('caps', '150000,175000,200000,225000,250000,300000,400000,1000000').split(',').map(Number);
const HARD = 1000000;
// The window each session really ran under, for the calibration check:
// --cap-set-at <date> --cap-set-to 200000 means sessions from that date had a 200K window.
const capSetAt = opt('cap-set-at') ? new Date(opt('cap-set-at')) : null;
const capSetTo = Number(opt('cap-set-to', 200000));

function walk(d, out = []) {
  let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) { const p = path.join(d, x.name); if (x.isDirectory()) walk(p, out); else if (x.name.endsWith('.jsonl')) out.push(p); }
  return out;
}

// ---- load main sessions as ordered event lists
const seen = new Set();
const sessions = [];
for (const f of walk(root)) {
  if (f.includes(path.sep + 'subagents' + path.sep)) continue;
  if (fs.statSync(f).mtime < since) continue;
  const ev = []; let start = null; let pendingCompact = null;
  for (const ln of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!ln) continue; let r; try { r = JSON.parse(ln); } catch { continue; }
    if (!start && r.timestamp) start = new Date(r.timestamp);
    if (r.type === 'system' && r.subtype === 'compact_boundary' && r.compactMetadata) {
      pendingCompact = { kind: 'compact', auto: r.compactMetadata.trigger === 'auto', pre: r.compactMetadata.preTokens || 0, post: r.compactMetadata.postTokens || 0, ms: r.compactMetadata.durationMs || 0, summaryChars: 0 };
      ev.push(pendingCompact);
    }
    if (r.type === 'user' && r.isCompactSummary && pendingCompact) pendingCompact.summaryChars = JSON.stringify(r.message.content).length;
    if (r.type === 'assistant' && r.message && r.message.usage) {
      const id = r.message.id + '|' + (r.requestId || ''); if (seen.has(id)) continue; seen.add(id);
      const u = r.message.usage, cw = u.cache_creation_input_tokens || 0;
      const cw1h = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
      const cr = u.cache_read_input_tokens || 0, inp = u.input_tokens || 0, ctx = inp + cw + cr;
      if (!ctx) continue;
      ev.push({ kind: 'call', ts: new Date(r.timestamp), ctx, cw, cw1h, cr, inp, out: u.output_tokens || 0 });
    }
  }
  if (start && start >= since && start < until && ev.some(e => e.kind === 'call')) sessions.push({ start, ev });
}

const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const W = (inp, cw, r1h, cr, out) => inp + cw * (2 * r1h + 1.25 * (1 - r1h)) + 0.1 * cr + 5 * out;

// Post-compaction context size and summary length, measured from your own logs.
// Also how far below the window compaction fires: Claude Code keeps headroom for
// the reply and the summary, so a 200K window compacts at roughly 165K.
const postCtx = [], postCached = [], summaryTok = [], compactMs = [], headroom = [];
for (const s of sessions) for (let i = 0; i < s.ev.length; i++) if (s.ev[i].kind === 'compact') {
  const nx = s.ev.slice(i + 1).find(e => e.kind === 'call'); if (nx) { postCtx.push(nx.ctx); postCached.push(nx.cr); }
  const pv = s.ev.slice(0, i).reverse().find(e => e.kind === 'call');
  if (pv && capSetAt && s.start >= capSetAt && s.ev[i].auto) headroom.push(capSetTo - pv.ctx);
  if (s.ev[i].summaryChars) summaryTok.push(s.ev[i].summaryChars / 3.5);
  if (s.ev[i].ms) compactMs.push(s.ev[i].ms);
}
const P = med(postCtx) || 60000, SUMTOK = med(summaryTok) || 4000, COMPACT_S = (med(compactMs) || 60000) / 1000;
// The system prompt and tool list stay cached through a compaction (and are
// shared between sessions), so a rewrite only pays for what comes after them.
const KEPT = med(postCached) || 0;
const HEADROOM = headroom.length >= 5 ? med(headroom) : 35000;
const trigger = C => Math.min(C, HARD) - HEADROOM;

// ---- step 1: uncompacted timeline per session
// The compaction record's pre/post token counts are not on the same basis as the
// API's context size, so the tokens dropped are measured from the calls on either
// side of the compaction instead, plus one typical step of growth.
for (const s of sessions) {
  const steps = [];
  for (let i = 1, prev = null; i < s.ev.length; i++) {
    const a = s.ev[i - 1], b = s.ev[i];
    if (a.kind === 'call' && b.kind === 'call' && b.ctx >= a.ctx) steps.push(b.ctx - a.ctx);
  }
  const typicalStep = med(steps) || 1500;
  let D = 0, prevU = null, prevCtx = null, afterCompact = false, prevTs = null;
  s.calls = [];
  for (const e of s.ev) {
    if (e.kind === 'compact') { afterCompact = true; continue; }
    if (afterCompact && prevCtx !== null) D += Math.max(0, prevCtx + typicalStep - e.ctx);
    prevCtx = e.ctx;
    const U = e.ctx + D;
    const gap = prevTs ? (e.ts - prevTs) / 6e4 : 0;
    const idleRewrite = prevU !== null && !afterCompact && e.cw > 0.5 * e.ctx && e.ctx > 30000;
    s.calls.push({ ...e, U, g: prevU === null ? e.ctx : U - prevU, first: prevU === null, afterCompact, idleRewrite, gap,
      r1h: e.cw ? e.cw1h / e.cw : 1 });
    prevU = U; afterCompact = false; prevTs = e.ts;
  }
  s.actualCompactions = s.ev.filter(e => e.kind === 'compact').length;
  s.actualW = s.calls.reduce((a, c) => a + W(c.inp, c.cw, c.r1h, c.cr, c.out), 0)
    + s.ev.filter(e => e.kind === 'compact').reduce((a, e) => a + 0.1 * e.pre + 5 * (e.summaryChars ? e.summaryChars / 3.5 : SUMTOK), 0);
}

// ---- step 2: replay under cap C
// cut = tokens removed from the fixed setup every call carries (instructions,
// skill list, memory index). Use it to price a trim: --floor-cut 5000.
function replay(s, C, cut = 0) {
  let S = 0, w = 0, n = 0;
  const kept = Math.max(0, KEPT - cut), post = Math.max(0, P - cut);
  for (const c of s.calls) {
    if (c.first) { S = c.ctx - cut; w += W(c.inp, Math.max(0, c.cw - cut), c.r1h, c.cr, c.out); continue; }
    const g = c.g;
    let next = Math.max(post * 0.5, S + g);
    let rewrite = c.idleRewrite;
    if (next > trigger(C)) {
      // compaction: pay the summary call, then the next call rewrites the cache
      w += 0.1 * S + 5 * SUMTOK; n++;
      next = Math.min(next, post + Math.max(0, g)); rewrite = true;
    }
    const cw = rewrite ? Math.max(0, next - kept) : Math.max(0, Math.min(next, g));
    const cr = Math.max(0, next - cw - c.inp);
    w += W(c.inp, cw, c.r1h, cr, c.out);
    S = next;
  }
  return { w, n };
}

const actualCap = s => (capSetAt && s.start >= capSetAt ? capSetTo : HARD);

const totalActual = sessions.reduce((a, s) => a + s.actualW, 0);
const totalReplayActual = sessions.reduce((a, s) => a + replay(s, actualCap(s)).w, 0);
if (argv.includes('--calib')) {
  console.log('start            cap   calls  compactions(real/replay)  logged   replay   error');
  for (const s of sessions) {
    const r = replay(s, actualCap(s));
    console.log(s.start.toISOString().slice(0, 16), String(actualCap(s) / 1000).padStart(5) + 'K', String(s.calls.length).padStart(6),
      String(s.actualCompactions).padStart(8) + '/' + String(r.n).padEnd(14), (s.actualW / 1e6).toFixed(2).padStart(7), (r.w / 1e6).toFixed(2).padStart(8),
      ((r.w / s.actualW - 1) * 100).toFixed(0).padStart(6) + '%');
  }
  console.log('');
}
const calls = sessions.reduce((a, s) => a + s.calls.length, 0);

const M = n => (n / 1e6).toFixed(1) + 'M';
console.log(`# Compact-window what-if: ${sessions.length} sessions, ${calls} API calls since ${since.toISOString().slice(0, 10)}`);
console.log('');
console.log(`Measured from your logs: compaction fires ~${Math.round(HEADROOM / 1000)}K below the window, context right after it ~${Math.round(P / 1000)}K, summary ~${Math.round(SUMTOK / 1000)}K tokens, ~${Math.round(KEPT / 1000)}K stays cached through it, each compaction waits ~${Math.round(COMPACT_S)} s.`);
console.log(`Calibration: the replay at each session's real setting gives ${M(totalReplayActual)} weighted vs ${M(totalActual)} logged (${((totalReplayActual / totalActual - 1) * 100).toFixed(1)}%).${capSetAt ? '' : ' (pass --cap-set-at <date> if you changed the window during this period)'}`);
console.log('');
console.log('| autoCompactWindow | weighted tokens | vs no cap | compactions | time spent compacting |');
console.log('|---:|---:|---:|---:|---:|');
const base = sessions.reduce((a, s) => a + replay(s, HARD).w, 0);
for (const C of caps) {
  let w = 0, n = 0; for (const s of sessions) { const r = replay(s, C); w += r.w; n += r.n; }
  console.log(`| ${C >= HARD ? 'none (1M)' : Math.round(C / 1000) + 'K'} | ${M(w)} | ${((w / base - 1) * 100).toFixed(0)}% | ${n} | ${(n * COMPACT_S / 60).toFixed(0)} min |`);
}

const cut = Number(opt('floor-cut', 0));
if (cut) {
  const C = Number(opt('floor-cap', 225000));
  let a = 0, b = 0, na = 0, nb = 0;
  for (const s of sessions) { const x = replay(s, C), y = replay(s, C, cut); a += x.w; b += y.w; na += x.n; nb += y.n; }
  console.log('');
  console.log(`Trimming ${Math.round(cut / 100) / 10}K tokens of fixed setup at a ${Math.round(C / 1000)}K window: ${M(a)} -> ${M(b)} weighted (${((b / a - 1) * 100).toFixed(1)}%), compactions ${na} -> ${nb}.`);
}
