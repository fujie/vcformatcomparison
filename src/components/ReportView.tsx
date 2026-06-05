import { useState, useCallback } from 'react'
import type { SpeedResult } from '../benchmarks/signatureSpeed'
import type { ComplexityMetric } from '../benchmarks/deserializationComplexity'
import type { SecurityTest } from '../benchmarks/normalizationSecurity'
import type { NoLibResult, SerialBenchResult } from '../benchmarks/noLibrary'
import type { RefValues } from '../data/referenceValues'
import type { PyBenchResults } from '../lib/pyodideRunner'

interface Props {
  speedResults:      SpeedResult[]      | null
  complexityResults: ComplexityMetric[] | null
  securityResults:   SecurityTest[]     | null
  noLibResults:      NoLibResult[]      | null
  serialResults:     SerialBenchResult[]| null
  iterations:        number
  refValues:         RefValues
  pythonResults:     PyBenchResults     | null
}

// ── Helpers ──────────────────────────────────────────────────

function getBrowserInfo(): string {
  const ua = navigator.userAgent
  const m = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/[\d.]+/)
  return m ? `${m[0]} — ${navigator.platform}` : ua.slice(0, 60)
}

function fmt(v: number | undefined, digits = 2): string {
  return v !== undefined ? v.toFixed(digits) : '—'
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

// ── JSON export ──────────────────────────────────────────────

function buildJson(props: Props, timestamp: string): string {
  return JSON.stringify({
    exportedAt: timestamp,
    environment: {
      userAgent:  navigator.userAgent,
      platform:   navigator.platform,
      iterations: props.iterations,
      libraries:  ['jose@6.x', '@noble/ed25519@2.x', 'jsonld@8.x', 'cbor-x@1.x', 'recharts@2.x'],
    },
    speedResults:      props.speedResults      ?? [],
    complexityResults: props.complexityResults ?? [],
    securityResults:   props.securityResults   ?? [],
    noLibResults:      props.noLibResults       ?? [],
    serialResults:     props.serialResults     ?? [],
  }, null, 2)
}

// ── CSV export ───────────────────────────────────────────────

function buildCsv(props: Props, timestamp: string): string {
  const lines: string[] = []
  const row = (...cols: (string | number)[]) =>
    lines.push(cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))

  row('# VC Format Comparison — エクスポート日時:', timestamp)
  row('# ブラウザ:', getBrowserInfo())
  row('# イテレーション数:', props.iterations)
  lines.push('')

  // 1. 署名速度
  row('## 署名検証速度')
  row('フォーマット', '操作', '反復数', '合計(ms)', '平均(ms)', 'ops/sec')
  for (const r of props.speedResults ?? []) {
    row(r.format, r.operation, r.iterations, fmt(r.totalMs, 1), fmt(r.avgMs, 3), fmt(r.opsPerSec, 1))
  }
  lines.push('')

  // 2. 複雑性
  row('## デシリアライズ複雑性')
  row('フォーマット', 'LOC', '非同期ステップ', '循環的複雑度', 'ネットワーク呼び出し', 'パース時間(ms)', '外部依存')
  for (const r of props.complexityResults ?? []) {
    row(r.format, r.linesOfCode, r.asyncSteps, r.cyclomaticComplexity,
        r.externalNetworkCalls, fmt(r.parseTimeMs, 2), r.externalDependencies.join(' / '))
  }
  lines.push('')

  // 3. セキュリティ
  row('## セキュリティテスト')
  row('ID', 'テスト名', 'フォーマット', 'カテゴリ', '深刻度', '結果', '詳細')
  for (const r of props.securityResults ?? []) {
    row(r.id, r.name, r.format, r.category, r.severity, r.result,
        r.details.replace(/\n/g, ' '))
  }
  lines.push('')

  // 4. ライブラリなし vs あり（全言語）
  row('## ライブラリなし vs あり（全言語）')
  row('フォーマット', '言語', 'モード', '操作', '反復数/参考', '平均(ms)', 'ops/sec', '備考')
  for (const r of props.noLibResults ?? []) {
    row(r.format, 'TypeScript', r.mode === 'withLib' ? 'ライブラリあり' : 'ライブラリなし',
        r.operation, r.iterations, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), '実測値')
  }
  for (const op of ['sign', 'verify'] as const) {
    const r = props.speedResults?.find(x => x.format === 'JSON-LD VC' && x.operation === op)
    if (r) row('JSON-LD VC', 'TypeScript', 'ライブラリあり', op, r.iterations, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), '実測値')
  }
  const _fmts2 = ['SD-JWT VC', 'JSON-LD VC', 'mdoc'] as const
  const _modes2 = ['withLib', 'noLib'] as const
  for (const f of _fmts2) {
    for (const m of _modes2) {
      if (f === 'JSON-LD VC' && m === 'noLib') continue
      for (const op of ['sign', 'verify'] as const) {
        const ref = props.refValues[`${f}-${m}-${op}`]
        if (ref) {
          const mLabel = m === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'
          row(f, 'Go', mLabel, op, '参考', '—', ref.Go, '参考値(Apple M2 Pro)')
          const pyActual = props.pythonResults?.[`${f}-${m}-${op}`]
          if (pyActual) {
            row(f, 'Python', mLabel, op, pyActual.iterations, fmt(pyActual.avgMs, 3), pyActual.opsPerSec.toFixed(1), '✓ Pyodide 実測値')
          } else {
            row(f, 'Python', mLabel, op, '参考', '—', ref.Python, '参考値(Apple M2 Pro)')
          }
        }
      }
    }
  }
  lines.push('')

  // 5. シリアライズ速度
  row('## シリアライズ速度（暗号なし）')
  row('フォーマット', '操作', '反復数', '平均(ms)', 'ops/sec', 'ペイロード(bytes)')
  for (const r of props.serialResults ?? []) {
    row(r.format, r.operation, r.iterations, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), r.payloadSizeBytes)
  }

  return lines.join('\n')
}

// ── Markdown export ──────────────────────────────────────────

function buildMarkdown(props: Props, timestamp: string): string {
  const lines: string[] = []
  const tableRow = (...cols: (string | number)[]) => '| ' + cols.join(' | ') + ' |'
  const sep = (n: number) => '|' + ' --- |'.repeat(n)

  lines.push('# VC Format Comparison Report')
  lines.push('')
  lines.push('## テスト条件')
  lines.push(tableRow('項目', '値'))
  lines.push(sep(2))
  lines.push(tableRow('エクスポート日時', timestamp))
  lines.push(tableRow('ブラウザ', getBrowserInfo()))
  lines.push(tableRow('イテレーション数', props.iterations))
  lines.push(tableRow('使用ライブラリ', 'jose@6.x / @noble/ed25519@2.x / jsonld@8.x / cbor-x@1.x'))
  lines.push('')

  if (props.speedResults?.length) {
    lines.push('## ⚡ 署名検証速度')
    lines.push(tableRow('フォーマット', '操作', '平均(ms)', 'ops/sec'))
    lines.push(sep(4))
    for (const r of props.speedResults) {
      lines.push(tableRow(r.format, r.operation, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1)))
    }
    lines.push('')
  }

  if (props.complexityResults?.length) {
    lines.push('## 📐 デシリアライズ複雑性')
    lines.push(tableRow('フォーマット', 'LOC', '非同期ステップ', '循環的複雑度', 'ネットワーク呼出', 'パース時間(ms)'))
    lines.push(sep(6))
    for (const r of props.complexityResults) {
      lines.push(tableRow(r.format, r.linesOfCode, r.asyncSteps,
        r.cyclomaticComplexity, r.externalNetworkCalls, fmt(r.parseTimeMs, 2)))
    }
    lines.push('')
  }

  if (props.securityResults?.length) {
    lines.push('## 🔐 セキュリティテスト')
    lines.push(tableRow('テスト名', 'フォーマット', '深刻度', '結果'))
    lines.push(sep(4))
    for (const r of props.securityResults) {
      const resultLabel = r.result === 'vulnerable' ? '✗ 脆弱' : r.result === 'mitigated' ? '✓ 緩和済み' : r.result === 'partial' ? '△ 部分的' : '— N/A'
      lines.push(tableRow(r.name, r.format, r.severity.toUpperCase(), resultLabel))
    }
    lines.push('')
  }

  {
    lines.push('## 🧪 ライブラリなし vs あり — 言語別比較')
    lines.push(tableRow('フォーマット', '言語', 'モード', '操作', '平均(ms)', 'ops/sec', '備考'))
    lines.push(sep(7))
    for (const r of props.noLibResults ?? []) {
      lines.push(tableRow(r.format, 'TypeScript', r.mode === 'withLib' ? 'ライブラリあり' : 'ライブラリなし',
        r.operation, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), '実測値'))
    }
    for (const op of ['sign', 'verify'] as const) {
      const r = props.speedResults?.find(x => x.format === 'JSON-LD VC' && x.operation === op)
      if (r) lines.push(tableRow('JSON-LD VC', 'TypeScript', 'ライブラリあり', op, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), '実測値'))
    }
    const _mfmts = ['SD-JWT VC', 'JSON-LD VC', 'mdoc'] as const
    for (const f of _mfmts) {
      for (const m of ['withLib', 'noLib'] as const) {
        if (f === 'JSON-LD VC' && m === 'noLib') continue
        for (const op of ['sign', 'verify'] as const) {
          const ref = props.refValues[`${f}-${m}-${op}`]
          if (!ref) continue
          const ml = m === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'
          lines.push(tableRow(f, 'Go', ml, op, '—', ref.Go, '参考値'))
          const pyAct = props.pythonResults?.[`${f}-${m}-${op}`]
          lines.push(pyAct
            ? tableRow(f, 'Python', ml, op, fmt(pyAct.avgMs, 3), pyAct.opsPerSec.toFixed(1), '✓ Pyodide 実測値')
            : tableRow(f, 'Python', ml, op, '—', ref.Python, '参考値')
          )
        }
      }
    }
    lines.push('')
  }

  if (props.serialResults?.length) {
    lines.push('## 📦 シリアライズ速度（暗号なし）')
    lines.push(tableRow('フォーマット', '操作', '平均(ms)', 'ops/sec', 'ペイロード(bytes)'))
    lines.push(sep(5))
    for (const r of props.serialResults) {
      lines.push(tableRow(r.format, r.operation, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), r.payloadSizeBytes))
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('*Generated by VC Format Comparison Tool*')
  return lines.join('\n')
}

// ── Sub-section table components ─────────────────────────────

function SectionTable({ title, headers, rows, color = '#60a5fa' }: {
  title: string; headers: string[]; rows: (string | number)[][]; color?: string
}) {
  return (
    <div style={panelStyle}>
      <h3 style={{ ...sectionTitle, color }}>{title}</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 500 }}>
          <thead>
            <tr>{headers.map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                {row.map((cell, j) => <td key={j} style={tdStyle}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NotRun({ label }: { label: string }) {
  return (
    <div style={{ padding: '8px 14px', background: '#1e293b', borderRadius: 8, fontSize: 12, color: '#475569', border: '1px dashed #334155' }}>
      ⏸ {label} — 未実行（「ベンチマーク実行」で計測してください）
    </div>
  )
}

// ── Main component ───────────────────────────────────────────

export function ReportView(props: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  const timestamp = new Date().toLocaleString('ja-JP')

  const runCount = [
    props.speedResults, props.complexityResults, props.securityResults,
    props.noLibResults, props.serialResults,
  ].filter(Boolean).length

  const handleCopy = useCallback(async (type: 'csv' | 'markdown' | 'json') => {
    const content =
      type === 'json'     ? buildJson(props, timestamp) :
      type === 'csv'      ? buildCsv(props, timestamp) :
                            buildMarkdown(props, timestamp)
    await copyToClipboard(content)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }, [props, timestamp])

  const handleDownload = useCallback((type: 'json' | 'csv') => {
    const ts = new Date().toISOString().slice(0, 10)
    if (type === 'json') {
      downloadFile(buildJson(props, timestamp), `vc-report-${ts}.json`, 'application/json')
    } else {
      downloadFile(buildCsv(props, timestamp), `vc-report-${ts}.csv`, 'text/csv;charset=utf-8')
    }
  }, [props, timestamp])

  // Security result label
  const secLabel = (r: string) =>
    r === 'vulnerable' ? '✗ 脆弱' : r === 'mitigated' ? '✓ 緩和済み' : r === 'partial' ? '△ 部分的' : '— N/A'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header + export buttons */}
      <div style={{ ...panelStyle, borderColor: '#3b82f630' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>テスト結果レポート</h2>
            <p style={{ fontSize: 12, color: '#64748b' }}>エクスポート日時: {timestamp}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([
              { id: 'markdown' as const, label: 'Markdown コピー', icon: '📝' },
              { id: 'csv'      as const, label: 'CSV コピー',       icon: '📊' },
              { id: 'json'     as const, label: 'JSON コピー',      icon: '📋' },
            ]).map(({ id, label, icon }) => (
              <button key={id} onClick={() => handleCopy(id)} style={{
                ...exportBtn,
                background: copied === id ? '#14532d' : '#1e293b',
                borderColor: copied === id ? '#22c55e' : '#334155',
                color: copied === id ? '#86efac' : '#cbd5e1',
              }}>
                {icon} {copied === id ? 'コピー済み ✓' : label}
              </button>
            ))}
            <button onClick={() => handleDownload('json')} style={{ ...exportBtn, background: '#1e3a5f', borderColor: '#3b82f6', color: '#93c5fd' }}>
              ⬇ JSON ダウンロード
            </button>
            <button onClick={() => handleDownload('csv')} style={{ ...exportBtn, background: '#1e3a5f', borderColor: '#3b82f6', color: '#93c5fd' }}>
              ⬇ CSV ダウンロード
            </button>
          </div>
        </div>

        {/* Progress indicator */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {[
            { label: '署名速度', done: !!props.speedResults },
            { label: '複雑性', done: !!props.complexityResults },
            { label: 'セキュリティ', done: !!props.securityResults },
            { label: 'ライブラリなし', done: !!props.noLibResults },
            { label: 'シリアライズ', done: !!props.serialResults },
          ].map(({ label, done }) => (
            <span key={label} style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 20,
              background: done ? '#14532d' : '#1e293b',
              color: done ? '#86efac' : '#475569',
              border: `1px solid ${done ? '#22c55e' : '#334155'}`,
            }}>
              {done ? '✓' : '○'} {label}
            </span>
          ))}
          <span style={{ fontSize: 11, color: '#64748b', padding: '3px 6px' }}>
            {runCount}/5 完了
          </span>
        </div>
      </div>

      {/* テスト条件 */}
      <SectionTable
        title="🖥 テスト実行環境"
        color="#a78bfa"
        headers={['項目', '値']}
        rows={[
          ['ブラウザ / OS', getBrowserInfo()],
          ['イテレーション数', props.iterations],
          ['実行日時', timestamp],
          ['使用ライブラリ', 'jose@6.x / @noble/ed25519@2.x / jsonld@8.x / cbor-x@1.x / recharts@2.x'],
          ['規格', 'IETF RFC 9901 (SD-JWT VC) / W3C VCDM 2.0 (JSON-LD VC) / ISO 18013-5 (mdoc)'],
          ['署名アルゴリズム', 'SD-JWT VC: EdDSA Ed25519 / JSON-LD VC: Ed25519+SHA-256 / mdoc: ECDSA P-256'],
          ['正規化', 'JSON-LD VC: URDNA2015 (RDF Dataset Normalization) / その他: なし'],
        ]}
      />

      {/* 署名速度 */}
      {props.speedResults ? (
        <SectionTable
          title="⚡ 署名検証速度"
          color="#60a5fa"
          headers={['フォーマット', '操作', '反復数', '合計(ms)', '平均(ms)', 'ops/sec']}
          rows={props.speedResults.map(r => [
            r.format, r.operation, r.iterations,
            fmt(r.totalMs, 1), fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
          ])}
        />
      ) : <NotRun label="署名検証速度" />}

      {/* 複雑性 */}
      {props.complexityResults ? (
        <SectionTable
          title="📐 デシリアライズ複雑性"
          color="#f59e0b"
          headers={['フォーマット', 'LOC', '非同期ステップ', '循環的複雑度', 'ネットワーク呼出', 'パース時間(ms)', '外部依存']}
          rows={props.complexityResults.map(r => [
            r.format, r.linesOfCode, r.asyncSteps, r.cyclomaticComplexity,
            r.externalNetworkCalls, fmt(r.parseTimeMs, 2),
            r.externalDependencies.join(' / '),
          ])}
        />
      ) : <NotRun label="デシリアライズ複雑性" />}

      {/* セキュリティ */}
      {props.securityResults ? (
        <SectionTable
          title="🔐 セキュリティテスト"
          color="#f87171"
          headers={['ID', 'テスト名', 'フォーマット', 'カテゴリ', '深刻度', '結果', '詳細']}
          rows={props.securityResults.map(r => [
            r.id, r.name, r.format, r.category,
            r.severity.toUpperCase(), secLabel(r.result),
            r.details.length > 60 ? r.details.slice(0, 60) + '…' : r.details,
          ])}
        />
      ) : <NotRun label="セキュリティテスト" />}

      {/* ライブラリなし vs あり — TypeScript + Go + Python */}
      {(() => {
        const fmts = ['SD-JWT VC', 'JSON-LD VC', 'mdoc'] as const
        const modes = ['withLib', 'noLib'] as const
        const ops   = ['sign', 'verify'] as const
        const langs = ['Go', 'Python'] as const

        // Build unified rows: TypeScript (actual) + Go/Python (reference)
        const rows: (string | number)[][] = []

        for (const f of fmts) {
          for (const m of modes) {
            if (f === 'JSON-LD VC' && m === 'noLib') continue // no-lib not practical
            for (const op of ops) {
              // TypeScript row
              const tsResult = f === 'JSON-LD VC'
                ? props.speedResults?.find(r => r.format === 'JSON-LD VC' && r.operation === op)
                : props.noLibResults?.find(r => r.format === f && r.mode === m && r.operation === op)
              if (tsResult || props.noLibResults || props.speedResults) {
                rows.push([
                  f,
                  'TypeScript',
                  m === 'withLib' ? 'ライブラリあり' : 'ライブラリなし',
                  op,
                  tsResult ? tsResult.iterations : '—',
                  tsResult ? fmt(tsResult.avgMs, 3) : '未計測',
                  tsResult ? fmt(tsResult.opsPerSec, 1) : '未計測',
                  '実測値',
                ])
              }
              // Go / Python rows
              const refKey = `${f}-${m}-${op}`
              for (const lang of langs) {
                let opsVal: number
                let note: string
                if (lang === 'Python') {
                  const actual = props.pythonResults?.[refKey]
                  if (actual) {
                    opsVal = actual.opsPerSec
                    note = `✓ Pyodide 実測値 (${actual.iterations} 回)`
                  } else {
                    opsVal = props.refValues[refKey]?.['Python'] ?? 0
                    note = '参考値（Apple M2 Pro）'
                  }
                } else {
                  opsVal = props.refValues[refKey]?.['Go'] ?? 0
                  note = '参考値（Apple M2 Pro）'
                }
                rows.push([
                  f,
                  lang,
                  m === 'withLib' ? 'ライブラリあり' : 'ライブラリなし',
                  op,
                  lang === 'Python' && props.pythonResults?.[refKey] ? props.pythonResults[refKey].iterations : '参考',
                  lang === 'Python' && props.pythonResults?.[refKey] ? fmt(props.pythonResults[refKey].avgMs, 3) : '—',
                  opsVal > 0 ? opsVal.toLocaleString() : '—',
                  note,
                ])
              }
            }
          }
        }

        return (
          <SectionTable
            title="🧪 ライブラリなし vs あり — 言語別比較（TypeScript 実測 / Go・Python 参考値）"
            color="#f472b6"
            headers={['フォーマット', '言語', 'モード', '操作', '反復数', '平均(ms)', 'ops/sec', '備考']}
            rows={rows}
          />
        )
      })()}

      {/* シリアライズ */}
      {props.serialResults ? (
        <SectionTable
          title="📦 シリアライズ速度（暗号なし — CBOR vs JSON）"
          color="#34d399"
          headers={['フォーマット', '操作', '反復数', '平均(ms)', 'ops/sec', 'ペイロード(bytes)']}
          rows={props.serialResults.map(r => [
            r.format, r.operation, r.iterations,
            fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), r.payloadSizeBytes,
          ])}
        />
      ) : <NotRun label="シリアライズ速度" />}

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────
const panelStyle: React.CSSProperties = { background: '#1e293b', borderRadius: 12, padding: '18px 22px', border: '1px solid #334155' }
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 12 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #334155', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '7px 10px', color: '#cbd5e1', verticalAlign: 'top' }
const exportBtn: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 8, border: '1px solid', cursor: 'pointer',
  fontSize: 12, fontWeight: 500, transition: 'all 0.15s',
}
