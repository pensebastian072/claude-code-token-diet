#!/usr/bin/env node
// token-audit: measure where your Claude Code tokens go, and whether a settings
// change actually saved anything. Reads the session logs Claude Code already
// keeps in ~/.claude/projects. Read-only, no dependencies, nothing leaves your machine.
//
// Usage:
//   node audit/token-audit.js
//   node audit/token-audit.js --since 2026-09-22 \
//       --change "2026-10-15=200K compact cap" \
//       --change "2026-10-23T01:34Z=skill + memory trims"
//   node audit/token-audit.js --json audit.json      (machine-readable copy)
//
// Each --change starts a new period. A session belongs to the period it started
// in, because settings take effect when a session starts.
//
// "Weighted" tokens price each kind of token the way the API does, relative to
// one fresh input token: cache read 0.1, 5-minute cache write 1.25, 1-hour cache
// write 2, output 5. Subscription limits are not published per token, so treat
// weighted tokens as a cost index, not as an exact share of your plan.

const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i > -1 ? argv[i + 1] : def; };
const all = name => argv.flatMap((a, i) => (a === '--' + name ? [argv[i + 1]] : []));

const root = opt('dir', path.join(os.homedir(), '.claude', 'projects'));
const since = new Date(opt('since', new Date(Date.now() - 30 * 864e5).toISOString()));
const changes = all('change').map(s => {
  const k = s.indexOf('=');
  return { at: new Date(k > -1 ? s.slice(0, k) : s), label: k > -1 ? s.slice(k + 1) : s };
}).sort((a, b) => a.at - b.at);
const periods = [{ at: since, label: 'baseline' }, ...changes];
const periodOf = t => { let p = 0; for (let i = 0; i < periods.length; i++) if (t >= periods[i].at) p = i; return p; };

const W = u => {
  const cw = u.cache_creation_input_tokens || 0;
  const cw1h = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
  return { inp: u.input_tokens || 0, cw1h, cw5m: cw - cw1h, cr: u.cache_read_input_tokens || 0, out: u.output_tokens || 0 };
};
const weight = t => t.inp + 2 * t.cw1h + 1.25 * t.cw5m + 0.1 * t.cr + 5 * t.out;

function walk(d, out = []) {
  let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function isHumanTurn(r) {
  if (r.type !== 'user' || !r.message || r.isMeta || r.isCompactSummary) return false;
  const c = r.message.content;
  const human = t => t && !t.startsWith('<') && !t.startsWith('[Request interrupted');
  if (typeof c === 'string') return human(c);
  if (Array.isArray(c)) return c.some(b => b.type === 'text' && human(b.text || '')) && !c.some(b => b.type === 'tool_result');
  return false;
}

const seenMsg = new Set();
const sessions = [];
for (const f of walk(root)) {
  if (fs.statSync(f).mtime < since) continue;
  const sub = f.includes(path.sep + 'subagents' + path.sep);
  const s = { sub, start: null, turns: 0, calls: [], compactions: 0, skillListing: null };
  for (const ln of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!ln) continue;
    let r; try { r = JSON.parse(ln); } catch { continue; }
    if (!s.start && r.timestamp) s.start = new Date(r.timestamp);
    if (r.type === 'system' && r.subtype === 'compact_boundary') s.compactions++;
    if (r.type === 'attachment' && r.attachment && r.attachment.type === 'skill_listing' && s.skillListing === null)
      s.skillListing = JSON.stringify(r.attachment).length;
    if (isHumanTurn(r)) s.turns++;
    if (r.type === 'assistant' && r.message && r.message.usage) {
      const id = r.message.id + '|' + (r.requestId || '');
      if (seenMsg.has(id)) continue;
      seenMsg.add(id);
      const t = W(r.message.usage);
      const ctx = t.inp + t.cw1h + t.cw5m + t.cr;
      if (!ctx) continue;
      s.calls.push({ ...t, ctx, w: weight(t), ts: new Date(r.timestamp) });
    }
  }
  if (s.start && s.start >= since && s.calls.length) sessions.push(s);
}

const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const sum = a => a.reduce((x, y) => x + y, 0);
const M = n => (n / 1e6).toFixed(2) + 'M';
const K = n => (n / 1e3).toFixed(1) + 'K';

function stats(list) {
  const main = list.filter(s => !s.sub);
  const calls = list.flatMap(s => s.calls);
  const mainCalls = main.flatMap(s => s.calls);
  const turns = sum(main.map(s => s.turns));
  const w = sum(calls.map(c => c.w));
  const days = new Set(calls.map(c => c.ts.toISOString().slice(0, 10))).size;
  return {
    sessions: main.length, subagentRuns: list.length - main.length, turns, calls: calls.length, activeDays: days,
    weighted: w,
    weightedPerTurn: turns ? w / turns : 0,
    weightedPerCall: calls.length ? w / calls.length : 0,
    rawPerTurn: turns ? sum(calls.map(c => c.ctx + c.out)) / turns : 0,
    shareCacheRead: w ? sum(calls.map(c => 0.1 * c.cr)) / w : 0,
    shareCacheWrite: w ? sum(calls.map(c => 2 * c.cw1h + 1.25 * c.cw5m)) / w : 0,
    shareOutput: w ? sum(calls.map(c => 5 * c.out)) / w : 0,
    shareSubagents: w ? sum(list.filter(s => s.sub).flatMap(s => s.calls).map(c => c.w)) / w : 0,
    callsOver200k: mainCalls.length ? mainCalls.filter(c => c.ctx > 200e3).length / mainCalls.length : 0,
    weightOver200k: w ? sum(mainCalls.filter(c => c.ctx > 200e3).map(c => c.w)) / w : 0,
    ctxP50: q(mainCalls.map(c => c.ctx), 0.5), ctxP90: q(mainCalls.map(c => c.ctx), 0.9), ctxMax: q(mainCalls.map(c => c.ctx), 1),
    startupFloorP50: q(main.map(s => s.calls[0].ctx), 0.5),
    skillListingCharsP50: q(main.map(s => s.skillListing).filter(x => x !== null), 0.5),
    compactionsPer100Calls: mainCalls.length ? 100 * sum(main.map(s => s.compactions)) / mainCalls.length : 0,
    outputPerCallP50: q(mainCalls.map(c => c.out), 0.5),
  };
}

const byPeriod = periods.map((p, i) => ({ ...p, end: periods[i + 1] ? periods[i + 1].at : null, ...stats(sessions.filter(s => periodOf(s.start) === i)) }));

const pct = (a, b) => (a ? ((b - a) / a * 100).toFixed(0) + '%' : 'n/a');
const rows = [
  ['Sessions (subagent runs)', p => `${p.sessions} (${p.subagentRuns})`],
  ['Your messages', p => p.turns],
  ['API calls', p => p.calls],
  ['Active days', p => p.activeDays],
  ['**Weighted tokens per message**', p => '**' + M(p.weightedPerTurn) + '**', 'weightedPerTurn'],
  ['Weighted tokens per API call', p => K(p.weightedPerCall), 'weightedPerCall'],
  ['Raw tokens processed per message', p => M(p.rawPerTurn), 'rawPerTurn'],
  ['Startup cost per session (median first-call context)', p => K(p.startupFloorP50), 'startupFloorP50'],
  ['Skill list size (chars)', p => p.skillListingCharsP50, 'skillListingCharsP50'],
  ['Context per call, median / p90 / max', p => `${K(p.ctxP50)} / ${K(p.ctxP90)} / ${K(p.ctxMax)}`],
  ['Calls over 200K context', p => (100 * p.callsOver200k).toFixed(0) + '%'],
  ['Spend on calls over 200K', p => (100 * p.weightOver200k).toFixed(0) + '%'],
  ['Auto-compactions per 100 calls', p => p.compactionsPer100Calls.toFixed(1), 'compactionsPer100Calls'],
  ['Spend split: cache read / cache write / output', p => `${(100 * p.shareCacheRead).toFixed(0)}% / ${(100 * p.shareCacheWrite).toFixed(0)}% / ${(100 * p.shareOutput).toFixed(0)}%`],
  ['Subagent share of spend', p => (100 * p.shareSubagents).toFixed(1) + '%'],
];

const head = byPeriod.map((p, i) => `${i === 0 ? 'Before' : p.label} (from ${p.at.toISOString().slice(0, 10)})`);
const lines = [];
lines.push(`# Token audit: ${root.replace(os.homedir(), '~')}`);
lines.push('');
lines.push(`Sessions started since ${since.toISOString().slice(0, 10)}. A period runs from its change to the next one.`);
lines.push('');
lines.push(`| metric | ${head.join(' | ')} |${byPeriod.length > 1 ? ' change, first to last |' : ''}`);
lines.push(`|---|${byPeriod.map(() => '---:').join('|')}|${byPeriod.length > 1 ? '---:|' : ''}`);
for (const [label, fn, key] of rows) {
  const delta = byPeriod.length > 1 && key ? pct(byPeriod[0][key], byPeriod[byPeriod.length - 1][key]) : '';
  lines.push(`| ${label} | ${byPeriod.map(fn).join(' | ')} |${byPeriod.length > 1 ? ` ${delta} |` : ''}`);
}

// Week-by-week, so one heavy session cannot make a period look good or bad on its own.
const weekOf = d => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const weeks = [...new Set(sessions.map(s => weekOf(s.start)))].sort();
lines.push('');
lines.push('## Week by week');
lines.push('');
lines.push('| week of | period | messages | weighted per message | calls over 200K | compactions per 100 calls |');
lines.push('|---|---|---:|---:|---:|---:|');
const weekly = [];
for (const wk of weeks) {
  const ss = sessions.filter(s => weekOf(s.start) === wk);
  const ps = [...new Set(ss.map(s => periodOf(s.start)))].map(i => (i === 0 ? 'before' : periods[i].label));
  const st = stats(ss);
  weekly.push({ week: wk, periods: ps, ...st });
  lines.push(`| ${wk} | ${ps.join(' + ')} | ${st.turns} | ${M(st.weightedPerTurn)} | ${(100 * st.callsOver200k).toFixed(0)}% | ${st.compactionsPer100Calls.toFixed(1)} |`);
}

// Biggest single sessions: a pooled number can hide that one or two runs drove it.
lines.push('');
lines.push('## Heaviest sessions (main sessions, by weighted tokens)');
lines.push('');
lines.push('| started | period | messages | API calls | peak context | weighted | share of all |');
lines.push('|---|---|---:|---:|---:|---:|---:|');
const totalW = sum(sessions.flatMap(s => s.calls).map(c => c.w));
for (const s of sessions.filter(s => !s.sub).map(s => ({ ...s, w: sum(s.calls.map(c => c.w)) })).sort((a, b) => b.w - a.w).slice(0, 8)) {
  const i = periodOf(s.start);
  lines.push(`| ${s.start.toISOString().slice(0, 16).replace('T', ' ')} | ${i === 0 ? 'before' : periods[i].label} | ${s.turns} | ${s.calls.length} | ${K(Math.max(...s.calls.map(c => c.ctx)))} | ${M(s.w)} | ${(100 * s.w / totalW).toFixed(1)}% |`);
}

console.log(lines.join('\n'));
const jsonOut = opt('json');
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ generated: new Date().toISOString(), since, periods: byPeriod, weekly }, null, 2));
