import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import type { SpeedResult, FormatName } from '../benchmarks/signatureSpeed'

interface Props { results: SpeedResult[] }

const COLORS: Record<FormatName, string> = {
  'SD-JWT VC': '#60a5fa',
  'JSON-LD VC': '#f59e0b',
  'mdoc': '#34d399',
}

const STEP_LABELS: Record<string, string> = {
  normalize: 'JSON-LD正規化', hash: 'SHA-256ハッシュ',
  sign: 'Ed25519署名', verify: 'Ed25519検証',
}

export function SpeedResults({ results }: Props) {
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        {results.map((r) => (
          <div key={`${r.format}-${r.operation}`} style={{ ...cardStyle, borderColor: COLORS[r.format] + '40' }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{r.format} / {r.operation}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: COLORS[r.format] }}>{r.opsPerSec.toFixed(1)}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>ops/sec</div>
            <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6 }}>平均 {r.avgMs.toFixed(2)} ms / op</div>
            <div style={{ fontSize: 11, color: '#475569' }}>{r.iterations} イテレーション</div>
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
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#e2e8f0' }} formatter={(v: number) => [`${v.toFixed(3)} ms`, '平均レイテンシ']} />
            <Bar dataKey="avgMs" radius={[4, 4, 0, 0]}>
              {avgData.map((e, i) => <Cell key={i} fill={COLORS[e.format as FormatName]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Throughput chart */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>スループット比較（ops/sec）— 高いほど優秀</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={avgData} margin={{ top: 8, right: 24, left: 0, bottom: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-20} textAnchor="end" />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#e2e8f0' }} formatter={(v: number) => [`${v.toFixed(1)} ops/sec`, 'スループット']} />
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
                  <div style={{ height: 4, background: '#334155', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: '#f59e0b', borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{pct}%</div>
                </div>
              )
            })}
          </div>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>※ 正規化 (URDNA2015) が支配的。SD-JWT/mdoc にはこのステップが存在しない。</p>
        </div>
      )}

      {/* Legend */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>フォーマット説明</h3>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {([
            { format: 'SD-JWT VC', alg: 'EdDSA (Ed25519)', serial: 'JWT コンパクト', norm: 'なし' },
            { format: 'JSON-LD VC', alg: 'Ed25519 + SHA-256', serial: 'JSON テキスト', norm: 'URDNA2015 (RDF)' },
            { format: 'mdoc', alg: 'ECDSA P-256 (ES256)', serial: 'CBOR バイナリ', norm: 'なし' },
          ] as const).map(({ format, alg, serial, norm }) => (
            <div key={format} style={{ ...cardStyle, flex: 1, minWidth: 200, borderColor: COLORS[format] + '50' }}>
              <div style={{ color: COLORS[format], fontWeight: 700, marginBottom: 8 }}>{format}</div>
              {[['署名アルゴリズム', alg], ['シリアライズ', serial], ['正規化', norm]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>
                  <span>{k}</span><span style={{ color: '#cbd5e1' }}>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Raw table */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>生データ</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>{['フォーマット', '操作', '反復数', '合計(ms)', '平均(ms)', 'ops/sec'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={`${r.format}-${r.operation}`} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ ...tdStyle, color: COLORS[r.format] }}>{r.format}</td>
                <td style={tdStyle}>{r.operation}</td>
                <td style={tdStyle}>{r.iterations}</td>
                <td style={tdStyle}>{r.totalMs.toFixed(1)}</td>
                <td style={tdStyle}>{r.avgMs.toFixed(3)}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.opsPerSec.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = { background: '#1e293b', borderRadius: 12, padding: '14px 18px', border: '1px solid #334155' }
const panelStyle: React.CSSProperties = { ...cardStyle }
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#cbd5e1', marginBottom: 14 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #334155' }
const tdStyle: React.CSSProperties = { padding: '8px 12px', color: '#cbd5e1' }
