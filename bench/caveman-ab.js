#!/usr/bin/env node
// Caveman A/B benchmark for Claude Code.
//
// Runs the same prompts twice through `claude -p`:
//   arm "normal"  - Claude Code's default system prompt, nothing added
//   arm "caveman" - the same, plus the caveman rules appended to the system prompt
// The rules are the only thing that changes between arms.
//
// It records output tokens (what you pay for), split into thinking tokens and
// visible answer tokens, because caveman only shortens the visible answer.
//
// Usage:
//   node bench/caveman-ab.js --rules <path to caveman skills/caveman/SKILL.md>
//        [--prompts bench/prompts.json] [--reps 2] [--model claude-opus-5-5]
//        [--effort xhigh] [--out bench/results/run.jsonl]
//   node bench/caveman-ab.js --summary bench/results/run.jsonl
//
// Resumable: rows already in --out are skipped, so you can stop and re-run.
// Runs use --no-session-persistence, so they do not land in your transcripts.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function readRows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function stripFrontmatter(md) {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return (m ? md.slice(m[0].length) : md).trim();
}

const median = a => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const pct = (a, b) => (b - a) / a * 100;
const sum = a => a.reduce((x, y) => x + y, 0);

function summarize(rows) {
  const ids = [...new Set(rows.map(r => r.id))];
  const meta = rows[0] || {};
  const out = [];
  out.push(`Model ${meta.model}, effort ${meta.effort}, ${rows.length} runs, ${ids.length} prompts.`);
  out.push('');
  out.push('| prompt | normal visible | caveman visible | change | normal thinking | caveman thinking |');
  out.push('|---|---:|---:|---:|---:|---:|');
  const per = [];
  for (const id of ids) {
    const g = arm => rows.filter(r => r.id === id && r.arm === arm);
    const nV = median(g('normal').map(r => r.visible)), cV = median(g('caveman').map(r => r.visible));
    const nT = median(g('normal').map(r => r.thinking)), cT = median(g('caveman').map(r => r.thinking));
    per.push(pct(nV, cV));
    out.push(`| ${id} | ${nV} | ${cV} | ${pct(nV, cV).toFixed(0)}% | ${nT} | ${cT} |`);
  }
  const arm = a => rows.filter(r => r.arm === a);
  const tot = (a, k) => sum(arm(a).map(r => r[k]));
  out.push('');
  out.push(`Visible answer tokens, all runs: normal ${tot('normal', 'visible')} -> caveman ${tot('caveman', 'visible')} (${pct(tot('normal', 'visible'), tot('caveman', 'visible')).toFixed(1)}%)`);
  out.push(`Thinking tokens, all runs:       normal ${tot('normal', 'thinking')} -> caveman ${tot('caveman', 'thinking')}`);
  out.push(`All output tokens, all runs:     normal ${tot('normal', 'output')} -> caveman ${tot('caveman', 'output')} (${pct(tot('normal', 'output'), tot('caveman', 'output')).toFixed(1)}%)`);
  out.push(`Per-prompt visible change: median ${median(per).toFixed(0)}%, range ${Math.min(...per).toFixed(0)}% to ${Math.max(...per).toFixed(0)}%, ${per.filter(x => x < 0).length} of ${per.length} prompts shorter`);
  out.push(`Answer chars, all runs:          normal ${tot('normal', 'chars')} -> caveman ${tot('caveman', 'chars')}`);
  return out.join('\n');
}

if (arg('summary')) {
  console.log(summarize(readRows(arg('summary'))));
  process.exit(0);
}

const rulesPath = arg('rules');
if (!rulesPath || !fs.existsSync(rulesPath)) {
  console.error('Pass --rules <path to caveman skills/caveman/SKILL.md>. Get caveman at https://github.com/JuliusBrussee/caveman');
  process.exit(2);
}
const rules = stripFrontmatter(fs.readFileSync(rulesPath, 'utf8'));
if (rules.length < 200) { console.error('Rules file looks empty after stripping frontmatter:', rules.length, 'chars'); process.exit(2); }

const prompts = JSON.parse(fs.readFileSync(arg('prompts', path.join(__dirname, 'prompts.json')), 'utf8')).prompts;
const reps = Number(arg('reps', 2));
const model = arg('model', 'claude-opus-5-5');
const effort = arg('effort', 'xhigh');
const outFile = arg('out', path.join(__dirname, 'results', `caveman-ab-${new Date().toISOString().slice(0, 10)}.jsonl`));
fs.mkdirSync(path.dirname(outFile), { recursive: true });

// Run from an empty folder so no project CLAUDE.md leaks into either arm.
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-ab-'));
const rulesFile = path.join(cwd, '..', path.basename(cwd) + '-rules.md');
fs.writeFileSync(rulesFile, rules);

const done = new Set(readRows(outFile).map(r => `${r.id}|${r.arm}|${r.rep}`));
const plan = [];
for (let rep = 0; rep < reps; rep++)
  for (const p of prompts) {
    // Alternate which arm goes first so time-of-day drift hits both arms equally.
    const order = (rep + prompts.indexOf(p)) % 2 ? ['caveman', 'normal'] : ['normal', 'caveman'];
    for (const a of order) plan.push({ p, arm: a, rep });
  }

let n = 0;
for (const { p, arm, rep } of plan) {
  n++;
  if (done.has(`${p.id}|${arm}|${rep}`)) continue;
  const args = ['-p', '--output-format', 'json', '--model', model, '--effort', effort,
    '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--setting-sources', 'project'];
  if (arm === 'caveman') args.push('--append-system-prompt-file', rulesFile);
  const t0 = Date.now();
  const r = spawnSync('claude', args, { cwd, input: p.prompt, encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20 });
  let j;
  try { j = JSON.parse(r.stdout); } catch { console.error(`[${n}/${plan.length}] ${p.id} ${arm}: bad output`, (r.stderr || '').slice(0, 300)); continue; }
  if (j.is_error) { console.error(`[${n}/${plan.length}] ${p.id} ${arm}: error`, j.result); continue; }
  const u = j.usage, thinking = (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0;
  const row = {
    id: p.id, category: p.category, arm, rep, model, effort,
    output: u.output_tokens, thinking, visible: u.output_tokens - thinking,
    chars: (j.result || '').length, context: u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
    seconds: (Date.now() - t0) / 1000, ts: new Date().toISOString(), answer: j.result
  };
  fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
  console.log(`[${n}/${plan.length}] ${p.id.padEnd(22)} ${arm.padEnd(8)} visible ${String(row.visible).padStart(5)} thinking ${String(thinking).padStart(5)} ${row.seconds.toFixed(1)}s`);
}

fs.rmSync(rulesFile, { force: true });
fs.rmSync(cwd, { recursive: true, force: true });
console.log('\n' + summarize(readRows(outFile)));
