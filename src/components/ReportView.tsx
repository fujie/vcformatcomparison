import { useState, useCallback } from 'react'
import type { SpeedResult } from '../benchmarks/signatureSpeed'
import type { ComplexityMetric } from '../benchmarks/deserializationComplexity'
import type { SecurityTest } from '../benchmarks/normalizationSecurity'
import type { NoLibResult, SerialBenchResult } from '../benchmarks/noLibrary'
import type { ScalingBenchResults } from '../benchmarks/scalingBenchmarks'
import type { RefValues } from '../data/referenceValues'
import type { PyBenchResults } from '../lib/pyodideRunner'
import type { GoBenchResults } from '../lib/goRunner'
import { GO_BENCH_SOURCE, PYTHON_BENCH_SOURCE, TS_SPEED_SOURCE, TS_NOLIB_SOURCE, TS_SECURITY_SOURCE } from '../data/benchmarkSources'
import type { BenchMode, BackendJobResult } from '../types/backendResult'
import { isBackendComplexityArray, isBackendSecurityArray } from '../types/backendResult'

interface Props {
  speedResults:      SpeedResult[]      | null
  complexityResults: ComplexityMetric[] | null
  securityResults:   SecurityTest[]     | null
  noLibResults:      NoLibResult[]      | null
  serialResults:     SerialBenchResult[]| null
  scalingResults?:   ScalingBenchResults | null
  iterations:        number
  refValues:         RefValues
  pythonResults:     PyBenchResults     | null
  goResults:         GoBenchResults     | null
  benchMode?:        BenchMode
  backendResult?:    BackendJobResult   | null
}

// ── Environment detection ─────────────────────────────────────

interface EnvInfo {
  browserName: string
  browserVersion: string
  os: string
  cpuCores: number
  deviceMemoryGB: string
  userAgent: string
  screenResolution: string
  timestamp: string
}

function detectEnv(): EnvInfo {
  const ua = navigator.userAgent

  // Browser name + version
  const chromeM  = ua.match(/Chrome\/([\d.]+)/)
  const ffM      = ua.match(/Firefox\/([\d.]+)/)
  const safariM  = ua.match(/Version\/([\d.]+).*Safari/)
  const edgeM    = ua.match(/Edg\/([\d.]+)/)
  let browserName = 'Unknown', browserVersion = ''
  if (edgeM)    { browserName = 'Edge';    browserVersion = edgeM[1] }
  else if (chromeM) { browserName = 'Chrome';  browserVersion = chromeM[1] }
  else if (ffM)     { browserName = 'Firefox'; browserVersion = ffM[1] }
  else if (safariM) { browserName = 'Safari';  browserVersion = safariM[1] }

  // OS
  let os = 'Unknown'
  if (/Mac OS X/.test(ua)) {
    const v = ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? ''
    os = `macOS ${v}`
  } else if (/Windows NT/.test(ua)) {
    const v = ua.match(/Windows NT ([\d.]+)/)?.[1] ?? ''
    os = `Windows NT ${v}`
  } else if (/Linux/.test(ua)) { os = 'Linux' }
  else if (/Android/.test(ua)) { os = 'Android' }
  else if (/iPhone|iPad/.test(ua)) { os = 'iOS' }

  const mem = (navigator as unknown as Record<string, unknown>)['deviceMemory']
  return {
    browserName,
    browserVersion,
    os,
    cpuCores: navigator.hardwareConcurrency ?? 0,
    deviceMemoryGB: mem ? `${mem} GB` : '不明',
    userAgent: ua,
    screenResolution: `${window.screen.width}×${window.screen.height} (devicePixelRatio: ${window.devicePixelRatio})`,
    timestamp: new Date().toLocaleString('ja-JP'),
  }
}

function getBrowserInfo(): string {
  const e = detectEnv()
  return `${e.browserName} ${e.browserVersion} — ${e.os}`
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
  const isBackend = props.benchMode === 'backend'
  return JSON.stringify({
    exportedAt: timestamp,
    benchMode: props.benchMode ?? 'frontend',
    environment: {
      userAgent:  navigator.userAgent,
      platform:   navigator.platform,
      iterations: props.iterations,
      libraries:  ['jose@6.x', '@noble/ed25519@2.x', 'jsonld@8.x', 'cbor-x@1.x', 'recharts@2.x'],
    },
    ...(isBackend ? {
      backendSpeedResults: {
        nodeJs:  props.backendResult?.nodeResult  ?? null,
        python:  props.backendResult?.pythonResult ?? null,
        go:      props.backendResult?.goResult     ?? null,
      },
      complexityResults: props.backendResult?.complexityResult ?? [],
      securityResults:   props.backendResult?.securityResult   ?? [],
    } : {
      speedResults:      props.speedResults      ?? [],
      complexityResults: props.complexityResults ?? [],
      securityResults:   props.securityResults   ?? [],
      noLibResults:      props.noLibResults       ?? [],
      serialResults:     props.serialResults     ?? [],
    }),
    scalingResults: props.scalingResults ?? null,
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
  if (props.benchMode === 'backend' && props.backendResult) {
    const be = props.backendResult
    for (const [lang, res] of [['Node.js', be.nodeResult], ['Python', be.pythonResult], ['Go', be.goResult]] as const) {
      const entries = Object.entries(res?.results ?? {})
      if (entries.length === 0) continue
      row(`## 署名検証速度 — ${lang} (process.hrtime.bigint / perf_counter_ns)`)
      row('キー', '反復数', '平均(ms)', 'ops/sec', '平均(ns)', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)')
      for (const [key, e] of entries) {
        row(
          key, e.iterations, fmt(e.avgMs, 3), fmt(e.opsPerSec, 1),
          e.avgNs !== undefined ? e.avgNs.toFixed(0) : '—',
          fmt(e.stdDevMs, 4),
          e.ci95Ms != null ? `±${e.ci95Ms.toFixed(4)}` : '—',
          fmt(e.p50Ms, 3), fmt(e.p90Ms, 3), fmt(e.p95Ms, 3), fmt(e.p99Ms, 3),
          fmt(e.minMs, 3), fmt(e.maxMs, 3),
        )
      }
      lines.push('')
    }
  } else {
    row('## 署名検証速度（統計分布）')
    row('フォーマット', '操作', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)')
    for (const r of props.speedResults ?? []) {
      row(
        r.format, r.operation, r.iterations,
        fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
        fmt(r.stdDevMs, 4),
        r.ci95Ms != null ? `±${r.ci95Ms.toFixed(4)}` : '—',
        fmt(r.p50Ms, 3), fmt(r.p90Ms, 3), fmt(r.p95Ms, 3), fmt(r.p99Ms, 3),
        fmt(r.minMs, 3), fmt(r.maxMs, 3),
      )
    }
    lines.push('')
  }

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
  row('フォーマット', '言語', 'モード', '操作', '反復数/参考', '平均(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)', '備考')
  for (const r of props.noLibResults ?? []) {
    row(
      r.format, 'TypeScript', r.mode === 'withLib' ? 'ライブラリあり' : 'ライブラリなし',
      r.operation, r.iterations, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
      fmt(r.stdDevMs, 4),
      r.ci95Ms != null ? `±${r.ci95Ms.toFixed(4)}` : '—',
      fmt(r.p50Ms, 3), fmt(r.p95Ms, 3), fmt(r.p99Ms, 3),
      '実測値',
    )
  }
  for (const op of ['sign', 'verify'] as const) {
    const r = props.speedResults?.find(x => x.format === 'JSON-LD VC' && x.operation === op)
    if (r) row('JSON-LD VC', 'TypeScript', 'ライブラリあり', op, r.iterations, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), '実測値')
    const rJcs = props.speedResults?.find(x => x.format === 'JSON-LD VC (JCS)' && x.operation === op)
    if (rJcs) row('JSON-LD VC (JCS)', 'TypeScript', 'ライブラリあり', op, rJcs.iterations, fmt(rJcs.avgMs, 3), fmt(rJcs.opsPerSec, 1), '実測値')
  }
  const _fmts2 = ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc'] as const
  const _modes2 = ['withLib', 'noLib'] as const
  for (const f of _fmts2) {
    for (const m of _modes2) {
      for (const op of ['sign', 'verify'] as const) {
        const ref = props.refValues[`${f}-${m}-${op}`]
        if (ref) {
          const mLabel = m === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'
          const goActual = props.goResults?.[`${f}-${m}-${op}`]
          if (goActual) {
            row(f, 'Go', mLabel, op, goActual.iterations, fmt(goActual.avgMs, 3), goActual.opsPerSec.toFixed(1), '✓ Go WASM 実測値')
          } else {
            row(f, 'Go', mLabel, op, '参考', '—', ref.Go, '参考値(Apple M2 Pro)')
          }
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
  row('## シリアライズ速度（暗号なし、統計分布）')
  row('フォーマット', '操作/ラベル', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)', 'ペイロード(bytes)')
  for (const r of props.serialResults ?? []) {
    row(
      r.format, r.label ?? r.operation, r.iterations,
      fmt(r.avgMs, 4), fmt(r.opsPerSec, 1),
      fmt(r.stdDevMs, 5),
      r.ci95Ms != null ? `±${r.ci95Ms.toFixed(5)}` : '—',
      fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.p99Ms, 4),
      fmt(r.minMs, 4), fmt(r.maxMs, 4),
      r.payloadSizeBytes,
    )
  }

  if (props.scalingResults) {
    const sr = props.scalingResults
    row('')
    row('## 属性数スケーリング')
    row('フォーマット', '属性数', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', 'p95(ms)', 'size(B)')
    for (const r of sr.attrScaling) {
      row(r.format, r.attrCount ?? '—', r.iterations, fmt(r.avgMs, 4), fmt(r.opsPerSec, 1), fmt(r.stdDevMs, 5), fmt(r.p95Ms, 4), r.payloadSizeBytes ?? '—')
    }
    row('')
    row('## コンテキストローダー比較')
    row('ラベル', '反復数', '平均(ms)', 'p95(ms)', 'σ(ms)')
    for (const r of sr.contextLoader) {
      row(r.label, r.iterations, fmt(r.avgMs, 2), fmt(r.p95Ms, 2), fmt(r.stdDevMs, 3))
    }
    row('')
    row('## URDNA2015 call limit')
    row('グラフ', 'タイムアウト', '計測(ms)', '状態')
    for (const r of sr.callLimit) {
      row(r.label, r.condition === 'with' ? 'あり' : 'なし', fmt(r.avgMs, 1), r.timedOut ? '保護/TO' : '完了')
    }
    row('')
    row('## 選択的開示')
    row('フォーマット', '開示数', '反復数', '平均(ms)', 'p50(ms)', 'p95(ms)', 'σ(ms)', '備考')
    for (const r of sr.selectiveDisc) {
      const note = r.format === 'JSON-LD VC' ? 'URDNA2015再正規化' : r.format === 'JSON-LD VC (JCS)' ? 'JCS再正規化' : r.format === 'SD-JWT VC' ? 'SHA-256ハッシュ' : 'CBORサブセット'
      row(r.format, r.disclosedCount ?? '—', r.iterations, fmt(r.avgMs, 4), fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.stdDevMs, 5), note)
    }
    row('')
    row('## Ed25519 統一ベンチマーク')
    row('フォーマット', '操作', '反復数', '平均(ms)', 'ops/sec', 'p95(ms)')
    for (const r of sr.unifiedEd25519) {
      row(r.format, r.condition ?? '—', r.iterations, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), fmt(r.p95Ms, 3))
    }
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

  if (props.benchMode === 'backend' && props.backendResult) {
    const be = props.backendResult
    for (const [lang, res] of [['Node.js', be.nodeResult], ['Python', be.pythonResult], ['Go', be.goResult]] as const) {
      const entries = Object.entries(res?.results ?? {})
      if (entries.length === 0) continue
      lines.push(`## ⚡ 署名検証速度 — ${lang} (process.hrtime.bigint / perf_counter_ns)`)
      lines.push(tableRow('キー', '反復数', '平均(ms)', 'ops/sec', '平均(ns)', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)'))
      lines.push(sep(13))
      for (const [key, e] of entries) {
        lines.push(tableRow(
          key, e.iterations, fmt(e.avgMs, 3), fmt(e.opsPerSec, 1),
          e.avgNs !== undefined ? e.avgNs.toFixed(0) : '—',
          fmt(e.stdDevMs, 4),
          e.ci95Ms != null ? `±${e.ci95Ms.toFixed(4)}` : '—',
          fmt(e.p50Ms, 3), fmt(e.p90Ms, 3), fmt(e.p95Ms, 3), fmt(e.p99Ms, 3),
          fmt(e.minMs, 3), fmt(e.maxMs, 3),
        ))
      }
      lines.push('')
    }
  } else if (props.speedResults?.length) {
    lines.push('## ⚡ 署名検証速度（統計分布）')
    lines.push(tableRow('フォーマット', '操作', '平均(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)'))
    lines.push(sep(12))
    for (const r of props.speedResults) {
      lines.push(tableRow(
        r.format, r.operation, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
        fmt(r.stdDevMs, 4),
        r.ci95Ms != null ? `±${r.ci95Ms.toFixed(4)}` : '—',
        fmt(r.p50Ms, 3), fmt(r.p90Ms, 3), fmt(r.p95Ms, 3), fmt(r.p99Ms, 3),
        fmt(r.minMs, 3), fmt(r.maxMs, 3),
      ))
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
    lines.push(tableRow('フォーマット', '言語', 'モード', '操作', '平均(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', '備考'))
    lines.push(sep(11))
    for (const r of props.noLibResults ?? []) {
      lines.push(tableRow(
        r.format, 'TypeScript', r.mode === 'withLib' ? 'ライブラリあり' : 'ライブラリなし',
        r.operation, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
        fmt(r.stdDevMs, 4),
        r.ci95Ms != null ? `±${r.ci95Ms.toFixed(4)}` : '—',
        fmt(r.p50Ms, 3), fmt(r.p95Ms, 3),
        '実測値',
      ))
    }
    for (const op of ['sign', 'verify'] as const) {
      const r = props.speedResults?.find(x => x.format === 'JSON-LD VC' && x.operation === op)
      if (r) lines.push(tableRow('JSON-LD VC', 'TypeScript', 'ライブラリあり', op, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), '実測値'))
      const rJcs = props.speedResults?.find(x => x.format === 'JSON-LD VC (JCS)' && x.operation === op)
      if (rJcs) lines.push(tableRow('JSON-LD VC (JCS)', 'TypeScript', 'ライブラリあり', op, fmt(rJcs.avgMs, 3), fmt(rJcs.opsPerSec, 1), '実測値'))
    }
    const _mfmts = ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc'] as const
    for (const f of _mfmts) {
      for (const m of ['withLib', 'noLib'] as const) {
        for (const op of ['sign', 'verify'] as const) {
          const ref = props.refValues[`${f}-${m}-${op}`]
          if (!ref) continue
          const ml = m === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'
          const mdGoAct = props.goResults?.[`${f}-${m}-${op}`]
          lines.push(mdGoAct
            ? tableRow(f, 'Go',     ml, op, fmt(mdGoAct.avgMs, 3),  mdGoAct.opsPerSec.toFixed(1), '✓ Go WASM 実測値')
            : tableRow(f, 'Go',     ml, op, '—', ref.Go,   '参考値')
          )
          const mdPyAct = props.pythonResults?.[`${f}-${m}-${op}`]
          lines.push(mdPyAct
            ? tableRow(f, 'Python', ml, op, fmt(mdPyAct.avgMs, 3), mdPyAct.opsPerSec.toFixed(1), '✓ Pyodide 実測値')
            : tableRow(f, 'Python', ml, op, '—', ref.Python, '参考値')
          )
        }
      }
    }
    lines.push('')
  }

  if (props.serialResults?.length) {
    lines.push('## 📦 シリアライズ速度（暗号なし、統計分布）')
    lines.push(tableRow('フォーマット', '操作/ラベル', '平均(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)', 'ペイロード(bytes)'))
    lines.push(sep(10))
    for (const r of props.serialResults) {
      lines.push(tableRow(
        r.format, r.label ?? r.operation, fmt(r.avgMs, 4), fmt(r.opsPerSec, 1),
        fmt(r.stdDevMs, 5),
        r.ci95Ms != null ? `±${r.ci95Ms.toFixed(5)}` : '—',
        fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.p99Ms, 4),
        r.payloadSizeBytes,
      ))
    }
    lines.push('')
  }

  if (props.scalingResults) {
    const sr = props.scalingResults

    lines.push('## 📊 属性数スケーリング（シリアライズ速度 vs 属性数）')
    lines.push(tableRow('フォーマット', '属性数', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', 'p95(ms)', 'size(B)'))
    lines.push(sep(8))
    for (const r of sr.attrScaling) {
      lines.push(tableRow(
        r.format, r.attrCount ?? '—', r.iterations,
        fmt(r.avgMs, 4), fmt(r.opsPerSec, 1), fmt(r.stdDevMs, 5), fmt(r.p95Ms, 4),
        r.payloadSizeBytes ?? '—',
      ))
    }
    lines.push('')

    lines.push('## 🌐 JSON-LD コンテキストローダー比較（SSRF・性能リスク）')
    lines.push(tableRow('フォーマット', 'ローダー', '反復数', '平均(ms)', 'p95(ms)', 'σ(ms)'))
    lines.push(sep(6))
    for (const r of sr.contextLoader) {
      lines.push(tableRow(r.format, r.label, r.iterations, fmt(r.avgMs, 2), fmt(r.p95Ms, 2), fmt(r.stdDevMs, 3)))
    }
    lines.push('')

    lines.push('## 🛡 URDNA2015 call limit 有無の比較（DoS 緩和効果）')
    lines.push(tableRow('グラフ', 'タイムアウト', '計測時間(ms)', '状態'))
    lines.push(sep(4))
    for (const r of sr.callLimit) {
      lines.push(tableRow(
        r.label,
        r.condition === 'with' ? 'あり' : 'なし',
        fmt(r.avgMs, 1),
        r.timedOut ? (r.condition === 'with' ? '保護動作' : 'タイムアウト') : '完了',
      ))
    }
    lines.push('')

    lines.push('## 🔓 選択的開示性能比較（開示属性数別レイテンシ）')
    lines.push(tableRow('フォーマット', '開示数/合計', '反復数', '平均(ms)', 'p50(ms)', 'p95(ms)', 'σ(ms)', '備考'))
    lines.push(sep(8))
    for (const r of sr.selectiveDisc) {
      const note = r.format === 'JSON-LD VC' ? 'URDNA2015再正規化' : r.format === 'JSON-LD VC (JCS)' ? 'JCS再正規化' : r.format === 'SD-JWT VC' ? 'SHA-256ハッシュ' : 'CBORサブセット'
      lines.push(tableRow(
        r.format, r.disclosedCount != null ? `${r.disclosedCount}/20` : '—',
        r.iterations, fmt(r.avgMs, 4), fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.stdDevMs, 5), note,
      ))
    }
    lines.push('')

    lines.push('## 🔑 Ed25519 統一ベンチマーク（純粋シリアライゼーション差の分離）')
    lines.push(tableRow('フォーマット', '操作', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', 'p50(ms)', 'p95(ms)'))
    lines.push(sep(8))
    for (const r of sr.unifiedEd25519) {
      lines.push(tableRow(
        r.format, r.condition ?? '—', r.iterations,
        fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), fmt(r.stdDevMs, 4), fmt(r.p50Ms, 3), fmt(r.p95Ms, 3),
      ))
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('*Generated by VC Format Comparison Tool*')
  return lines.join('\n')
}

// ── Sub-section table components ─────────────────────────────

// ── Execution Code Section ────────────────────────────────────

function CodeBlock({ label, lang, code, color = '#60a5fa' }: {
  label: string; lang: string; code: string; color?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: `1px solid ${color}30`, borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 16px', background: '#0f172a', border: 'none', cursor: 'pointer',
          color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>
        <span>
          <span style={{ color, marginRight: 8 }}>{lang}</span>
          {label}
        </span>
        <span style={{ color: '#64748b', fontSize: 10 }}>{open ? '▲ 閉じる' : '▼ コードを表示'}</span>
      </button>
      {open && (
        <pre style={{ margin: 0, padding: '14px 16px', background: '#020817',
          fontSize: 10, color: '#a5f3fc', overflowX: 'auto',
          lineHeight: 1.6, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {code}
        </pre>
      )}
    </div>
  )
}

function CodeSourceSection({ goResults, pythonResults }: {
  goResults: GoBenchResults | null; pythonResults: PyBenchResults | null
}) {
  return (
    <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ ...sectionTitle, color: '#a78bfa' }}>📄 実際の実行コード</h3>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
        各ベンチマークで実際に実行されたコードを示します。クリックで展開できます。
      </p>

      <CodeBlock
        lang="TypeScript"
        label="署名検証速度ベンチマーク（jose / jsonld / cbor-x）"
        color="#60a5fa"
        code={TS_SPEED_SOURCE}
      />
      <CodeBlock
        lang="TypeScript"
        label="ライブラリなし実装（Web Crypto API のみ + 手書き CBOR）"
        color="#f472b6"
        code={TS_NOLIB_SOURCE}
      />
      <CodeBlock
        lang="TypeScript"
        label="セキュリティテスト（DoS / Injection / SSRF / Algorithm Confusion）"
        color="#f87171"
        code={TS_SECURITY_SOURCE}
      />
      <CodeBlock
        lang={goResults ? 'Go ✓ WASM 実測済み' : 'Go（参考値）'}
        label="go/bench/main.go — GOOS=js GOARCH=wasm（crypto/ecdsa 標準ライブラリ）"
        color="#34d399"
        code={GO_BENCH_SOURCE}
      />
      <CodeBlock
        lang={pythonResults ? 'Python ✓ Pyodide 実測済み' : 'Python（参考値）'}
        label="Pyodide 実行コード（cryptography / PyJWT / pyld / cbor2）"
        color="#f59e0b"
        code={PYTHON_BENCH_SOURCE}
      />
    </div>
  )
}

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
  const isBackend = props.benchMode === 'backend'

  // In backend mode, derive effective results from backendResult
  const beNode     = props.backendResult?.nodeResult
  const bePython   = props.backendResult?.pythonResult
  const beGo       = props.backendResult?.goResult
  const beComplex  = isBackendComplexityArray(props.backendResult?.complexityResult) ? props.backendResult!.complexityResult : null
  const beSecurity = isBackendSecurityArray(props.backendResult?.securityResult)     ? props.backendResult!.securityResult     : null

  const runCount = isBackend
    ? [beNode, bePython, beGo, beComplex, beSecurity].filter(Boolean).length
    : [
        props.speedResults, props.complexityResults, props.securityResults,
        props.noLibResults, props.serialResults, props.scalingResults,
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
      <div style={{ ...panelStyle, borderColor: isBackend ? '#ea580c30' : '#3b82f630' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>テスト結果レポート</h2>
              <span style={{
                fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 600,
                background: isBackend ? '#ea580c20' : '#3b82f620',
                color: isBackend ? '#fb923c' : '#93c5fd',
                border: `1px solid ${isBackend ? '#ea580c50' : '#3b82f650'}`,
              }}>
                {isBackend ? '🖥 バックエンド計測' : '🌐 ブラウザ計測'}
              </span>
            </div>
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
          {(isBackend ? [
            { label: 'Node.js 速度', done: !!(beNode?.results) },
            { label: 'Python 速度', done: !!(bePython?.results) },
            { label: 'Go 速度', done: !!(beGo?.results) },
            { label: '複雑性', done: !!beComplex },
            { label: 'セキュリティ', done: !!beSecurity },
          ] : [
            { label: '署名速度', done: !!props.speedResults },
            { label: '複雑性', done: !!props.complexityResults },
            { label: 'セキュリティ', done: !!props.securityResults },
            { label: 'ライブラリなし', done: !!props.noLibResults },
            { label: 'シリアライズ', done: !!props.serialResults },
            { label: '詳細分析', done: !!props.scalingResults },
          ]).map(({ label, done }) => (
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
            {runCount}/6 完了
          </span>
        </div>
      </div>

      {/* テスト実行環境（詳細） */}
      {isBackend ? (
        <SectionTable
          title="🖥 テスト実行環境（バックエンド）"
          color="#a78bfa"
          headers={['項目', '値']}
          rows={[
            ['実行日時', timestamp],
            ['実行モード', 'バックエンド (Node.js Express サーバー / process.hrtime.bigint())'],
            ['Node.js ランタイム', beNode?.runtimeInfo ?? 'Node.js (process.hrtime.bigint)'],
            ['Python ランタイム', bePython?.runtimeInfo ?? 'Python (time.perf_counter_ns)'],
            ['Go ランタイム', beGo?.runtimeInfo ?? 'Go native binary (time.Now().UnixNano)'],
            ['バックエンドポート', 'Express localhost:3001'],
            ['Node.js 結果数', Object.keys(beNode?.results ?? {}).length],
            ['Python 結果数', Object.keys(bePython?.results ?? {}).length],
            ['Go 結果数', Object.keys(beGo?.results ?? {}).length],
            ['複雑性メトリクス数', beComplex?.length ?? 0],
            ['セキュリティテスト数', beSecurity?.length ?? 0],
            ['使用ライブラリ (Node.js)', 'node:crypto (ECDSA P-256 / Ed25519) / cbor-x / jsonld'],
            ['使用ライブラリ (Python)', 'cryptography / cbor2 / pyld'],
            ['使用ライブラリ (Go)', '標準ライブラリのみ: crypto/ecdsa, crypto/sha256, encoding/base64'],
            ['規格', 'IETF RFC 9901 / W3C VCDM 2.0 / ISO 18013-5'],
          ]}
        />
      ) : (() => {
        const env = detectEnv()
        return (
          <SectionTable
            title="🖥 テスト実行環境"
            color="#a78bfa"
            headers={['項目', '値']}
            rows={[
              ['実行日時', env.timestamp],
              ['ブラウザ', `${env.browserName} ${env.browserVersion}`],
              ['OS', env.os],
              ['CPU コア数', `${env.cpuCores} コア (navigator.hardwareConcurrency)`],
              ['デバイスメモリ', env.deviceMemoryGB],
              ['画面解像度', env.screenResolution],
              ['User-Agent', env.userAgent.slice(0, 120) + (env.userAgent.length > 120 ? '…' : '')],
              ['TypeScript ランタイム', 'Vite 5.4.x / React 18.x / Web Crypto API'],
              ['Go ランタイム', `Go 1.25.6 WASM (GOOS=js GOARCH=wasm) / wasm_exec.js`],
              ['Python ランタイム', 'Pyodide 0.26.4 (CPython 3.12 via WebAssembly)'],
              ['イテレーション数 (main)', props.iterations],
              ['イテレーション数 (Go/Python)', 100],
              ['使用ライブラリ (TypeScript)', 'jose@6.x / @noble/ed25519@2.x / jsonld@8.x / cbor-x@1.x'],
              ['使用ライブラリ (Python)', 'cryptography (bundled) / PyJWT / pyld / cbor2 (micropip)'],
              ['使用ライブラリ (Go)', '標準ライブラリのみ: crypto/ecdsa, crypto/sha256, encoding/base64'],
              ['規格', 'IETF RFC 9901 / W3C VCDM 2.0 / ISO 18013-5'],
              ['署名アルゴリズム', 'SD-JWT VC: EdDSA Ed25519 / JSON-LD VC: Ed25519+SHA-256 / JSON-LD VC (JCS): Ed25519+SHA-256 / mdoc: ECDSA P-256'],
              ['正規化', 'JSON-LD VC: URDNA2015 (RDF Dataset Normalization, eddsa-rdfc-2022) / JSON-LD VC (JCS): JCS RFC 8785 (eddsa-jcs-2022) / その他: なし'],
              ['Go 実測', props.goResults     ? `✓ WASM 実測済み (${Object.keys(props.goResults).length} 項目)` : '参考値（未実測）'],
              ['Python 実測', props.pythonResults ? `✓ Pyodide 実測済み (${Object.keys(props.pythonResults).length} 項目)` : '参考値（未実測）'],
            ]}
          />
        )
      })()}

      {/* 署名速度 */}
      {isBackend ? (
        <>
          {(['Node.js', 'Python', 'Go'] as const).map(lang => {
            const res = lang === 'Node.js' ? beNode : lang === 'Python' ? bePython : beGo
            const entries = Object.entries(res?.results ?? {})
            const color = lang === 'Node.js' ? '#60a5fa' : lang === 'Python' ? '#f59e0b' : '#34d399'
            return entries.length > 0 ? (
              <SectionTable
                key={lang}
                title={`⚡ 署名検証速度 — ${lang} (process.hrtime.bigint / perf_counter_ns)`}
                color={color}
                headers={['キー', '反復数', '平均(ms)', 'ops/sec', '平均(ns)', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)']}
                rows={entries.map(([key, e]) => [
                  key, e.iterations, fmt(e.avgMs, 3), fmt(e.opsPerSec, 1),
                  e.avgNs !== undefined ? e.avgNs.toFixed(0) : '—',
                  fmt(e.stdDevMs, 4),
                  e.ci95Ms != null ? `±${e.ci95Ms.toFixed(4)}` : '—',
                  fmt(e.p50Ms, 3), fmt(e.p90Ms, 3), fmt(e.p95Ms, 3), fmt(e.p99Ms, 3),
                  fmt(e.minMs, 3), fmt(e.maxMs, 3),
                ])}
              />
            ) : <NotRun key={lang} label={`署名検証速度 — ${lang}`} />
          })}
        </>
      ) : (
        props.speedResults ? (
          <SectionTable
            title="⚡ 署名検証速度（統計分布）"
            color="#60a5fa"
            headers={['フォーマット', '操作', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)']}
            rows={props.speedResults.map(r => [
              r.format, r.operation, r.iterations,
              fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
              fmt(r.stdDevMs, 4),
              r.ci95Ms != null ? `±${r.ci95Ms.toFixed(4)}` : '—',
              fmt(r.p50Ms, 3), fmt(r.p90Ms, 3), fmt(r.p95Ms, 3), fmt(r.p99Ms, 3),
              fmt(r.minMs, 3), fmt(r.maxMs, 3),
            ])}
          />
        ) : <NotRun label="署名検証速度" />
      )}

      {/* 複雑性 */}
      {isBackend ? (
        beComplex ? (
          <SectionTable
            title="📐 デシリアライズ複雑性（バックエンド実測 / process.hrtime.bigint）"
            color="#f59e0b"
            headers={['フォーマット', 'ライブラリ', 'LOC', '非同期ステップ', '循環的複雑度', 'ネットワーク呼出', 'パース時間(ms)', '外部依存']}
            rows={beComplex.map(r => [
              r.format, r.lib, r.linesOfCode, r.asyncSteps, r.cyclomaticComplexity,
              r.externalNetworkCalls, fmt(r.parseTimeMs, 4),
              r.externalDependencies.join(' / '),
            ])}
          />
        ) : <NotRun label="デシリアライズ複雑性 — バックエンド計測を実行してください" />
      ) : (
        props.complexityResults ? (
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
        ) : <NotRun label="デシリアライズ複雑性" />
      )}

      {/* セキュリティ */}
      {isBackend ? (
        beSecurity ? (
          <SectionTable
            title="🔐 セキュリティテスト（バックエンド — Node.js）"
            color="#f87171"
            headers={['ID', 'テスト名', 'フォーマット', 'カテゴリ', '深刻度', '結果', '詳細']}
            rows={beSecurity.map(r => [
              r.id, r.name, r.format, r.category,
              r.severity.toUpperCase(), secLabel(r.result),
              r.details.length > 60 ? r.details.slice(0, 60) + '…' : r.details,
            ])}
          />
        ) : <NotRun label="セキュリティテスト — バックエンド計測を実行してください" />
      ) : (
        props.securityResults ? (
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
        ) : <NotRun label="セキュリティテスト" />
      )}

      {/* ライブラリなし vs あり — TypeScript + Go + Python (frontend only) */}
      {!isBackend && (() => {
        const fmts = ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc'] as const
        const modes = ['withLib', 'noLib'] as const
        const ops   = ['sign', 'verify'] as const
        const langs = ['Go', 'Python'] as const

        // Build unified rows: TypeScript (actual) + Go/Python (reference)
        const rows: (string | number)[][] = []

        for (const f of fmts) {
          for (const m of modes) {
            for (const op of ops) {
              // TypeScript row: JCS comes from speedResults; JSON-LD VC withLib from speedResults, noLib from noLibResults
              const tsResult = f === 'JSON-LD VC (JCS)'
                ? props.speedResults?.find(r => r.format === f && r.operation === op)
                : f === 'JSON-LD VC' && m === 'withLib'
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
                  tsResult?.stdDevMs != null ? fmt(tsResult.stdDevMs, 4) : '—',
                  tsResult?.ci95Ms   != null ? `±${tsResult.ci95Ms.toFixed(4)}` : '—',
                  tsResult?.p50Ms    != null ? fmt(tsResult.p50Ms, 3) : '—',
                  tsResult?.p95Ms    != null ? fmt(tsResult.p95Ms, 3) : '—',
                  tsResult?.p99Ms    != null ? fmt(tsResult.p99Ms, 3) : '—',
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
                  const actual = props.goResults?.[refKey]
                  if (actual) {
                    opsVal = actual.opsPerSec
                    note = `✓ Go WASM 実測値 (${actual.iterations} 回)`
                  } else {
                    opsVal = props.refValues[refKey]?.['Go'] ?? 0
                    note = '参考値（Apple M2 Pro）'
                  }
                }
                rows.push([
                  f,
                  lang,
                  m === 'withLib' ? 'ライブラリあり' : 'ライブラリなし',
                  op,
                  lang === 'Python' && props.pythonResults?.[refKey] ? props.pythonResults[refKey].iterations : '参考',
                  lang === 'Python' && props.pythonResults?.[refKey] ? fmt(props.pythonResults[refKey].avgMs, 3) : '—',
                  opsVal > 0 ? opsVal.toLocaleString() : '—',
                  '—', '—', '—', '—', '—',
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
            headers={['フォーマット', '言語', 'モード', '操作', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)', '備考']}
            rows={rows}
          />
        )
      })()}

      {/* シリアライズ (frontend only) */}
      {!isBackend && (props.serialResults ? (
        <SectionTable
          title="📦 シリアライズ速度（暗号なし — CBOR vs JSON vs 正規化、統計分布）"
          color="#34d399"
          headers={['フォーマット', '操作/ラベル', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)', 'ペイロード(bytes)']}
          rows={props.serialResults.map(r => [
            r.format, r.label ?? r.operation, r.iterations,
            fmt(r.avgMs, 4), fmt(r.opsPerSec, 1),
            fmt(r.stdDevMs, 5),
            r.ci95Ms != null ? `±${r.ci95Ms.toFixed(5)}` : '—',
            fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.p99Ms, 4),
            fmt(r.minMs, 4), fmt(r.maxMs, 4),
            r.payloadSizeBytes,
          ])}
        />
      ) : <NotRun label="シリアライズ速度" />)}

      {/* 詳細分析 — scaling results (always shown if available, regardless of benchMode) */}
      {props.scalingResults ? (
        <>
          <SectionTable
            title="📊 属性数スケーリング（シリアライズ速度 vs 属性数）"
            color="#a78bfa"
            headers={['フォーマット', '属性数', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', 'p95(ms)', 'size(B)']}
            rows={props.scalingResults.attrScaling.map(r => [
              r.format, r.attrCount ?? '—', r.iterations,
              fmt(r.avgMs, 4), fmt(r.opsPerSec, 1), fmt(r.stdDevMs, 5), fmt(r.p95Ms, 4),
              r.payloadSizeBytes ?? '—',
            ])}
          />
          <SectionTable
            title="🌐 JSON-LD コンテキストローダー比較（SSRF・性能リスク）"
            color="#f59e0b"
            headers={['フォーマット', 'ローダー', '反復数', '平均(ms)', 'p95(ms)', 'σ(ms)']}
            rows={props.scalingResults.contextLoader.map(r => [
              r.format, r.label, r.iterations, fmt(r.avgMs, 2), fmt(r.p95Ms, 2), fmt(r.stdDevMs, 3),
            ])}
          />
          <SectionTable
            title="🛡 URDNA2015 call limit 有無の比較（DoS 緩和効果）"
            color="#ef4444"
            headers={['グラフ', 'タイムアウト', '計測時間(ms)', '状態']}
            rows={props.scalingResults.callLimit.map(r => [
              r.label,
              r.condition === 'with' ? 'あり' : 'なし',
              fmt(r.avgMs, 1),
              r.timedOut ? (r.condition === 'with' ? '保護動作' : 'タイムアウト') : '完了',
            ])}
          />
          <SectionTable
            title="🔓 選択的開示性能比較（開示属性数別レイテンシ）"
            color="#34d399"
            headers={['フォーマット', '開示数/合計', '反復数', '平均(ms)', 'p50(ms)', 'p95(ms)', 'σ(ms)', '備考']}
            rows={props.scalingResults.selectiveDisc.map(r => [
              r.format, r.disclosedCount != null ? `${r.disclosedCount}/20` : '—',
              r.iterations, fmt(r.avgMs, 4), fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.stdDevMs, 5),
              r.format === 'JSON-LD VC' ? 'URDNA2015再正規化' : r.format === 'JSON-LD VC (JCS)' ? 'JCS再正規化' : r.format === 'SD-JWT VC' ? 'SHA-256ハッシュ' : 'CBORサブセット',
            ])}
          />
          <SectionTable
            title="🔑 Ed25519 統一ベンチマーク（純粋シリアライゼーション差の分離）"
            color="#60a5fa"
            headers={['フォーマット', '操作', '反復数', '平均(ms)', 'ops/sec', 'σ(ms)', 'p50(ms)', 'p95(ms)']}
            rows={props.scalingResults.unifiedEd25519.map(r => [
              r.format, r.condition ?? '—', r.iterations,
              fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), fmt(r.stdDevMs, 4), fmt(r.p50Ms, 3), fmt(r.p95Ms, 3),
            ])}
          />
        </>
      ) : <NotRun label="詳細分析（詳細分析タブで実行）" />}

      {/* 実行コード */}
      {isBackend ? (
        <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ ...sectionTitle, color: '#fb923c' }}>📄 実際の実行コード（バックエンド）</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
            バックエンドサーバーで実際に実行されたコードを示します。クリックで展開できます。
          </p>
          <CodeBlock lang="TypeScript" label="server/bench/nodeSpeed.ts — Node.js 署名速度ベンチマーク (process.hrtime.bigint())" color="#60a5fa" code={TS_SPEED_SOURCE} />
          <CodeBlock lang="TypeScript" label="server/bench/nodeComplexity.ts — Node.js 複雑性計測" color="#f59e0b" code="// server/bench/nodeComplexity.ts\n// BackendComplexityEntry[] を返す\n// process.hrtime.bigint() で parseTimeNs を計測\n// linesOfCode / asyncSteps / cyclomaticComplexity は静的メトリクス" />
          <CodeBlock lang="TypeScript" label="server/bench/nodeSecurity.ts — Node.js セキュリティテスト" color="#f87171" code={TS_SECURITY_SOURCE} />
          <CodeBlock lang="Python" label="server/bench/speed.py — Python 速度ベンチマーク (time.perf_counter_ns())" color="#f59e0b" code={PYTHON_BENCH_SOURCE} />
          <CodeBlock lang="Go" label="go/bench-native/main.go — Go native バイナリ (time.Now().UnixNano())" color="#34d399" code={GO_BENCH_SOURCE} />
        </div>
      ) : (
        <CodeSourceSection
          goResults={props.goResults}
          pythonResults={props.pythonResults}
        />
      )}

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
