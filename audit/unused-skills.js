#!/usr/bin/env node
// unused-skills: which skills sit in your context on every call but never get used?
//
// Every installed skill puts its name and description into the context of every
// API call. Skills you never use still cost those tokens. Claude Code's
// `skillOverrides` setting can list a skill by name only (it still works when you
// ask for it) instead of name + description.
//
// Usage:
//   node audit/unused-skills.js [--days 30] [--keep skill-a,skill-b] [--dir ~/.claude/projects]
//
// Prints each skill with its use count and description size, then a
// `skillOverrides` block for the unused ones that you can paste into
// ~/.claude/settings.json. Skills in --keep are never suggested (use it for
// safety skills you want described even if they rarely fire).

const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : d; };
const root = opt('dir', path.join(os.homedir(), '.claude', 'projects'));
const days = Number(opt('days', 30));
const keep = new Set((opt('keep', '') || '').split(',').filter(Boolean));
const since = new Date(Date.now() - days * 864e5);

function walk(d, out = []) {
  let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) { const p = path.join(d, x.name); if (x.isDirectory()) walk(p, out); else if (x.name.endsWith('.jsonl')) out.push(p); }
  return out;
}

const uses = {};
const descChars = {};
let latestListing = { ts: 0, names: [], content: '' };
let sessions = 0;
// Description size per skill ("- name: description" lines). Keeps the largest
// seen, so a skill you already trimmed still shows what it used to cost.
function readDescriptions(names, content) {
  const lines = content.split('\n');
  for (const n of names) {
    const line = lines.find(l => l.startsWith('- ' + n + ':'));
    const len = line ? line.slice(n.length + 3).trim().length : 0;
    descChars[n] = Math.max(descChars[n] || 0, len);
  }
}
const bump = n =>{ if (n) uses[n] = (uses[n] || 0) + 1; };

for (const f of walk(root)) {
  if (fs.statSync(f).mtime < since) continue;
  sessions++;
  for (const ln of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!ln) continue;
    let r; try { r = JSON.parse(ln); } catch { continue; }
    const ts = r.timestamp ? Date.parse(r.timestamp) : 0;
    if (r.type === 'attachment' && r.attachment && r.attachment.type === 'skill_listing' && Array.isArray(r.attachment.names)) {
      if (ts >= latestListing.ts) latestListing = { ts, names: r.attachment.names, content: r.attachment.content || '' };
      readDescriptions(r.attachment.names, r.attachment.content || '');
    }
    if (r.type === 'assistant' && r.message && Array.isArray(r.message.content))
      for (const b of r.message.content) if (b.type === 'tool_use' && b.name === 'Skill' && b.input) bump(b.input.skill);
    if (r.type === 'user' && r.message) {
      const c = typeof r.message.content === 'string' ? r.message.content : JSON.stringify(r.message.content);
      const m = c.match(/<command-name>\/?([^<\s]+)<\/command-name>/);
      if (m) bump(m[1]);
    }
  }
}

if (!latestListing.names.length) { console.error('No skill listing found in the logs for the last', days, 'days.'); process.exit(1); }


const rows = latestListing.names.map(n => ({ n, uses: uses[n] || 0, desc: descChars[n] || 0 })).sort((a, b) => a.uses - b.uses || b.desc - a.desc);
console.log(`Skills in your listing: ${rows.length}. Sessions scanned: ${sessions} (last ${days} days).\n`);
console.log('uses  desc chars  skill');
for (const r of rows) console.log(String(r.uses).padStart(4), String(r.desc).padStart(11), ' ', r.n, keep.has(r.n) ? '(kept)' : '');

const cut = rows.filter(r => r.uses === 0 && !keep.has(r.n) && r.desc > 0);
const chars = cut.reduce((a, r) => a + r.desc, 0);
console.log(`\n${cut.length} unused skills carry ${chars} chars of description (~${Math.round(chars / 3.8 / 100) / 10}K tokens) on every API call.`);
console.log('Paste into ~/.claude/settings.json to list them by name only:\n');
console.log(JSON.stringify({ skillOverrides: Object.fromEntries(cut.map(r => [r.n, 'name-only'])) }, null, 2));
