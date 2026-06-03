import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts'
import type { NoLibResult } from '../benchmarks/noLibrary'
import type { Lang, FmtKey, Mode } from '../data/codeSnippets'
import { SNIPPETS, getLOCMatrix } from '../data/codeSnippets'

type SubView = 'benchmark' | 'language'

interface BenchmarkProps {
  onRun: () => void
  running: boolean
  results: NoLibResult[] | null
  progress: string
}

const FMT_COLORS: Record<string, string> = { 'SD-JWT VC': '#60a5fa', 'mdoc': '#34d399' }
const MODE_COLORS = { withLib: '#94a3b8', noLib: '#f472b6' }

function NoLibBenchmark({ onRun, running, results, progress }: BenchmarkProps) {
  if (!results && !running) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 48 }}>
      <div style={{ fontSize: 36 }}>🧪</div>
      <p style={{ color: '#64748b', fontSize: 14, textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
        Web Crypto API のみで実装した SD-JWT VC・mdoc の速度を、ライブラリあり版と比較します。<br/>
        JSON-LD VC はライブラリなしでの実装が非現実的（URDNA2015 ≈ 1200行）のため除外。
      </p>
      <button onClick={onRun} style={btnStyle}>ベンチマーク実行</button>
    </div>
  )

  if (running) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 48 }}>
      <div style={spinner} />
      <span style={{ color: '#60a5fa', fontSize: 14 }}>{progress}</span>
    </div>
  )

  if (!results) return null

  // Build chart data
  const formats: FmtKey[] = ['SD-JWT VC', 'mdoc']
  const ops: string[] = ['sign', 'verify']
  const chartData = formats.flatMap(fmt =>
    ops.map(op => {
      const w = results.find(r => r.format === fmt && r.mode === 'withLib' && r.operation === op)
      const n = results.find(r => r.format === fmt && r.mode === 'noLib'   && r.operation === op)
      return {
        label: `${fmt}\n(${op})`,
        shortLabel: `${fmt} / ${op}`,
        withLib: w ? parseFloat(w.opsPerSec.toFixed(1)) : 0,
        noLib:   n ? parseFloat(n.opsPerSec.toFixed(1)) : 0,
        fmt,
      }
    })
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {results.map(r => (
          <div key={`${r.format}-${r.mode}-${r.operation}`}
               style={{ ...cardStyle, borderColor: (r.mode === 'noLib' ? '#f472b6' : '#94a3b8') + '50' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: FMT_COLORS[r.format] + '20', color: FMT_COLORS[r.format] }}>{r.format}</span>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: r.mode === 'noLib' ? '#f472b620' : '#94a3b820', color: r.mode === 'noLib' ? '#f472b6' : '#94a3b8' }}>
                {r.mode === 'noLib' ? 'ライブラリなし' : 'ライブラリあり'}
              </span>
              <span style={{ fontSize: 10, color: '#475569' }}>{r.operation}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: r.mode === 'noLib' ? '#f472b6' : '#94a3b8' }}>{r.opsPerSec.toFixed(0)}</div>
            <div style={{ fontSize: 10, color: '#64748b' }}>ops/sec</div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>平均 {r.avgMs.toFixed(3)} ms</div>
          </div>
        ))}
      </div>

      {/* Bar chart: throughput */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>スループット比較: ライブラリあり vs ライブラリなし（ops/sec）</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 56 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="shortLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-20} textAnchor="end" />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#e2e8f0' }}
              formatter={(v: number, name: string) => [`${v.toFixed(0)} ops/sec`, name === 'withLib' ? 'ライブラリあり' : 'ライブラリなし']} />
            <Legend formatter={(v) => v === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'} wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
            <Bar dataKey="withLib" fill={MODE_COLORS.withLib} radius={[3, 3, 0, 0]} />
            <Bar dataKey="noLib"   fill={MODE_COLORS.noLib}   radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Insight */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>考察</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(['SD-JWT VC', 'mdoc'] as const).map(fmt => {
            const signW  = results.find(r => r.format === fmt && r.mode === 'withLib' && r.operation === 'sign')
            const signNL = results.find(r => r.format === fmt && r.mode === 'noLib'   && r.operation === 'sign')
            if (!signW || !signNL) return null
            const ratio = (signNL.opsPerSec / signW.opsPerSec)
            const faster = ratio >= 1
            return (
              <div key={fmt} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                <span style={{ color: FMT_COLORS[fmt], fontWeight: 600 }}>{fmt}</span>{' '}
                ライブラリなし署名は{faster ? 'ライブラリあり比' : 'ライブラリあり比'}{' '}
                <span style={{ color: faster ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                  {ratio.toFixed(2)}x {faster ? '高速' : '低速'}
                </span>
                。{fmt === 'SD-JWT VC'
                  ? 'どちらも Web Crypto ECDSA を呼ぶため差は抽象層のオーバーヘッドのみ。'
                  : 'cbor-x は内部最適化があるため差が生じる場合がある。'}
              </div>
            )
          })}
          <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
            <span style={{ color: '#f59e0b', fontWeight: 600 }}>JSON-LD VC</span>{' '}
            のライブラリなし実装は URDNA2015 アルゴリズム（ブランクノード同定・グラフ同型探索）の実装が必要で推定{' '}
            <span style={{ color: '#f87171', fontWeight: 700 }}>1200+ 行</span>
            。実運用での再実装は非推奨。
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <button onClick={onRun} style={{ ...btnStyle, fontSize: 12, padding: '6px 14px' }}>再実行</button>
      </div>
    </div>
  )
}

// ---- Language comparison view ----

function LanguageView() {
  const [lang, setLang]   = useState<Lang>('TypeScript')
  const [fmt, setFmt]     = useState<FmtKey>('SD-JWT VC')
  const [mode, setMode]   = useState<Mode>('withLib')
  const [showCode, setShowCode] = useState(false)

  const snippet = SNIPPETS.find(s => s.language === lang && s.format === fmt && s.mode === mode)
  const locMatrix = getLOCMatrix()

  const langs: Lang[]   = ['TypeScript', 'Go', 'Python']
  const fmts: FmtKey[]  = ['SD-JWT VC', 'JSON-LD VC', 'mdoc']
  const modes: { id: Mode; label: string }[] = [
    { id: 'withLib', label: 'ライブラリあり' },
    { id: 'noLib',   label: 'ライブラリなし' },
  ]

  const LANG_COLORS: Record<Lang, string>   = { TypeScript: '#60a5fa', Go: '#34d399', Python: '#f59e0b' }
  const FMT_COL: Record<FmtKey, string>    = { 'SD-JWT VC': '#60a5fa', 'JSON-LD VC': '#f59e0b', mdoc: '#34d399' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['TypeScript', 'Go', 'Python'] as Lang[]).map(l => (
          <button key={l} onClick={() => setLang(l)} style={{ ...filterBtn, borderColor: lang === l ? LANG_COLORS[l] : '#334155', color: lang === l ? LANG_COLORS[l] : '#64748b', background: lang === l ? LANG_COLORS[l] + '15' : '#1e293b' }}>{l}</button>
        ))}
        <div style={{ width: 1, height: 24, background: '#334155' }} />
        {fmts.map(f => (
          <button key={f} onClick={() => setFmt(f)} style={{ ...filterBtn, borderColor: fmt === f ? FMT_COL[f] : '#334155', color: fmt === f ? FMT_COL[f] : '#64748b', background: fmt === f ? FMT_COL[f] + '15' : '#1e293b' }}>{f}</button>
        ))}
        <div style={{ width: 1, height: 24, background: '#334155' }} />
        {modes.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} style={{ ...filterBtn, borderColor: mode === m.id ? '#a78bfa' : '#334155', color: mode === m.id ? '#a78bfa' : '#64748b', background: mode === m.id ? '#a78bfa15' : '#1e293b' }}>{m.label}</button>
        ))}
      </div>

      {/* Snippet details */}
      {snippet && (
        <div style={{ ...panelStyle, borderColor: LANG_COLORS[lang] + '40' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ color: LANG_COLORS[lang], fontSize: 16, fontWeight: 700 }}>
                {lang} — {fmt} — {mode === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'}
              </h3>
              {snippet.notes && <p style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>{snippet.notes}</p>}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {snippet.impractical ? (
                <div style={{ background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8, padding: '6px 12px', fontSize: 11, color: '#fca5a5' }}>
                  ⚠ 推定 {snippet.estimatedLoc?.toLocaleString()} 行 — 実装非推奨
                </div>
              ) : (
                <div style={{ background: '#0f172a', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#64748b' }}>LOC</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: LANG_COLORS[lang] }}>{snippet.loc}</div>
                </div>
              )}
              <div style={{ background: '#0f172a', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#64748b' }}>外部パッケージ</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: snippet.stdlibOnly ? '#4ade80' : '#f59e0b' }}>{snippet.dependencies.length}</div>
              </div>
            </div>
          </div>

          {snippet.dependencies.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              {snippet.dependencies.map(d => <span key={d} style={tagStyle}>{d}</span>)}
            </div>
          )}
          {snippet.stdlibOnly && (
            <div style={{ marginTop: 10, display: 'inline-block', padding: '3px 10px', background: '#14532d', borderRadius: 6, border: '1px solid #22c55e', fontSize: 11, color: '#86efac' }}>
              ✓ 標準ライブラリのみ
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <button onClick={() => setShowCode(s => !s)} style={{ ...filterBtn, color: '#60a5fa', borderColor: '#60a5fa50' }}>
              {showCode ? 'コードを非表示' : 'コードを表示'}
            </button>
          </div>
          {showCode && <pre style={codeStyle}>{snippet.code}</pre>}
        </div>
      )}

      {/* LOC matrix */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>LOC 比較マトリクス（ライブラリあり / ライブラリなし）</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 500 }}>
            <thead>
              <tr>
                <th style={thStyle}>フォーマット</th>
                {langs.map(l => (
                  <th key={l} style={{ ...thStyle, color: LANG_COLORS[l] }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fmts.map(f => (
                <tr key={f} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ ...tdStyle, color: FMT_COL[f], fontWeight: 600 }}>{f}</td>
                  {langs.map(l => {
                    const cell = locMatrix[f][l]
                    return (
                      <td key={l} style={tdStyle}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#4ade80', fontSize: 11 }}>✓ {cell.withLib}行</span>
                          <span style={{ color: '#475569' }}>|</span>
                          {cell.noLibImpractical
                            ? <span style={{ color: '#f87171', fontSize: 11 }}>✗ ~{cell.estimatedLoc?.toLocaleString()}</span>
                            : <span style={{ color: '#f472b6', fontSize: 11 }}>⚗ {cell.noLib}行</span>
                          }
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: '#475569', fontSize: 11, marginTop: 8 }}>✓ ライブラリあり　⚗ ライブラリなし（実装可能）　✗ ライブラリなし（推定行数・実装非推奨）</p>
        </div>
      </div>

      {/* All snippets grid */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>フォーマット別 外部パッケージ依存数</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          {fmts.map(f => (
            <div key={f} style={{ background: '#0f172a', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ color: FMT_COL[f], fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{f}</div>
              {langs.map(l => {
                const wl = SNIPPETS.find(s => s.language === l && s.format === f && s.mode === 'withLib')
                const nl = SNIPPETS.find(s => s.language === l && s.format === f && s.mode === 'noLib')
                return (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: LANG_COLORS[l] }}>{l}</span>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span style={{ fontSize: 11, color: '#64748b' }}>
                        あり: <span style={{ color: '#94a3b8' }}>{wl?.dependencies.join(', ') || 'なし'}</span>
                      </span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>
                        なし: <span style={{ color: nl?.stdlibOnly ? '#4ade80' : nl?.impractical ? '#f87171' : '#f472b6' }}>
                          {nl?.impractical ? '非推奨' : nl?.stdlibOnly ? '標準のみ' : nl?.dependencies.join(', ')}
                        </span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Main component ----------------------------------------

interface Props {
  benchmarkResults: NoLibResult[] | null
  benchmarkRunning: boolean
  benchmarkProgress: string
  onRunBenchmark: () => void
}

export function ImplComparison({ benchmarkResults, benchmarkRunning, benchmarkProgress, onRunBenchmark }: Props) {
  const [view, setView] = useState<SubView>('language')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Sub-view toggle */}
      <div style={{ display: 'flex', gap: 0, background: '#0f172a', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {([
          { id: 'language'  as SubView, label: '🌐 言語別コード比較' },
          { id: 'benchmark' as SubView, label: '🧪 TS: ライブラリなし vs あり' },
        ]).map(({ id, label }) => (
          <button key={id} onClick={() => setView(id)} style={{
            padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: view === id ? 600 : 400,
            background: view === id ? '#1e293b' : 'none',
            color: view === id ? '#e2e8f0' : '#64748b',
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
      </div>

      {view === 'benchmark' && (
        <NoLibBenchmark
          onRun={onRunBenchmark}
          running={benchmarkRunning}
          results={benchmarkResults}
          progress={benchmarkProgress}
        />
      )}
      {view === 'language' && <LanguageView />}
    </div>
  )
}

// ---- Styles ------------------------------------------------
const cardStyle: React.CSSProperties = { background: '#1e293b', borderRadius: 12, padding: '14px 18px', border: '1px solid #334155' }
const panelStyle: React.CSSProperties = { ...cardStyle }
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#cbd5e1', marginBottom: 14 }
const btnStyle: React.CSSProperties = { background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const filterBtn: React.CSSProperties = { padding: '5px 14px', borderRadius: 8, border: '1px solid', cursor: 'pointer', fontSize: 12, fontWeight: 500, transition: 'all 0.15s' }
const tagStyle: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '2px 7px', fontSize: 11, color: '#94a3b8' }
const codeStyle: React.CSSProperties = { background: '#0f172a', borderRadius: 8, padding: 14, fontSize: 10, color: '#a5f3fc', overflowX: 'auto', lineHeight: 1.6, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 12 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #334155' }
const tdStyle: React.CSSProperties = { padding: '8px 12px', color: '#cbd5e1' }
const spinner: React.CSSProperties = { width: 32, height: 32, borderRadius: '50%', border: '3px solid #334155', borderTopColor: '#a78bfa', animation: 'spin 0.8s linear infinite' }
