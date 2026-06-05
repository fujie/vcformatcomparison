import { useState, useCallback } from 'react'
import type { SpeedResult } from './benchmarks/signatureSpeed'
import type { ComplexityMetric } from './benchmarks/deserializationComplexity'
import type { SecurityTest } from './benchmarks/normalizationSecurity'
import type { NoLibResult, SerialBenchResult } from './benchmarks/noLibrary'
import { SpeedResults } from './components/SpeedResults'
import { ComplexityResults } from './components/ComplexityResults'
import { SecurityResults } from './components/SecurityResults'
import { ImplComparison } from './components/ImplComparison'
import { ReportView } from './components/ReportView'

type Tab = 'speed' | 'complexity' | 'security' | 'impl' | 'report'
type Status = 'idle' | 'running' | 'done' | 'error'

const TABS: { id: Tab; label: string; icon: string; desc: string }[] = [
  { id: 'speed',      icon: '⚡', label: '署名検証速度',       desc: 'sign/verify のops/sec & レイテンシ' },
  { id: 'complexity', icon: '📐', label: 'デシリアライズ複雑性', desc: 'LOC・非同期ステップ・循環的複雑度' },
  { id: 'security',   icon: '🔐', label: '正規化セキュリティ',   desc: 'DoS・SSRF・インジェクション定量評価' },
  { id: 'impl',       icon: '🔤', label: '実装比較',             desc: 'Go・Python・TS / ライブラリなし実装' },
  { id: 'report',     icon: '📋', label: '結果レポート',         desc: '一覧表示・JSON/CSV/Markdown エクスポート' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('speed')
  const [iterations, setIterations] = useState(50)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const [speedResults, setSpeedResults] = useState<SpeedResult[] | null>(null)
  const [complexityResults, setComplexityResults] = useState<ComplexityMetric[] | null>(null)
  const [securityResults, setSecurityResults] = useState<SecurityTest[] | null>(null)
  const [noLibResults, setNoLibResults] = useState<NoLibResult[] | null>(null)
  const [serialResults, setSerialResults] = useState<SerialBenchResult[] | null>(null)
  const [noLibRunning, setNoLibRunning] = useState(false)
  const [noLibProgress, setNoLibProgress] = useState('')

  const runBenchmarks = useCallback(async () => {
    setStatus('running')
    setError('')
    setProgress('ベンチマークを開始しています...')

    try {
      // Dynamically import to allow code-splitting and avoid top-level await issues
      const { runSpeedBenchmarks } = await import('./benchmarks/signatureSpeed')
      const { runComplexityAnalysis } = await import('./benchmarks/deserializationComplexity')
      const { runSecurityTests } = await import('./benchmarks/normalizationSecurity')

      setProgress('[1/3] 署名検証速度ベンチマーク実行中...')
      const speed = await runSpeedBenchmarks(iterations, setProgress)
      setSpeedResults(speed)

      setProgress('[2/3] デシリアライズ複雑性分析中...')
      const complexity = await runComplexityAnalysis(setProgress)
      setComplexityResults(complexity)

      setProgress('[3/3] セキュリティテスト実行中...')
      const security = await runSecurityTests(setProgress)
      setSecurityResults(security)

      setStatus('done')
      setProgress('すべてのテスト完了')
    } catch (e) {
      setStatus('error')
      setError((e as Error).message)
      console.error(e)
    }
  }, [iterations])

  const runNoLib = useCallback(async () => {
    setNoLibRunning(true)
    setNoLibProgress('準備中...')
    try {
      const { runNoLibBenchmarks, runSerialBenchmarks } = await import('./benchmarks/noLibrary')
      setNoLibProgress('署名速度ベンチマーク中...')
      const results = await runNoLibBenchmarks(iterations, setNoLibProgress)
      setNoLibResults(results)
      setNoLibProgress('シリアライズ速度ベンチマーク中...')
      const serial = await runSerialBenchmarks(200)
      setSerialResults(serial)
    } catch (e) {
      console.error(e)
      setNoLibProgress(`エラー: ${(e as Error).message}`)
    } finally {
      setNoLibRunning(false)
    }
  }, [iterations])

  return (
    <div style={appStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={headerInner}>
          <div>
            <h1 style={h1Style}>VC Format Comparison Tool</h1>
            <p style={subtitleStyle}>
              SD-JWT VC / JSON-LD VC (W3C VCDM 2.0) / mdoc (ISO 18013-5) — 定量的比較分析
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: '#64748b' }}>
              イテレーション数
              <select
                value={iterations}
                onChange={(e) => setIterations(Number(e.target.value))}
                style={selectStyle}
                disabled={status === 'running'}
              >
                {[20, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <button
              onClick={runBenchmarks}
              disabled={status === 'running'}
              style={{ ...btnStyle, ...(status === 'running' ? btnDisabledStyle : btnActiveStyle) }}
            >
              {status === 'running' ? '実行中...' : status === 'done' ? '再実行' : 'ベンチマーク実行'}
            </button>
          </div>
        </div>

        {/* Progress / status */}
        {status === 'running' && (
          <div style={progressBarWrap}>
            <div style={progressBar} />
            <span style={{ fontSize: 12, color: '#60a5fa', marginLeft: 12 }}>{progress}</span>
          </div>
        )}
        {status === 'error' && (
          <div style={{ padding: '8px 16px', background: '#7f1d1d', color: '#fca5a5', fontSize: 13, borderTop: '1px solid #dc2626' }}>
            エラー: {error}
          </div>
        )}
        {status === 'done' && (
          <div style={{ padding: '6px 16px', background: '#14532d', color: '#86efac', fontSize: 12, borderTop: '1px solid #22c55e' }}>
            ✓ {progress}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={tabBarStyle}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{ ...tabBtnStyle, ...(tab === t.id ? tabBtnActiveStyle : {}) }}
          >
            <span style={{ fontSize: 16 }}>{t.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: tab === t.id ? 600 : 400 }}>{t.label}</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{t.desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={contentStyle}>
        {/* 実装比較タブは常に表示（独立して動作） */}
        {tab === 'impl' && (
          <ImplComparison
            benchmarkResults={noLibResults}
            serialResults={serialResults}
            benchmarkRunning={noLibRunning}
            benchmarkProgress={noLibProgress}
            onRunBenchmark={runNoLib}
            speedResults={speedResults}
          />
        )}

        {/* 結果レポートタブは常に表示（データがなければ案内のみ） */}
        {tab === 'report' && (
          <ReportView
            speedResults={speedResults}
            complexityResults={complexityResults}
            securityResults={securityResults}
            noLibResults={noLibResults}
            serialResults={serialResults}
            iterations={iterations}
          />
        )}

        {tab !== 'impl' && tab !== 'report' && status === 'idle' && (
          <div style={emptyStyle}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔬</div>
            <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 8 }}>比較ベンチマークを実行してください</h2>
            <p style={{ color: '#64748b', fontSize: 14, maxWidth: 540, textAlign: 'center', lineHeight: 1.6 }}>
              「ベンチマーク実行」ボタンを押すと、ブラウザ内で3フォーマットの
              署名検証速度・デシリアライズ複雑性・正規化セキュリティを定量測定します。
              外部ネットワーク通信は行いません。
            </p>
            <div style={{ display: 'flex', gap: 14, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
              {[
                { color: '#60a5fa', label: 'SD-JWT VC',  spec: 'IETF RFC 9901',   serial: 'JWT (JSON)',      crypto: 'EdDSA / Ed25519',    norm: 'なし' },
                { color: '#f59e0b', label: 'JSON-LD VC', spec: 'W3C VCDM 2.0',    serial: 'JSON-LD (JSON)',  crypto: 'Ed25519 + SHA-256',   norm: 'URDNA2015 (RDF)' },
                { color: '#34d399', label: 'mdoc',        spec: 'ISO 18013-5',     serial: 'CBOR (バイナリ)', crypto: 'ECDSA P-256 (ES256)', norm: 'なし' },
              ].map(({ color, label, spec, serial, crypto, norm }) => (
                <div key={label} style={{ background: '#1e293b', borderRadius: 12, padding: '16px 20px', border: `1px solid ${color}40`, minWidth: 180, maxWidth: 220 }}>
                  <div style={{ color, fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{label}</div>
                  {[
                    ['規格',           spec],
                    ['シリアライズ',   serial],
                    ['暗号アルゴリズム', crypto],
                    ['正規化',         norm],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 10, color: '#475569', whiteSpace: 'nowrap' }}>{k}</span>
                      <span style={{ fontSize: 10, color: '#94a3b8', textAlign: 'right' }}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab !== 'impl' && tab !== 'report' && status !== 'idle' && (
          <>
            {tab === 'speed' && speedResults && <SpeedResults results={speedResults} />}
            {tab === 'complexity' && complexityResults && <ComplexityResults results={complexityResults} />}
            {tab === 'security' && securityResults && <SecurityResults results={securityResults} />}

            {/* Loading placeholders */}
            {tab === 'speed' && !speedResults && status === 'running' && <LoadingPlaceholder label="署名検証速度を計測中..." />}
            {tab === 'complexity' && !complexityResults && status === 'running' && <LoadingPlaceholder label="デシリアライズ複雑性を分析中..." />}
            {tab === 'security' && !securityResults && status === 'running' && <LoadingPlaceholder label="セキュリティテストを実行中..." />}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <span>使用ライブラリ: </span>
        {[
          'jose@6.x', '@noble/ed25519@2.x', 'jsonld@8.x', 'recharts@2.x',
        ].map((l) => <span key={l} style={tagStyle}>{l}</span>)}
        <span style={{ marginLeft: 8 }}>|</span>
        <span style={{ marginLeft: 8 }}>W3C VCDM 2.0 / IETF SD-JWT VC (RFC 9901)</span>
      </div>
    </div>
  )
}

function LoadingPlaceholder({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 48 }}>
      <div style={spinner} />
      <span style={{ color: '#64748b', fontSize: 14 }}>{label}</span>
    </div>
  )
}

// --- Styles ---
const appStyle: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1117',
}
const headerStyle: React.CSSProperties = {
  background: '#0f172a', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, zIndex: 10,
}
const headerInner: React.CSSProperties = {
  maxWidth: 1280, margin: '0 auto', padding: '16px 24px',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
}
const h1Style: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#f1f5f9' }
const subtitleStyle: React.CSSProperties = { fontSize: 12, color: '#475569', marginTop: 2 }
const tabBarStyle: React.CSSProperties = {
  display: 'flex', gap: 0, background: '#0f172a', borderBottom: '1px solid #1e293b',
  maxWidth: 1280, margin: '0 auto', width: '100%', padding: '0 24px',
}
const tabBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px',
  background: 'none', border: 'none', cursor: 'pointer', color: '#64748b',
  borderBottom: '2px solid transparent', transition: 'all 0.15s',
}
const tabBtnActiveStyle: React.CSSProperties = {
  color: '#e2e8f0', borderBottom: '2px solid #60a5fa',
}
const contentStyle: React.CSSProperties = {
  flex: 1, maxWidth: 1280, margin: '0 auto', width: '100%', padding: '24px 24px',
}
const emptyStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', minHeight: 400,
}
const btnStyle: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontSize: 14, fontWeight: 600, transition: 'all 0.15s',
}
const btnActiveStyle: React.CSSProperties = { background: '#3b82f6', color: '#fff' }
const btnDisabledStyle: React.CSSProperties = { background: '#1e293b', color: '#475569', cursor: 'not-allowed' }
const selectStyle: React.CSSProperties = {
  marginLeft: 8, padding: '4px 8px', borderRadius: 6, background: '#1e293b',
  border: '1px solid #334155', color: '#e2e8f0', fontSize: 13,
}
const progressBarWrap: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '6px 16px',
  background: '#0f172a', borderTop: '1px solid #1e293b',
}
const progressBar: React.CSSProperties = {
  width: 120, height: 4, background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
  borderRadius: 2,
  animation: 'pulse 1.5s ease-in-out infinite',
}
const footerStyle: React.CSSProperties = {
  background: '#0f172a', borderTop: '1px solid #1e293b',
  padding: '10px 24px', display: 'flex', gap: 8, alignItems: 'center',
  fontSize: 11, color: '#475569', flexWrap: 'wrap',
}
const tagStyle: React.CSSProperties = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 4,
  padding: '1px 6px', fontSize: 11, color: '#64748b',
}
const spinner: React.CSSProperties = {
  width: 32, height: 32, borderRadius: '50%',
  border: '3px solid #334155', borderTopColor: '#60a5fa',
  animation: 'spin 0.8s linear infinite',
}
