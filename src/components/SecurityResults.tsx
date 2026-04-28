import type { SecurityTest, Severity } from '../benchmarks/normalizationSecurity'
import type { FormatName } from '../benchmarks/signatureSpeed'

interface Props { results: SecurityTest[] }

const SEVERITY_CONFIG: Record<Severity, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: 'CRITICAL', color: '#fca5a5', bg: '#7f1d1d', border: '#dc2626' },
  high:     { label: 'HIGH',     color: '#fcd34d', bg: '#78350f', border: '#d97706' },
  medium:   { label: 'MEDIUM',   color: '#93c5fd', bg: '#1e3a5f', border: '#3b82f6' },
  low:      { label: 'LOW',      color: '#86efac', bg: '#14532d', border: '#22c55e' },
  none:     { label: 'NONE',     color: '#64748b', bg: '#1e293b', border: '#334155' },
}

const RESULT_CONFIG = {
  vulnerable:       { label: '脆弱',    icon: '✗', color: '#f87171' },
  mitigated:        { label: '緩和済み', icon: '✓', color: '#4ade80' },
  partial:          { label: '部分的',  icon: '△', color: '#fbbf24' },
  'not-applicable': { label: 'N/A',     icon: '—', color: '#64748b' },
}

const FORMAT_COLORS: Record<string, string> = {
  'SD-JWT VC': '#60a5fa',
  'JSON-LD VC': '#f59e0b',
  'mdoc': '#34d399',
  'Both': '#a78bfa',
}

const CATEGORY_LABELS: Record<string, string> = {
  DoS: 'DoS',
  Injection: 'インジェクション',
  SSRF: 'SSRF',
  AlgorithmConfusion: 'アルゴリズム混同',
  ContextHijack: 'コンテキストハイジャック',
  CborMalleability: 'CBORマリアビリティ',
}

export function SecurityResults({ results }: Props) {
  const vulnerableCount = results.filter((r) => r.result === 'vulnerable').length
  const mitigatedCount  = results.filter((r) => r.result === 'mitigated').length
  const partialCount    = results.filter((r) => r.result === 'partial').length

  const formats: FormatName[] = ['SD-JWT VC', 'JSON-LD VC', 'mdoc']
  const riskByFormat = Object.fromEntries(
    formats.map((f) => {
      const fmtResults = results.filter((r) => r.format === f)
      const risky = fmtResults.filter((r) => r.result === 'vulnerable' || r.result === 'partial').length
      return [f, { risky, total: fmtResults.length }]
    })
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Summary counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <div style={{ ...cardStyle, borderColor: '#dc2626' }}>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>脆弱</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: '#f87171' }}>{vulnerableCount}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>テスト項目</div>
        </div>
        <div style={{ ...cardStyle, borderColor: '#f59e0b' }}>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>部分的リスク</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: '#fbbf24' }}>{partialCount}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>テスト項目</div>
        </div>
        <div style={{ ...cardStyle, borderColor: '#22c55e' }}>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>緩和済み</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: '#4ade80' }}>{mitigatedCount}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>テスト項目</div>
        </div>
      </div>

      {/* Risk score per format */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>リスクスコア（低いほど安全）</h3>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {formats.map((f) => {
            const { risky, total } = riskByFormat[f] as { risky: number; total: number }
            const pct = total > 0 ? (risky / total) * 100 : 0
            return (
              <div key={f} style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: FORMAT_COLORS[f] }}>{f}</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: FORMAT_COLORS[f] }}>{risky}/{total}</span>
                </div>
                <div style={{ height: 10, background: '#0f172a', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: FORMAT_COLORS[f], borderRadius: 5, transition: 'width 0.5s' }} />
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>リスクあり / テスト合計</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Test cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {results.map((test) => {
          const sev = SEVERITY_CONFIG[test.severity]
          const res = RESULT_CONFIG[test.result]
          const fmtColor = FORMAT_COLORS[test.format]
          return (
            <div key={test.id} style={{ ...panelStyle, borderLeftWidth: 4, borderLeftColor: sev.border }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: sev.bg, color: sev.color, fontWeight: 700, border: `1px solid ${sev.border}` }}>{sev.label}</span>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: fmtColor + '20', color: fmtColor, border: `1px solid ${fmtColor}50` }}>{test.format}</span>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: '#0f172a', color: '#64748b', border: '1px solid #334155' }}>{CATEGORY_LABELS[test.category] ?? test.category}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 16, color: res.color }}>{res.icon}</span>
                  <span style={{ fontSize: 12, color: res.color, fontWeight: 600 }}>{res.label}</span>
                </div>
              </div>

              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginTop: 10 }}>{test.name}</h4>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 5, lineHeight: 1.65 }}>{test.description}</p>

              {test.timeMs !== undefined && test.normalTimeMs !== undefined && (
                <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                  <div style={{ background: '#0f172a', borderRadius: 8, padding: '7px 12px', flex: 1 }}>
                    <div style={{ fontSize: 9, color: '#64748b' }}>正常グラフ</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#4ade80' }}>{test.normalTimeMs.toFixed(1)} ms</div>
                  </div>
                  <div style={{ background: '#0f172a', borderRadius: 8, padding: '7px 12px', flex: 1 }}>
                    <div style={{ fontSize: 9, color: '#64748b' }}>ポイズングラフ</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#f87171' }}>{test.timeMs.toFixed(1)} ms</div>
                  </div>
                </div>
              )}

              <div style={{ marginTop: 8, padding: '7px 10px', background: '#0f172a', borderRadius: 8, fontSize: 11, color: '#94a3b8', lineHeight: 1.55 }}>
                <span style={{ color: '#64748b' }}>実測結果: </span>{test.details}
              </div>

              {test.cveReferences && test.cveReferences.length > 0 && (
                <div style={{ marginTop: 7, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {test.cveReferences.map((ref) => <span key={ref} style={tagStyle}>{ref}</span>)}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Summary matrix */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>セキュリティ比較マトリクス</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['攻撃カテゴリ', 'SD-JWT VC', 'JSON-LD VC', 'mdoc'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #334155' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
              const byFormat = (f: string) => results.find((r) => r.category === cat && r.format === f)
              return (
                <tr key={cat} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '7px 10px', color: '#94a3b8' }}>{label}</td>
                  {['SD-JWT VC', 'JSON-LD VC', 'mdoc'].map((f) => {
                    const t = byFormat(f)
                    return (
                      <td key={f} style={{ padding: '7px 10px' }}>
                        {t ? (
                          <span style={{ color: RESULT_CONFIG[t.result].color }}>
                            {RESULT_CONFIG[t.result].icon} {RESULT_CONFIG[t.result].label}
                          </span>
                        ) : <span style={{ color: '#334155' }}>—</span>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = { background: '#1e293b', borderRadius: 12, padding: '14px 18px', border: '1px solid #334155' }
const panelStyle: React.CSSProperties = { ...cardStyle, borderLeftWidth: 4 }
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#cbd5e1', marginBottom: 14 }
const tagStyle: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '2px 6px', fontSize: 10, color: '#64748b' }
