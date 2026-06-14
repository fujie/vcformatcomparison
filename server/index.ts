/**
 * Backend benchmark server — port 3001
 *
 * Endpoints:
 *   POST /api/bench/start          → { jobId }
 *   GET  /api/bench/stream/:jobId  → SSE stream (progress + final result)
 *   GET  /api/bench/result/:jobId  → JSON result (poll alternative)
 *   GET  /api/health               → { ok: true, node: version }
 */

import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import { runNodeBenchmarks } from './bench/nodeSpeed.js'
import { runPythonBenchmark } from './bench/pyRunner.js'
import { runGoBenchmark } from './bench/goRunner.js'
import { runNodeComplexity } from './bench/nodeComplexity.js'
import { runNodeSecurity } from './bench/nodeSecurity.js'

const app = express()
app.use(cors())
app.use(express.json())

// ── Job store ──────────────────────────────────────────────────────────────

interface Job {
  id: string
  status: 'pending' | 'running' | 'done' | 'error'
  progress: string[]
  nodeResult?: object
  pythonResult?: object
  goResult?: object
  complexityResult?: object
  securityResult?: object
  error?: string
  startedAt: number
  finishedAt?: number
}

const jobs = new Map<string, Job>()

// SSE subscriber lists per job
const sseClients = new Map<string, express.Response[]>()

function emitSSE(jobId: string, event: string, data: unknown) {
  const clients = sseClients.get(jobId) ?? []
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) {
    try { res.write(payload) } catch { /* client disconnected */ }
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, node: process.version, platform: process.platform, arch: process.arch })
})

app.post('/api/bench/start', (req, res) => {
  const {
    iterations = 200,
    runNode = true,
    runPython = true,
    runGo = true,
    runComplexity = true,
    runSecurity = true,
  } = req.body as {
    iterations?: number
    runNode?: boolean
    runPython?: boolean
    runGo?: boolean
    runComplexity?: boolean
    runSecurity?: boolean
  }

  const jobId = crypto.randomUUID()
  const job: Job = {
    id: jobId,
    status: 'pending',
    progress: [],
    startedAt: Date.now(),
  }
  jobs.set(jobId, job)

  // Start benchmark async (do not await)
  void runBenchmark(job, iterations, runNode, runPython, runGo, runComplexity, runSecurity)

  res.json({ jobId })
})

app.get('/api/bench/stream/:jobId', (req, res) => {
  const { jobId } = req.params
  const job = jobs.get(jobId)
  if (!job) { res.status(404).json({ error: 'job not found' }); return }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Send buffered progress so far
  for (const msg of job.progress) {
    res.write(`event: progress\ndata: ${JSON.stringify({ message: msg })}\n\n`)
  }

  if (job.status === 'done' || job.status === 'error') {
    res.write(`event: done\ndata: ${JSON.stringify(buildResult(job))}\n\n`)
    res.end()
    return
  }

  // Subscribe to future events
  if (!sseClients.has(jobId)) sseClients.set(jobId, [])
  sseClients.get(jobId)!.push(res)

  req.on('close', () => {
    const list = sseClients.get(jobId) ?? []
    sseClients.set(jobId, list.filter(r => r !== res))
  })
})

app.get('/api/bench/result/:jobId', (req, res) => {
  const { jobId } = req.params
  const job = jobs.get(jobId)
  if (!job) { res.status(404).json({ error: 'job not found' }); return }
  res.json(buildResult(job))
})

function buildResult(job: Job) {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    nodeResult: job.nodeResult,
    pythonResult: job.pythonResult,
    goResult: job.goResult,
    complexityResult: job.complexityResult,
    securityResult: job.securityResult,
    error: job.error,
    durationMs: job.finishedAt ? job.finishedAt - job.startedAt : Date.now() - job.startedAt,
  }
}

// ── Benchmark runner ───────────────────────────────────────────────────────

async function runBenchmark(
  job: Job,
  iterations: number,
  doNode: boolean,
  doPython: boolean,
  doGo: boolean,
  doComplexity = true,
  doSecurity = true,
) {
  job.status = 'running'
  emitSSE(job.id, 'status', { status: 'running' })

  const progress = (msg: string) => {
    job.progress.push(msg)
    emitSSE(job.id, 'progress', { message: msg })
    console.log(`[${job.id.slice(0, 8)}] ${msg}`)
  }

  try {
    if (doNode) {
      progress('━━ Node.js ベンチマーク開始 ━━')
      const nr = await runNodeBenchmarks(iterations, progress)
      job.nodeResult = nr
      emitSSE(job.id, 'node_done', nr)
    }

    if (doPython) {
      progress('━━ Python ベンチマーク開始 ━━')
      try {
        const pr = await runPythonBenchmark(iterations, progress)
        job.pythonResult = pr
        emitSSE(job.id, 'python_done', pr)
      } catch (e) {
        progress(`Python エラー: ${e}`)
        job.pythonResult = { error: String(e) }
      }
    }

    if (doGo) {
      progress('━━ Go ベンチマーク開始 ━━')
      try {
        const gr = await runGoBenchmark(iterations, progress)
        job.goResult = gr
        emitSSE(job.id, 'go_done', gr)
      } catch (e) {
        progress(`Go エラー: ${e}`)
        job.goResult = { error: String(e) }
      }
    }

    if (doComplexity) {
      progress('━━ 複雑性分析開始 ━━')
      try {
        const cr = await runNodeComplexity(Math.min(iterations, 50), progress)
        job.complexityResult = cr
        emitSSE(job.id, 'complexity_done', cr)
      } catch (e) {
        progress(`複雑性分析エラー: ${e}`)
        job.complexityResult = { error: String(e) }
      }
    }

    if (doSecurity) {
      progress('━━ セキュリティテスト開始 ━━')
      try {
        const sr = await runNodeSecurity(progress)
        job.securityResult = sr
        emitSSE(job.id, 'security_done', sr)
      } catch (e) {
        progress(`セキュリティテストエラー: ${e}`)
        job.securityResult = { error: String(e) }
      }
    }

    job.status = 'done'
    job.finishedAt = Date.now()
    progress(`✅ 全計測完了 (${((job.finishedAt - job.startedAt) / 1000).toFixed(1)}s)`)
    emitSSE(job.id, 'done', buildResult(job))

  } catch (e) {
    job.status = 'error'
    job.error = String(e)
    job.finishedAt = Date.now()
    progress(`❌ エラー: ${e}`)
    emitSSE(job.id, 'done', buildResult(job))
  }

  // Close SSE connections
  const clients = sseClients.get(job.id) ?? []
  for (const res of clients) { try { res.end() } catch { /* ok */ } }
  sseClients.delete(job.id)
}

// ── Start ──────────────────────────────────────────────────────────────────

const PORT = 3001
app.listen(PORT, () => {
  console.log(`\n🚀  Backend benchmark server running on http://localhost:${PORT}`)
  console.log(`    Node.js ${process.version} / ${process.platform} ${process.arch}`)
  console.log(`    POST /api/bench/start  →  start benchmark job`)
  console.log(`    GET  /api/bench/stream/:jobId  →  SSE progress stream\n`)
})
