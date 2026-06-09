/**
 * Spawns the Python benchmark script as a child process.
 * Captures stdout (JSON results) and stderr (progress messages).
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface PyBenchResults {
  results: Record<string, {
    opsPerSec: number
    avgMs: number
    avgNs: number
    iterations: number
    isActual: boolean
  }>
  errors: Record<string, string>
  iterations: number
  runtimeInfo: string
}

export async function runPythonBenchmark(
  iterations: number,
  onProgress: (msg: string) => void,
): Promise<PyBenchResults> {
  const scriptPath = path.join(__dirname, 'speed.py')

  // Detect python3 or python
  const pythonCmd = await detectPython()
  onProgress(`Python (${pythonCmd}) ベンチマーク開始 — ${iterations} iterations`)

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonCmd, [scriptPath, String(iterations)], {
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim()
      if (msg) {
        console.error('[Python stderr]', msg)
        onProgress(`Python: ${msg}`)
      }
      stderr += msg
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}. stderr: ${stderr}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as PyBenchResults
        onProgress(`Python 完了 — ${Object.keys(parsed.results).length} 項目計測`)
        resolve(parsed)
      } catch (e) {
        reject(new Error(`Python JSON parse error: ${e}\nstdout: ${stdout}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Python プロセス起動失敗: ${err.message}\n` +
        'python3 および cryptography パッケージがインストールされているか確認してください。\n' +
        'pip install cryptography'))
    })
  })
}

async function detectPython(): Promise<string> {
  for (const cmd of ['python3', 'python']) {
    try {
      await new Promise<void>((resolve, reject) => {
        const p = spawn(cmd, ['--version'])
        p.on('close', (code) => code === 0 ? resolve() : reject())
        p.on('error', reject)
      })
      return cmd
    } catch { /* try next */ }
  }
  throw new Error('Python が見つかりません。python3 をインストールしてください。')
}
