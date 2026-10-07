/**
 * aggregateRuns.mjs — Aggregate multiple independent paperBench runs.
 * For each benchmark and each statistic, reports the MEDIAN across runs
 * (robust to whole-run interference on shared/virtualized hosts).
 * Also reports inter-run variability of p50 (max/min).
 *
 * Usage: node aggregateRuns.mjs out.json run1.json run2.json ...
 */
import fs from 'node:fs'

const [out, ...files] = process.argv.slice(2)
const runs = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')))

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

const keys = Object.keys(runs[0].results)
const stats = ['meanMs', 'sdMs', 'ci95Ms', 'p50Ms', 'p90Ms', 'p95Ms', 'p99Ms', 'minMs', 'maxMs', 'opsPerSec', 'outlierPct', 'trimmedMeanMs']
const agg = {}
for (const k of keys) {
  const entries = runs.map(r => r.results[k]).filter(Boolean)
  if (entries.length !== runs.length) { console.error(`skip ${k}: missing in some runs`); continue }
  const a = { label: entries[0].label, n: entries[0].n, runs: entries.length }
  for (const s of stats) a[s] = median(entries.map(e => e[s]))
  const p50s = entries.map(e => e.p50Ms)
  a.p50RunMin = Math.min(...p50s)
  a.p50RunMax = Math.max(...p50s)
  a.p50RunSpreadPct = ((a.p50RunMax - a.p50RunMin) / a.p50Ms) * 100
  a.outlierCount = Math.round(a.outlierPct / 100 * a.n)
  agg[k] = a
}

const f3 = v => v.toFixed(3)
const f1 = v => v.toFixed(1)
function table(title, filter) {
  console.log(`\n## ${title}\n`)
  console.log('| key | N | mean | σ | 95%CI | p50 | p95 | outlier% | ops/sec(mean) | p50 run-spread% |')
  console.log('|---|---|---|---|---|---|---|---|---|---|')
  for (const k of keys.filter(filter)) {
    const a = agg[k]; if (!a) continue
    console.log(`| ${k} | ${a.n} | ${f3(a.meanMs)} | ${f3(a.sdMs)} | ${f3(a.ci95Ms)} | ${f3(a.p50Ms)} | ${f3(a.p95Ms)} | ${f1(a.outlierPct)} | ${Math.round(1000/a.meanMs).toLocaleString()} | ${f1(a.p50RunSpreadPct)} |`)
  }
}

table('A. sign/verify', k => /withLib|noLib|jose/.test(k))
table('B. Ed25519 unified', k => k.startsWith('unified-'))
table('C. selective disclosure', k => k.startsWith('seldisc-'))
table('D. scaling', k => k.startsWith('scaling-'))
table('E. complex URDNA2015', k => k.startsWith('complex-'))
table('F. serialization/breakdown', k => k.startsWith('serial-') || k.startsWith('breakdown-'))

const result = { env: runs[0].env, runsAggregated: runs.length, sizes: runs[0].sizes, complexMeta: runs[0].complexMeta, results: agg }
fs.writeFileSync(out, JSON.stringify(result, null, 2))
console.log(`\nSaved: ${out}`)
