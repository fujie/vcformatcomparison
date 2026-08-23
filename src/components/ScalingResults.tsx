import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts'
import type { ScalingBenchResults, ScalingResult } from '../benchmarks/scalingBenchmarks'

interface Props {
  results: ScalingBenchResults | null
  running: boolean
  progress: string
  onRun: () => void
}

const FORMAT_COLORS: Record<string, string> = {
  'SD-JWT VC':       '#60a5fa',
  'JSON-LD VC':      '#f59e0b',
  'JSON-LD VC (JCS)':'#a78bfa',
  'mdoc':            '#34d399',
}

const s: Record<string, React.CSSProperties> = {
  wrap:     { display: 'flex', flexDirection: 'column', gap: 32 },
  card:     { background: '#1e293b', borderRadius: 12, padding: 24, border: '1px solid #334155' },
  title:    { fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 },
  sub:      { fontSize: 12, color: '#64748b', marginBottom: 20 },
  table:    { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th:       { padding: '8px 10px', textAlign: 'left', color: '#64748b', borderBottom: '1px solid #334155', fontWeight: 600, whiteSpace: 'nowrap' },
  td:       { padding: '7px 10px', color: '#cbd5e1', borderBottom: '1px solid #1e293b' },
  numTd:    { padding: '7px 10px', color: '#e2e8f0', borderBottom: '1px solid #1e293b', fontFamily: 'monospace', textAlign: 'right' as const },
  badge:    { display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 },
  runBtn:   { padding: '10px 22px', borderRadius: 8, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  empty:    { textAlign: 'center' as const, padding: 60, color: '#475569', fontSize: 14 },
  row:      { display: 'flex', gap: 24, flexWrap: 'wrap' as const },
  halfCard: { flex: '1 1 420px', background: '#1e293b', borderRadius: 12, padding: 24, border: '1px solid #334155' },
}

function fmt(n: number, dec = 3) { return n.toFixed(dec) }

// ── 1. Attribute Scaling ─────────────────────────────────────────
function AttrScalingSection({ data }: { data: ScalingResult[] }) {
  const formats: Array<'SD-JWT VC' | 'JSON-LD VC' | 'JSON-LD VC (JCS)' | 'mdoc'> =
    ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc']
  const attrCounts = [...new Set(data.map(r => r.attrCount!))].sort((a, b) => a - b)

  const chartData = attrCounts.map(n => {
    const row: Record<string, number | string> = { attrs: `${n} attrs` }
    for (const fmt of formats) {
      const r = data.find(d => d.attrCount === n && d.format === fmt)
      if (r) row[fmt] = r.avgMs
    }
    return row
  })

  return (
    <div style={s.card}>
      <div style={s.title}>1. Attribute-count scaling</div>
      <div style={s.sub}>Serialization speed at 5 / 20 / 100 / 500 attributes — this is where the practical differences between formats show up</div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="attrs" tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="ms" width={60} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
            labelStyle={{ color: '#e2e8f0' }}
            formatter={(v: number) => [`${v.toFixed(4)} ms`, '']}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
          {formats.map(f => (
            <Line key={f} type="monotone" dataKey={f} stroke={FORMAT_COLORS[f]}
              strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <table style={{ ...s.table, marginTop: 20 }}>
        <thead>
          <tr>
            <th style={s.th}>Format</th>
            {attrCounts.map(n => (
              <th key={n} style={{ ...s.th, textAlign: 'right' }}>{n} attrs avg(ms)</th>
            ))}
            {attrCounts.map(n => (
              <th key={`sz-${n}`} style={{ ...s.th, textAlign: 'right' }}>{n} attrs size(B)</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {formats.map(f => (
            <tr key={f}>
              <td style={{ ...s.td, color: FORMAT_COLORS[f], fontWeight: 600 }}>{f}</td>
              {attrCounts.map(n => {
                const r = data.find(d => d.attrCount === n && d.format === f)
                return <td key={n} style={s.numTd}>{r ? fmt(r.avgMs, 4) : '—'}</td>
              })}
              {attrCounts.map(n => {
                const r = data.find(d => d.attrCount === n && d.format === f)
                return <td key={`sz-${n}`} style={s.numTd}>{r?.payloadSizeBytes ?? '—'}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 2. Context Loader ────────────────────────────────────────────
function ContextLoaderSection({ data }: { data: ScalingResult[] }) {
  const staticR  = data.find(r => r.condition === 'static')
  const permissR = data.find(r => r.condition === 'permissive')

  const chartData = [
    { name: 'Static loader', avgMs: staticR?.avgMs ?? 0, p95: staticR?.p95Ms ?? 0 },
    { name: 'Remote loader', avgMs: permissR?.avgMs ?? 0, p95: permissR?.p95Ms ?? 0 },
  ]

  const overhead = staticR && permissR ? permissR.avgMs - staticR.avgMs : null

  return (
    <div style={s.card}>
      <div style={s.title}>2. JSON-LD remote context: with vs. without</div>
      <div style={s.sub}>
        Static loader (SSRF-safe, fast) vs. remote loader (network latency + SSRF attack surface)
        {overhead !== null && (
          <span style={{ marginLeft: 12, color: '#f59e0b' }}>
            Overhead: +{fmt(overhead, 1)} ms/call
          </span>
        )}
      </div>

      <div style={s.row}>
        <div style={{ flex: '1 1 300px' }}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="ms" width={60} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v: number) => [`${v.toFixed(2)} ms`, '']}
              />
              <Bar dataKey="avgMs" name="mean(ms)" radius={[4, 4, 0, 0]}>
                <Cell fill="#60a5fa" />
                <Cell fill="#ef4444" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <table style={{ ...s.table, flex: '1 1 280px', alignSelf: 'flex-start' }}>
          <thead>
            <tr>
              <th style={s.th}>Loader</th>
              <th style={{ ...s.th, textAlign: 'right' }}>avg(ms)</th>
              <th style={{ ...s.th, textAlign: 'right' }}>p95(ms)</th>
              <th style={{ ...s.th, textAlign: 'right' }}>σ(ms)</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Static loader', r: staticR, color: '#60a5fa' },
              { label: 'Remote loader', r: permissR, color: '#ef4444' },
            ].map(({ label, r, color }) => (
              <tr key={label}>
                <td style={{ ...s.td, color }}>{label}</td>
                <td style={s.numTd}>{r ? fmt(r.avgMs, 2) : '—'}</td>
                <td style={s.numTd}>{r ? fmt(r.p95Ms, 2) : '—'}</td>
                <td style={s.numTd}>{r ? fmt(r.stdDevMs, 2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, padding: '10px 14px', background: '#0f172a', borderRadius: 8, border: '1px solid #ef444440', fontSize: 12, color: '#fca5a5' }}>
        ⚠ With the remote loader an attacker can embed a URL under their control in a credential and probe the internal network (SSRF).
        The static loader blocks unknown URLs immediately and removes this risk.
      </div>
    </div>
  )
}

// ── 3. URDNA2015 Call Limit ──────────────────────────────────────
function CallLimitSection({ data }: { data: ScalingResult[] }) {
  const nodeCounts = [...new Set(data.map(r => r.label))].filter((_, i, a) => a.indexOf(_) === i)

  const chartData = nodeCounts.map(label => {
    const without = data.find(r => r.label === label && r.condition === 'without')
    const with_   = data.find(r => r.label === label && r.condition === 'with')
    return {
      label,
      'No timeout': without?.avgMs ?? 0,
      'With timeout': with_?.avgMs ?? 0,
      withoutTimedOut: without?.timedOut,
      withTimedOut:    with_?.timedOut,
    }
  })

  return (
    <div style={s.card}>
      <div style={s.title}>3. URDNA2015 call limit: with vs. without</div>
      <div style={s.sub}>DoS mitigation on cyclic blank node graphs — canonicalization degrades exponentially with node count and a timeout protects against it</div>

      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="ms" width={65} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
            formatter={(v: number) => [`${v.toFixed(1)} ms`, '']}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
          <Bar dataKey="No timeout" fill="#ef4444" radius={[3, 3, 0, 0]} />
          <Bar dataKey="With timeout" fill="#34d399" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <table style={{ ...s.table, marginTop: 20 }}>
        <thead>
          <tr>
            <th style={s.th}>Graph</th>
            <th style={{ ...s.th, textAlign: 'right' }}>No timeout (ms)</th>
            <th style={{ ...s.th, textAlign: 'center' }}>Status</th>
            <th style={{ ...s.th, textAlign: 'right' }}>With timeout (ms)</th>
            <th style={{ ...s.th, textAlign: 'center' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {nodeCounts.map(label => {
            const without = data.find(r => r.label === label && r.condition === 'without')
            const with_   = data.find(r => r.label === label && r.condition === 'with')
            return (
              <tr key={label}>
                <td style={s.td}>{label}</td>
                <td style={s.numTd}>{without ? fmt(without.avgMs, 1) : '—'}</td>
                <td style={{ ...s.td, textAlign: 'center' }}>
                  {without?.timedOut
                    ? <span style={{ ...s.badge, background: '#7f1d1d', color: '#fca5a5' }}>Timed out</span>
                    : <span style={{ ...s.badge, background: '#14532d', color: '#86efac' }}>Completed</span>}
                </td>
                <td style={s.numTd}>{with_ ? fmt(with_.avgMs, 1) : '—'}</td>
                <td style={{ ...s.td, textAlign: 'center' }}>
                  {with_?.timedOut
                    ? <span style={{ ...s.badge, background: '#78350f', color: '#fde68a' }}>Protected</span>
                    : <span style={{ ...s.badge, background: '#14532d', color: '#86efac' }}>Completed</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── 4. Selective Disclosure ──────────────────────────────────────
function SelectiveDiscSection({ data }: { data: ScalingResult[] }) {
  const counts = [...new Set(data.map(r => r.disclosedCount!))].sort((a, b) => a - b)
  const fmts = ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc'] as const
  const chartData = counts.map(n => {
    const row: Record<string, number | string> = { n: `${n} attrs` }
    for (const f of fmts) {
      const r = data.find(r => r.format === f && r.disclosedCount === n)
      if (r) row[f] = r.avgMs
    }
    return row
  })

  return (
    <div style={s.card}>
      <div style={s.title}>4. Selective disclosure performance</div>
      <div style={s.sub}>Presentation generation latency by number of disclosed attributes (N of 20 attributes disclosed)</div>

      <div style={s.row}>
        <div style={{ flex: '1 1 320px' }}>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="n" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="ms" width={65} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v: number) => [`${v.toFixed(4)} ms`, '']}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              {fmts.map(f => (
                <Line key={f} type="monotone" dataKey={f} stroke={FORMAT_COLORS[f]} strokeWidth={2} dot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <table style={{ ...s.table, flex: '1 1 320px', alignSelf: 'flex-start' }}>
          <thead>
            <tr>
              <th style={s.th}>Disclosed</th>
              {fmts.map(f => (
                <th key={f} style={{ ...s.th, textAlign: 'right', color: FORMAT_COLORS[f] }}>
                  {f === 'JSON-LD VC (JCS)' ? 'JCS (ms)' : f === 'JSON-LD VC' ? 'JSON-LD (ms)' : `${f.split(' ')[0]} (ms)`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {counts.map(n => (
              <tr key={n}>
                <td style={s.td}>{n} attrs</td>
                {fmts.map(f => {
                  const r = data.find(r => r.format === f && r.disclosedCount === n)
                  return <td key={f} style={{ ...s.numTd, color: FORMAT_COLORS[f] }}>{r ? fmt(r.avgMs, 4) : '—'}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 5. Ed25519 Unified ───────────────────────────────────────────
function UnifiedEd25519Section({ data }: { data: ScalingResult[] }) {
  const signData   = data.filter(r => r.condition === 'sign')
  const verifyData = data.filter(r => r.condition === 'verify')

  const barData = [
    { name: 'sign',   ...Object.fromEntries(signData.map(r => [r.format, r.avgMs])) },
    { name: 'verify', ...Object.fromEntries(verifyData.map(r => [r.format, r.avgMs])) },
  ]

  const formats = ['SD-JWT VC', 'JSON-LD VC', 'mdoc'] as const

  return (
    <div style={s.card}>
      <div style={s.title}>5. Ed25519-unified benchmark</div>
      <div style={s.sub}>All formats measured with Ed25519 — isolates the pure serialization difference (mdoc normally uses ECDSA P-256)</div>

      <div style={s.row}>
        <div style={{ flex: '1 1 360px' }}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="ms" width={65} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v: number) => [`${v.toFixed(3)} ms`, '']}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              {formats.map(f => (
                <Bar key={f} dataKey={f} fill={FORMAT_COLORS[f]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <table style={{ ...s.table, flex: '1 1 260px', alignSelf: 'flex-start' }}>
          <thead>
            <tr>
              <th style={s.th}>Format</th>
              <th style={{ ...s.th, textAlign: 'right' }}>sign avg(ms)</th>
              <th style={{ ...s.th, textAlign: 'right' }}>verify avg(ms)</th>
              <th style={{ ...s.th, textAlign: 'right' }}>sign p95(ms)</th>
            </tr>
          </thead>
          <tbody>
            {formats.map(f => {
              const sg = signData.find(r => r.format === f)
              const vr = verifyData.find(r => r.format === f)
              return (
                <tr key={f}>
                  <td style={{ ...s.td, color: FORMAT_COLORS[f], fontWeight: 600 }}>{f}</td>
                  <td style={s.numTd}>{sg ? fmt(sg.avgMs, 3) : '—'}</td>
                  <td style={s.numTd}>{vr ? fmt(vr.avgMs, 3) : '—'}</td>
                  <td style={s.numTd}>{sg ? fmt(sg.p95Ms, 3) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, padding: '10px 14px', background: '#0f172a', borderRadius: 8, border: '1px solid #60a5fa40', fontSize: 12, color: '#93c5fd' }}>
        JSON-LD VC includes the overhead of normalize (URDNA2015) + SHA-256 hashing.
        Excluding it, the serialization difference of mdoc (CBOR vs. JWT) can be compared directly.
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────
export function ScalingResults({ results, running, progress, onRun }: Props) {
  return (
    <div style={s.wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>Detailed analysis benchmarks</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Attribute scaling / context loader / DoS mitigation / selective disclosure / Ed25519-unified
          </div>
        </div>
        <button
          onClick={onRun}
          disabled={running}
          style={{ ...s.runBtn, ...(running ? { background: '#1e293b', color: '#475569', cursor: 'not-allowed' } : {}) }}
        >
          {running ? `⏳ Measuring... ${progress}` : results ? 'Run again' : 'Run detailed analysis'}
        </button>
      </div>

      {running && (
        <div style={{ padding: '14px 18px', background: '#1e293b', borderRadius: 10, border: '1px solid #334155', fontSize: 13, color: '#60a5fa' }}>
          ⏳ {progress || 'Preparing...'}
        </div>
      )}

      {!results && !running && (
        <div style={s.empty}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔬</div>
          <div>Press the "Run detailed analysis" button to start the five analyses</div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#334155' }}>
            Estimated time: about 30-60 s (includes 100 iterations of attribute scaling and the URDNA2015 measurements)
          </div>
        </div>
      )}

      {results && (
        <>
          <AttrScalingSection    data={results.attrScaling} />
          <ContextLoaderSection  data={results.contextLoader} />
          <CallLimitSection      data={results.callLimit} />
          <SelectiveDiscSection  data={results.selectiveDisc} />
          <UnifiedEd25519Section data={results.unifiedEd25519} />
        </>
      )}
    </div>
  )
}
