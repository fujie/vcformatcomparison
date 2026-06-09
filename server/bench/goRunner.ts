/**
 * Spawns the native Go benchmark binary (go/bench-native/bench-native).
 * If binary not found, tries `go run` as fallback.
 */

import { spawn, execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

const BINARY_PATH = path.join(PROJECT_ROOT, 'go', 'bench-native', 'bench-native')
const SOURCE_DIR = path.join(PROJECT_ROOT, 'go', 'bench-native')

export interface GoBenchResults {
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

export async function runGoBenchmark(
  iterations: number,
  onProgress: (msg: string) => void,
): Promise<GoBenchResults> {
  // Check if pre-built binary exists
  const hasBinary = fs.existsSync(BINARY_PATH)

  if (!hasBinary) {
    onProgress('Go バイナリを自動ビルド中 (go build)...')
    await buildBinary()
    onProgress('Go バイナリビルド完了')
  }

  onProgress(`Go ネイティブバイナリ実行中 — ${iterations} iterations`)

  return new Promise((resolve, reject) => {
    const args = [String(iterations)]
    const proc = spawn(BINARY_PATH, args)

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim()
      if (msg) {
        console.error('[Go stderr]', msg)
        onProgress(`Go: ${msg}`)
      }
      stderr += msg
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Go process exited with code ${code}. stderr: ${stderr}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as GoBenchResults
        onProgress(`Go 完了 — ${Object.keys(parsed.results).length} 項目計測`)
        resolve(parsed)
      } catch (e) {
        reject(new Error(`Go JSON parse error: ${e}\nstdout: ${stdout}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Go バイナリ起動失敗: ${err.message}`))
    })
  })
}

function buildBinary(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('go', ['build', '-o', BINARY_PATH, '.'], {
      cwd: SOURCE_DIR,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`go build failed: ${stderr || err.message}`))
      } else {
        resolve()
      }
    })
  })
}
