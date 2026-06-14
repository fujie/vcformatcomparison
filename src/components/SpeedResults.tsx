import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts'
import type { SpeedResult, FormatName } from '../benchmarks/signatureSpeed'
import type { BenchMode, BackendJobResult } from '../types/backendResult'
import { adaptBackendToSpeedResults } from '../types/backendResult'

interface Props {
  results: SpeedResult[] | null
  benchMode?: BenchMode
  backendResult?: BackendJobResult | null
}

const COLORS: Record<FormatName, string> = {
  'SD-JWT VC': '#60a5fa',
  'JSON-LD VC': '#f59e0b',
  'JSON-LD VC (JCS)': '#fb923c',
  'mdoc': '#34d399',
}
const LANG_COLORS = { 'Node.js': '#60a5fa', 'Python': '#34d399', 'Go': '#f97316' }

const STEP_LABELS: Record<string, string> = {
  normalize: 'JSON-LD正規化', hash: 'SHA-256ハッシュ',
  sign: 'Ed25519署名', verify: 'Ed25519検証',
}

// ── Backend speed panel ───────────────────────────────────────────────────────

function BackendSpeedPanel({ backendResult }: { backendResult: BackendJobResult }) {
  const [lib, setLib] = useState<'withLib' | 'noLib'>('withLib')
  const [view, setView] = useState<'format' | 'language'>('format')

  const node = backendResult.nodeResult
  const python = backendResult.pythonResult
  const go = backendResult.goResult

  const nodeData = adaptBackendToSpeedResults(node, lib)
  const pythonData = adaptBackendToSpeedResults(python, lib)
  const goData = adaptBackendToSpeedResults(go, lib)

  // Chart: format comparison (fixed language = Node.js)
  const formatChartData = nodeData.map(r => ({
    label: `${r.format} (${r.operation})`,
    format: r.format,
    opsPerSec: parseFloat(r.opsPerSec.toFixed(0)),
    avgMs: parseFloat(r.avgMs.toFixed(4)),
  }))

  // Chart: language comparison for each key
  const langKeys = ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc'] as FormatName[]
  const langChartData = langKeys.flatMap(fmt =>
    (['sign', 'verify'] as const).map(op => {
      const key = `${fmt}-${lib}-${op}`
      return {
        label: `${fmt.replace(' VC', '')} ${op}`,
        fmt, op,
        'Node.js': node?.results?.[key]?.opsPerSec ?? 0,
        'Python':  python?.results?.[key]?.opsPerSec ?? 0,
        'Go':      go?.results?.[key]?.opsPerSec ?? 0,
      }
    })
  ).filter(d => d['Node.js'] > 0 || d['Python'] > 0 || d['Go'] > 0)

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    background: active ? '#3b82f6' : '#1e293b', color: active ? '#fff' : '#64748b', marginRight: 6,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={tabBtn(lib === 'withLib')} onClick={() => setLib('withLib')}>ライブラリあり</button>
          <button style={tabBtn(lib === 'noLib')}   onClick={() => setLib('noLib')}>ライブラリなし</button>
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          <button style={tabBtn(view === 'format')}   onClick={() => setView('format')}>フォーマット比較</button>
          <button style={tabBtn(view === 'language')} onClick={() => setView('language')}>言語比較</button>
        </div>
        <span style={{ fontSize: 11, color: '#64748b' }}>
          {node?.runtimeInfo} &nbsp;|&nbsp; {python?.runtimeInfo} &nbsp;|&nbsp; {go?.runtimeInfo}
        </span>
      </div>

      {/* Summary cards — Node.js */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        {nodeData.map(r => {
          const key = `${r.format}-${lib}-${r.operation}`
          const e = node?.results?.[key]
          return (
            <div key={`${r.format}-${r.operation}`} style={{ ...cardStyle, borderColor: COLORS[r.format as FormatName] + '40' }}>
              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>{r.format} / {r.operation}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: COLORS[r.format as FormatName] }}>
                {r.opsPerSec.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
              </div>
              <div style={{ fontSize: 10, color: '#64748b' }}>ops/sec (Node.js)</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>{r.avgMs.toFixed(3)} ms / op</div>
              {e?.stdDevMs != null && (
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                  σ {e.stdDevMs.toFixed(3)} ms &nbsp;|&nbsp; 95%CI ±{e.ci95Ms?.toFixed(3)} ms
                </div>
              )}
              {e?.p50Ms != null && (
                <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                  p50 {e.p50Ms.toFixed(3)} / p95 {e.p95Ms?.toFixed(3)} ms
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Chart */}
      {view === 'format' && (
        <div style={panelStyle}>
          <h3 style={sectionTitle}>スループット比較 — Node.js ({lib}) (ops/sec)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={formatChartData} margin={{ top: 8, right: 24, left: 0, bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-20} textAnchor="end" />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v: number) => [v.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' ops/s', '']} />
              <Bar dataKey="opsPerSec" radius={[4, 4, 0, 0]}>
                {formatChartData.map((e, i) => <Cell key={i} fill={COLORS[e.format as FormatName]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {view === 'language' && (
        <div style={panelStyle}>
          <h3 style={sectionTitle}>言語別スループット比較 ({lib}) (ops/sec)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={langChartData} margin={{ top: 8, right: 24, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }}
                tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 12 }}
                formatter={(v: number) => [v.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' ops/s', '']} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              <Bar dataKey="Node.js" fill={LANG_COLORS['Node.js']} radius={[3,3,0,0]} />
              <Bar dataKey="Python"  fill={LANG_COLORS['Python']}  radius={[3,3,0,0]} />
              <Bar dataKey="Go"      fill={LANG_COLORS['Go']}      radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Summary table */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>3言語比較サマリー ({lib}) (ops/sec) — 統計分布 (Node.js)</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['フォーマット', '操作', 'Node.js', 'Python', 'Go', 'Go/Node 倍率', 'σ Node(ms)', '95%CI Node(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)'].map(h =>
                  <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {langChartData.map(row => {
                const ratio = row['Node.js'] > 0 ? (row['Go'] / row['Node.js']).toFixed(1) : '—'
                const key = `${row.fmt}-${lib}-${row.op}`
                const ne = node?.results?.[key]
                return (
                  <tr key={row.label} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ ...tdStyle, color: COLORS[row.fmt as FormatName] }}>{row.fmt}</td>
                    <td style={tdStyle}>{row.op}</td>
                    <td style={{ ...tdStyle, color: LANG_COLORS['Node.js'] }}>
                      {row['Node.js'] > 0 ? row['Node.js'].toLocaleString('ja-JP', { maximumFractionDigits: 0 }) : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: LANG_COLORS['Python'] }}>
                      {row['Python'] > 0 ? row['Python'].toLocaleString('ja-JP', { maximumFractionDigits: 0 }) : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: LANG_COLORS['Go'] }}>
                      {row['Go'] > 0 ? row['Go'].toLocaleString('ja-JP', { maximumFractionDigits: 0 }) : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: '#94a3b8' }}>
                      {ratio !== '—' ? `× ${ratio}` : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: '#94a3b8' }}>{ne?.stdDevMs?.toFixed(4) ?? '—'}</td>
                    <td style={{ ...tdStyle, color: '#94a3b8' }}>{ne?.ci95Ms != null ? `±${ne.ci95Ms.toFixed(4)}` : '—'}</td>
                    <td style={{ ...tdStyle, color: '#60a5fa' }}>{ne?.p50Ms?.toFixed(3) ?? '—'}</td>
                    <td style={{ ...tdStyle, color: '#f59e0b' }}>{ne?.p95Ms?.toFixed(3) ?? '—'}</td>
                    <td style={{ ...tdStyle, color: '#ef4444' }}>{ne?.p99Ms?.toFixed(3) ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function SpeedResults({ results, benchMode = 'frontend', backendResult }: Props) {
  // Backend mode: show backend speed panel
  if (benchMode === 'backend' && backendResult) {
    return <BackendSpeedPanel backendResult={backendResult} />
  }

  // Frontend mode: original display
  if (!results || results.length === 0) return null

  const avgData = results.map((r) => ({
    label: `${r.format} (${r.operation})`,
    avgMs: parseFloat(r.avgMs.toFixed(3)),
    opsPerSec: parseFloat(r.opsPerSec.toFixed(1)),
    format: r.format,
  }))

  const breakdownJsonLd = results.find((r) => r.format === 'JSON-LD VC' && r.operation === 'sign')?.breakdown

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        {results.map((r) => (
          <div key={`${r.format}-${r.operation}`} style={{ ...cardStyle, borderColor: COLORS[r.format] + '40' }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{r.format} / {r.operation}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: COLORS[r.format] }}>{r.opsPerSec.toFixed(1)}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>ops/sec</div>
            <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6 }}>平均 {r.avgMs.toFixed(3)} ms / op</div>
            {r.stdDevMs != null && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                σ {r.stdDevMs.toFixed(3)} ms &nbsp;|&nbsp; 95%CI ±{r.ci95Ms?.toFixed(3)} ms
              </div>
            )}
            {r.p50Ms != null && (
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                p50 {r.p50Ms.toFixed(3)} / p95 {r.p95Ms?.toFixed(3)} / p99 {r.p99Ms?.toFixed(3)} ms
              </div>
            )}
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{r.iterations} イテレーション</div>
          </div>
        ))}
      </div>

      {/* Latency chart */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>平均レイテンシ比較（ms / operation）</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={avgData} margin={{ top: 8, right: 24, left: 0, bottom: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-20} textAnchor="end" />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="ms" />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              formatter={(v: number) => [`${v.toFixed(3)} ms`, '平均レイテンシ']} />
            <Bar dataKey="avgMs" radius={[4, 4, 0, 0]}>
              {avgData.map((e, i) => <Cell key={i} fill={COLORS[e.format as FormatName]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Throughput chart */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>スループット比較（ops/sec）</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={avgData} margin={{ top: 8, right: 24, left: 0, bottom: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-20} textAnchor="end" />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              formatter={(v: number) => [`${v.toFixed(1)} ops/sec`, 'スループット']} />
            <Bar dataKey="opsPerSec" radius={[4, 4, 0, 0]}>
              {avgData.map((e, i) => <Cell key={i} fill={COLORS[e.format as FormatName]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* JSON-LD breakdown */}
      {breakdownJsonLd && (
        <div style={panelStyle}>
          <h3 style={sectionTitle}>JSON-LD VC 署名ステップ内訳（ms / operation）</h3>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
            {Object.entries(breakdownJsonLd).map(([step, ms]) => {
              const total = Object.values(breakdownJsonLd).reduce((a, b) => a + b, 0)
              const pct = ((ms / total) * 100).toFixed(0)
              return (
                <div key={step} style={{ ...cardStyle, flex: 1, minWidth: 130 }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{STEP_LABELS[step] ?? step}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b', margin: '4px 0' }}>{ms.toFixed(2)} ms</div>
                  <div style={{ height: 4, background: '#334155', borderRadius: 2 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: '#f59e0b', borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{pct}%</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Raw table */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>生データ（統計分布）</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['フォーマット', '操作', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)'].map(h =>
                <th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={`${r.format}-${r.operation}`} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ ...tdStyle, color: COLORS[r.format] }}>{r.format}</td>
                  <td style={tdStyle}>{r.operation}</td>
                  <td style={tdStyle}>{r.iterations}</td>
                  <td style={tdStyle}>{r.avgMs.toFixed(3)}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.opsPerSec.toFixed(1)}</td>
                  <td style={{ ...tdStyle, color: '#94a3b8' }}>{r.stdDevMs?.toFixed(4) ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#94a3b8' }}>±{r.ci95Ms?.toFixed(4) ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#60a5fa' }}>{r.p50Ms?.toFixed(3) ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#60a5fa' }}>{r.p90Ms?.toFixed(3) ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#f59e0b' }}>{r.p95Ms?.toFixed(3) ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#ef4444' }}>{r.p99Ms?.toFixed(3) ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#475569' }}>{r.minMs?.toFixed(3) ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#475569' }}>{r.maxMs?.toFixed(3) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = { background: '#1e293b', borderRadius: 12, padding: '14px 18px', border: '1px solid #334155' }
const panelStyle: React.CSSProperties = { ...cardStyle }
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#cbd5e1', marginBottom: 14 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #334155' }
const tdStyle: React.CSSProperties = { padding: '8px 12px', color: '#cbd5e1' }
