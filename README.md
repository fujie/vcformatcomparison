# VC Format Comparison Tool

SD-JWT VC・JSON-LD VC・JSON-LD VC (JCS)・mdoc (ISO 18013-5) の4フォーマットを、署名検証速度・デシリアライズ複雑性・正規化セキュリティ・属性スケーリングなど多軸で定量比較するブラウザ完結型のベンチマークツールです。

## 比較対象フォーマット

| フォーマット | 規格 | シリアライズ | 署名アルゴリズム | 正規化 |
|---|---|---|---|---|
| **SD-JWT VC** | IETF RFC 9901 | JWT (テキスト) | EdDSA (Ed25519) | なし |
| **JSON-LD VC** | W3C VCDM 2.0 | JSON-LD (テキスト) | Ed25519 + SHA-256 | URDNA2015 (RDF) |
| **JSON-LD VC (JCS)** | W3C VCDM 2.0 | JSON-LD (テキスト) | Ed25519 + SHA-256 | JCS RFC 8785 |
| **mdoc** | ISO 18013-5 | CBOR (バイナリ) | ECDSA P-256 (ES256) | なし |

## セットアップ

```bash
git clone git@github.com:fujie/vcformatcomparison.git
cd vcformatcomparison
npm install
npm run dev        # フロントエンド (http://localhost:5173)
```

バックエンド計測を使用する場合は別ターミナルでサーバーも起動します。

```bash
npm run server     # バックエンドサーバー (http://localhost:3001)
```

両方を同時に起動するショートカット:

```bash
npm run dev:full   # Vite + バックエンドサーバーを並列起動
```

> **外部通信なし (フロントエンドモード)**: JSON-LD コンテキストはソースコードに静的埋め込みされており、ベンチマーク中に外部 URL へのリクエストは発生しません。

## 計測モード

### 🌐 ブラウザモード (デフォルト)

`performance.now()` (精度 ~0.1ms) でブラウザ内計測を行います。TypeScript / Go (WebAssembly) / Python (Pyodide) の3言語で実測値を取得します。

### 🖥 バックエンドモード

Node.js の `process.hrtime.bigint()` (精度 ナノ秒) でサーバーサイド計測を行います。Go ネイティブバイナリ・Python `time.perf_counter_ns()` も含めた3言語比較が可能です。バックエンドサーバー (`npm run server`) が起動している必要があります。

---

## ベンチマークタブ一覧

### ⚡ 署名検証速度

各フォーマットの sign / verify を指定イテレーション数で実行し、統計分布を計測します。

**計測内容**

| フォーマット | sign | verify |
|---|---|---|
| SD-JWT VC | `jose` SignJWT (EdDSA/Ed25519) | `jose` jwtVerify |
| JSON-LD VC | jsonld.normalize (URDNA2015) → SHA-256 → @noble/ed25519 sign | normalize → SHA-256 → ed25519 verify |
| JSON-LD VC (JCS) | JCS RFC 8785 正規化 → SHA-256 → @noble/ed25519 sign | JCS → SHA-256 → ed25519 verify |
| mdoc | CBOR encode → SHA-256 ダイジェスト → COSE_Sign1 (ECDSA P-256) | MSO デコード → ダイジェスト検証 → COSE 署名検証 |

**出力統計**

| 指標 | 説明 |
|---|---|
| ops/sec | 1秒あたりの処理回数 |
| 平均 (ms) | 全イテレーションの算術平均 |
| σ (ms) | 標準偏差 |
| 95%CI (ms) | 95% 信頼区間の半幅 (±) |
| p50 / p90 / p95 / p99 (ms) | パーセンタイルレイテンシ |
| min / max (ms) | 最小・最大値 |

バックエンドモードでは上記に加えて平均(ns)・σ(ns) がナノ秒精度で出力されます。

---

### 📐 デシリアライズ複雑性

最小限の検証実装に必要なコード複雑度を静的・動的に評価します。

| メトリクス | 説明 |
|---|---|
| LOC | 最小実装のコード行数 |
| 非同期ステップ数 | `await` が必要な処理の数 |
| 循環的複雑度 | 条件分岐の個数 |
| 外部ネットワーク呼び出し | 実行時に外部 URL へリクエストが発生する回数 |
| パース時間 (ms) | デシリアライズの実測レイテンシ |

---

### 🔐 正規化セキュリティ

各フォーマットに対して実際に攻撃ベクターを実行し、脆弱/緩和済み/N-A を判定します。

| テスト ID | テスト名 | 対象 | カテゴリ |
|---|---|---|---|
| S1 | ポイズングラフ DoS (URDNA2015) | JSON-LD VC | DoS |
| S2 | JSON-LD コンテキストインジェクション | JSON-LD VC | ContextHijack |
| S3 | リモートコンテキスト経由 SSRF | JSON-LD VC | SSRF |
| S4 | alg:none 攻撃 | SD-JWT VC | AlgorithmConfusion |
| S5 | アルゴリズム混同 RS256→EdDSA | SD-JWT VC | AlgorithmConfusion |
| S6 | mdoc データ要素改ざん検出 | mdoc | CborMalleability |
| S7 | COSE プロテクトヘッダー改ざん | mdoc | AlgorithmConfusion |
| S8 | SSRF リスク評価 | mdoc | SSRF |

---

### 🔤 実装比較 (ライブラリなし vs あり)

ライブラリ有無でのパフォーマンス差と、TypeScript / Go / Python の言語間比較を行います。

- **TypeScript**: ブラウザ内実測 (ライブラリあり/なしの両方)
- **Go**: Go WebAssembly (`go/bench-native/main.go` を `GOOS=js GOARCH=wasm` でビルド、標準ライブラリのみ使用)
- **Python**: Pyodide (CPython 3.12 on WebAssembly、`cryptography` / `PyJWT` / `pyld` / `cbor2` を micropip でインストール)

Go WASM と Python (Pyodide) の計測は「ベンチマーク実行」ボタン押下時に自動実行されます。初回はバイナリのロードに数秒かかります。

---

### 📊 詳細分析

5種類の応用ベンチマークを実行します。「詳細分析タブ」の「詳細分析ベンチマーク実行」ボタンで開始します。

#### 1. 属性数スケーリング

5 / 20 / 100 / 500 属性で各フォーマットのシリアライズ速度を計測し、属性数増加に対する性能スケーリングを比較します。

#### 2. JSON-LD コンテキストローダー比較

| ローダー種別 | 内容 |
|---|---|
| 静的ローダー | コンテキストを静的に事前ロード。SSRF リスクなし。 |
| リモートローダー (シミュレーション) | 50ms のネットワーク遅延を付加。実際の外部リクエストは発生しない。 |

リモートコンテキストローダー使用時の性能コストと SSRF 攻撃面を定量化します。

#### 3. URDNA2015 call limit 有無比較

2 / 4 / 6 / 8 ノードのブランクノード循環グラフでポイズングラフを生成し、タイムアウトの有無でレイテンシと保護動作を比較します。

- **タイムアウトなし**: 計算量爆発による DoS を再現
- **タイムアウトあり (`Promise.race` 2000ms)**: DoS 緩和動作を確認

#### 4. 選択的開示性能比較

20属性クレデンシャルから N 属性を開示するプレゼンテーション生成レイテンシを比較します。

| フォーマット | 開示メカニズム |
|---|---|
| SD-JWT VC | SHA-256 ハッシュ済みディスクロージャー (`_sd` 配列) — RFC 9901 準拠 |
| JSON-LD VC | URDNA2015 で派生クレデンシャル (開示属性のみ) を再正規化 |
| JSON-LD VC (JCS) | JCS で開示属性サブセットのドキュメントを再正規化 |
| mdoc | IssuerSigned nameSpace から開示要素のみを CBOR エンコード |

#### 5. Ed25519 統一ベンチマーク

通常 ECDSA P-256 を使用する mdoc も EdDSA (Ed25519) で統一計測することで、暗号アルゴリズムの差を排除し、シリアライゼーション形式 (JWT vs JSON-LD vs CBOR) の純粋なオーバーヘッドを分離します。

---

## 結果レポート

「📋 結果レポート」タブでは、実行済みのすべてのベンチマーク結果を一覧表示し、以下の形式でエクスポートできます。

| エクスポート形式 | 内容 |
|---|---|
| Markdown コピー | GitHub / Obsidian 等に貼り付け可能な表形式 |
| CSV コピー / ダウンロード | Excel / Google Sheets で分析可能 |
| JSON コピー / ダウンロード | 生データ (全統計フィールド含む) |

**レポートに含まれるセクション** (実行済みのものだけ出力):

1. テスト実行環境 (ブラウザ / OS / CPU / Go WASM / Pyodide バージョン)
2. 署名検証速度 (全統計分布)
3. デシリアライズ複雑性
4. セキュリティテスト
5. ライブラリなし vs あり — 言語別比較
6. シリアライズ速度
7. 属性数スケーリング
8. JSON-LD コンテキストローダー比較
9. URDNA2015 call limit 有無比較
10. 選択的開示性能比較
11. Ed25519 統一ベンチマーク
12. 実際の実行コード (TypeScript / Go / Python)

---

## ディレクトリ構成

```
.
├── src/
│   ├── benchmarks/
│   │   ├── signatureSpeed.ts            # 署名検証速度ベンチマーク
│   │   ├── deserializationComplexity.ts # デシリアライズ複雑性
│   │   ├── normalizationSecurity.ts     # セキュリティテスト
│   │   ├── noLibrary.ts                 # ライブラリなし実装ベンチマーク
│   │   └── scalingBenchmarks.ts         # 詳細分析 (属性スケーリング等)
│   ├── components/
│   │   ├── SpeedResults.tsx             # 署名検証速度タブ
│   │   ├── ComplexityResults.tsx        # デシリアライズ複雑性タブ
│   │   ├── SecurityResults.tsx          # セキュリティタブ
│   │   ├── ImplComparison.tsx           # 実装比較タブ
│   │   ├── ScalingResults.tsx           # 詳細分析タブ
│   │   └── ReportView.tsx               # 結果レポートタブ (エクスポート)
│   ├── data/
│   │   ├── staticContexts.ts            # 静的埋め込み JSON-LD コンテキスト
│   │   ├── referenceValues.ts           # Go / Python 参考値
│   │   └── benchmarkSources.ts          # エクスポート用実行コード
│   ├── lib/
│   │   ├── goRunner.ts                  # Go WASM 実行ランナー
│   │   └── pyodideRunner.ts             # Pyodide (Python) 実行ランナー
│   └── types/
│       └── backendResult.ts             # バックエンド API レスポンス型定義
├── server/
│   ├── index.ts                         # Express サーバー (SSE ジョブキュー)
│   └── bench/
│       ├── nodeSpeed.ts                 # Node.js 署名速度 (process.hrtime.bigint)
│       ├── nodeComplexity.ts            # Node.js 複雑性計測
│       ├── nodeSecurity.ts              # Node.js セキュリティテスト
│       └── speed.py                     # Python 速度計測 (time.perf_counter_ns)
├── go/
│   └── bench-native/
│       └── main.go                      # Go WASM ビルドターゲット
├── public/
│   ├── go-bench.wasm                    # ビルド済み Go WASM バイナリ
│   └── wasm_exec.js                     # Go WASM ランタイムブリッジ
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 使用ライブラリ

| ライブラリ | バージョン | 用途 |
|---|---|---|
| `jose` | 6.x | SD-JWT VC の JWS 署名・検証 (EdDSA) |
| `@noble/ed25519` | 2.x | JSON-LD VC の Ed25519 署名・検証 |
| `@noble/hashes` | 1.x | SHA-256 / SHA-512 |
| `jsonld` | 8.x | JSON-LD URDNA2015 正規化 |
| `cbor-x` | 1.x | mdoc の CBOR エンコード・デコード |
| `recharts` | 2.x | ベンチマーク結果のグラフ描画 |
| `react` / `react-dom` | 18.x | UI フレームワーク |
| `express` | 4.x | バックエンドサーバー |
| `tsx` | — | TypeScript の直接実行 (バックエンド用) |

**Python (Pyodide / バックエンド)**: `cryptography`, `PyJWT`, `pyld`, `cbor2`, `cachetools`, `lxml`

**Go**: 標準ライブラリのみ (`crypto/ecdsa`, `crypto/ed25519`, `crypto/sha256`, `encoding/base64`, `crypto/elliptic`)

---

## Go WASM のビルド方法

リポジトリにビルド済みの `public/go-bench.wasm` が含まれているため通常はビルド不要です。再ビルドする場合:

```bash
cd go/bench-native
GOOS=js GOARCH=wasm go build -o ../../public/go-bench.wasm .
```

---

## バックエンドサーバー API

| エンドポイント | メソッド | 説明 |
|---|---|---|
| `/api/bench/start` | POST | ベンチマークジョブを開始。`jobId` を返す |
| `/api/bench/stream/:jobId` | GET | SSE ストリームで進捗・完了を受信 |
| `/api/bench/result/:jobId` | GET | ジョブ結果をポーリングで取得 |

リクエストボディ例:

```json
{
  "iterations": 100,
  "runNode": true,
  "runPython": true,
  "runGo": true,
  "runComplexity": true,
  "runSecurity": true
}
```

---

## 設計上の注意点

### JSON-LD の `safe` オプション

`jsonld` v8 の `normalize()` はデフォルトで `safe: true` が有効です。本ツールのベンチマークでは `safe: false` を使用する箇所があります。本番実装では `safe: true` のまま使用してください。`safe: true` は未定義用語が署名対象からサイレントに除外されることを防ぎます。

### URDNA2015 の call limit

ポイズングラフ (blank node cycle) により URDNA2015 の計算量が爆発的に増加します。本番実装では必ず call limit またはタイムアウトを設けてください。本ツールでは `Promise.race` + 2000ms タイムアウトで緩和効果を実証しています。

### コンテキストローダーと SSRF

JSON-LD の `documentLoader` にリモート URL フェッチを許可すると、攻撃者が制御するコンテキストを読み込ませる SSRF 攻撃が可能になります。フロントエンドモードでは静的ローダーのみを使用します。

### mdoc の実装範囲

本ツールの mdoc 実装はベンチマーク目的のため IssuerSigned の基本パスのみを実装しており、デバイス署名・X.509 証明書チェーン検証・Session Transcript・DeviceResponse の完全な検証フローは省略しています。

---

## 参照規格

- [IETF RFC 9901 — SD-JWT VC](https://www.rfc-editor.org/rfc/rfc9901)
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C RDF Dataset Canonicalization (RDFC-1.0 / URDNA2015)](https://www.w3.org/TR/rdf-canon/)
- [ISO/IEC 18013-5 — mDL (mdoc)](https://www.iso.org/standard/69084.html)
- [IETF RFC 8785 — JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
- [IETF RFC 9052 — COSE: Structures and Process](https://www.rfc-editor.org/rfc/rfc9052)
- [IETF RFC 8725 — JWT Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
- [W3C VC Data Integrity — eddsa-rdfc-2022 / eddsa-jcs-2022](https://www.w3.org/TR/vc-di-eddsa/)
