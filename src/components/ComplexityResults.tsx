import type { ComplexityMetric } from '../benchmarks/deserializationComplexity'
import type { FormatName } from '../benchmarks/signatureSpeed'

interface Props { results: ComplexityMetric[] }

const COLORS: Record<FormatName, string> = {
  'SD-JWT VC': '#60a5fa',
  'JSON-LD VC': '#f59e0b',
  'mdoc': '#34d399',
}

function MetricBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / Math.max(max, 0.001)) * 100, 100)
  return (
    <div style={{ height: 8, background: '#0f172a', borderRadius: 4, overflow: 'hidden', width: '100%' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.5s' }} />
    </div>
  )
}

const METRICS = [
  { key: 'linesOfCode',          label: 'コード行数 (LOC)',         unit: '行' },
  { key: 'asyncSteps',           label: '非同期ステップ数',          unit: 'ステップ' },
  { key: 'cyclomaticComplexity', label: '循環的複雑度',              unit: '' },
  { key: 'externalNetworkCalls', label: '外部ネットワーク呼び出し',   unit: '回' },
  { key: 'parseTimeMs',          label: 'パース時間 (50回平均)',      unit: 'ms' },
] as const

export function ComplexityResults({ results }: Props) {
  const maxMap = Object.fromEntries(
    METRICS.map(({ key }) => [key, Math.max(...results.map((r) => r[key] as number), 0.001)])
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Metric radar grid */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>デシリアライズ複雑性メトリクス比較</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          {METRICS.map(({ key, label, unit }) => (
            <div key={key}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>{label}</div>
              {results.map((r) => {
                const val = r[key] as number
                return (
                  <div key={r.format} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: COLORS[r.format] }}>{r.format}</span>
                      <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>
                        {unit === 'ms' ? val.toFixed(2) : val} {unit}
                      </span>
                    </div>
                    <MetricBar value={val} max={maxMap[key]} color={COLORS[r.format]} />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Per-format detail cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {results.map((r) => (
          <div key={r.format} style={{ ...panelStyle, borderColor: COLORS[r.format] + '40' }}>
            <h3 style={{ ...sectionTitle, color: COLORS[r.format] }}>{r.format}</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'コード行数', value: `${r.linesOfCode} 行` },
                { label: '非同期ステップ', value: `${r.asyncSteps} ステップ` },
                { label: '循環的複雑度', value: r.cyclomaticComplexity },
                { label: 'ネットワーク呼び出し', value: `${r.externalNetworkCalls} 回` },
                { label: 'パース時間(平均)', value: `${r.parseTimeMs.toFixed(2)} ms` },
                { label: '外部依存', value: `${r.externalDependencies.length} 個` },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: '#0f172a', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: COLORS[r.format], marginTop: 2 }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>デシリアライズステップ</div>
              {r.steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 7, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 18, height: 18, borderRadius: '50%', background: COLORS[r.format] + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: COLORS[r.format], fontWeight: 700 }}>{i + 1}</div>
                  <div>
                    <div style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{s.description}</div>
                    {s.risk && <div style={{ fontSize: 10, color: '#f87171', marginTop: 1 }}>⚠ {s.risk}</div>}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>外部依存</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {r.externalDependencies.map((d) => <span key={d} style={tagStyle}>{d}</span>)}
              </div>
            </div>

            {r.externalNetworkCalls > 0 && (
              <div style={{ padding: '8px 10px', background: '#7c2d12', borderRadius: 8, border: '1px solid #dc2626' }}>
                <div style={{ fontSize: 10, color: '#fca5a5' }}>
                  ⚠ {r.externalNetworkCalls} 回の外部URL取得:
                  {r.networkCallDescription.map((d, i) => <div key={i} style={{ marginTop: 3 }}>• {d}</div>)}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Code comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {results.map((r) => (
          <div key={r.format} style={panelStyle}>
            <h3 style={{ ...sectionTitle, color: COLORS[r.format] }}>{r.format} — 実装コード ({r.linesOfCode}行)</h3>
            <pre style={codeStyle}>{r.codeSnippet}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

const panelStyle: React.CSSProperties = { background: '#1e293b', borderRadius: 12, padding: '20px 22px', border: '1px solid #334155' }
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#cbd5e1', marginBottom: 14 }
const tagStyle: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '2px 7px', fontSize: 10, color: '#94a3b8' }
const codeStyle: React.CSSProperties = { background: '#0f172a', borderRadius: 8, padding: 14, fontSize: 10, color: '#a5f3fc', overflowX: 'auto', lineHeight: 1.6, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
