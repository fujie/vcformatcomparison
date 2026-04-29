# VC Format Comparison Tool

SD-JWT VC・JSON-LD VC・mdoc (ISO 18013-5) の3フォーマットを、署名検証速度・デシリアライズ複雑性・正規化セキュリティの3軸で定量比較するブラウザ完結型のベンチマークツールです。

## スクリーンショット

### 署名検証速度タブ
- 各フォーマットの sign / verify の ops/sec・平均レイテンシをバーチャートで比較
- JSON-LD VC の署名ステップ内訳（正規化 / ハッシュ / 署名）を個別表示

### デシリアライズ複雑性タブ
- コード行数 (LOC)・非同期ステップ数・循環的複雑度・外部ネットワーク呼び出し数・パース時間を比較
- 各フォーマットの実装コードを並列表示

### 正規化セキュリティタブ
- ポイズングラフ DoS・コンテキストインジェクション・SSRF・アルゴリズム混同・CBOR マリアビリティを実際に実行して判定
- フォーマット別リスクスコアとマトリクス表示

## 比較対象フォーマット

| フォーマット | 規格 | シリアライズ | 署名アルゴリズム | 正規化 |
|---|---|---|---|---|
| **SD-JWT VC** | IETF RFC 9901 | JWT (テキスト) | EdDSA (Ed25519) | なし |
| **JSON-LD VC** | W3C VCDM 2.0 | JSON-LD (テキスト) | Ed25519 + SHA-256 | URDNA2015 (RDF) |
| **mdoc** | ISO 18013-5 | CBOR (バイナリ) | ECDSA P-256 (ES256) | なし |

## 計測項目

### 1. 署名検証速度 (⚡)

`performance.now()` でブラウザ内ベンチマークを実行し、ops/sec と平均レイテンシを測定します。

- **SD-JWT VC**: `jose` の `SignJWT` / `jwtVerify` を使用した EdDSA 署名
- **JSON-LD VC**: `jsonld.normalize()` (URDNA2015) → SHA-256 → `@noble/ed25519` で署名
- **mdoc**: CBOR エンコード → SHA-256 ダイジェスト (要素単位) → COSE_Sign1 (ECDSA P-256)

### 2. デシリアライズ複雑性 (📐)

| メトリクス | 説明 |
|---|---|
| **コード行数 (LOC)** | 最小限の検証実装に必要な行数 |
| **非同期ステップ数** | `await` が必要な処理の数 |
| **循環的複雑度** | 条件分岐の数 (分岐点の個数) |
| **外部ネットワーク呼び出し** | 実行時に外部 URL へのリクエストが発生する回数 |
| **パース時間** | 50 イテレーション平均のデシリアライズ時間 |

### 3. 正規化セキュリティ (🔐)

| テスト | 対象 | カテゴリ |
|---|---|---|
| ポイズングラフ DoS (URDNA2015) | JSON-LD VC | DoS |
| JSON-LD コンテキストインジェクション | JSON-LD VC | コンテキストハイジャック |
| リモートコンテキスト経由 SSRF | JSON-LD VC | SSRF |
| alg:none 攻撃 | SD-JWT VC | アルゴリズム混同 |
| アルゴリズム混同 RS256→EdDSA | SD-JWT VC | アルゴリズム混同 |
| mdoc データ要素改ざん検出 | mdoc | CBOR マリアビリティ |
| COSE プロテクトヘッダー改ざん | mdoc | アルゴリズム混同 |
| SSRF なし・ネットワーク取得なし | mdoc | SSRF |

## 使用ライブラリ

| ライブラリ | バージョン | 用途 |
|---|---|---|
| `jose` | 6.x | SD-JWT VC の JWS 署名・検証 (EdDSA) |
| `@noble/ed25519` | 2.x | JSON-LD VC の Ed25519 署名・検証 |
| `@noble/hashes` | 1.x | SHA-512 (noble/ed25519 の依存) |
| `jsonld` | 8.x | JSON-LD エクスパンション・URDNA2015 正規化 |
| `cbor-x` | 1.x | mdoc の CBOR エンコード・デコード |
| `recharts` | 2.x | ベンチマーク結果のグラフ描画 |
| `react` / `react-dom` | 18.x | UI フレームワーク |

## セットアップ

```bash
git clone <repo>
cd vc-comparison-tool
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開き、「ベンチマーク実行」ボタンを押すとすべての計測が始まります。

> **外部通信なし**: JSON-LD コンテキストはソースコードに静的埋め込みされており、ベンチマーク中に外部 URL へのリクエストは発生しません。

## ビルド

```bash
npm run build    # dist/ に静的ファイルを出力
npm run preview  # ビルド結果をローカルで確認
```

## ディレクトリ構成

```
src/
├── benchmarks/
│   ├── signatureSpeed.ts          # 署名検証速度ベンチマーク
│   ├── deserializationComplexity.ts # デシリアライズ複雑性分析
│   └── normalizationSecurity.ts   # セキュリティテスト
├── components/
│   ├── SpeedResults.tsx           # 速度タブ UI
│   ├── ComplexityResults.tsx      # 複雑性タブ UI
│   └── SecurityResults.tsx        # セキュリティタブ UI
├── data/
│   └── staticContexts.ts          # 静的埋め込み JSON-LD コンテキスト
└── lib/
    ├── cryptoUtils.ts             # Ed25519 / SHA-256 ユーティリティ
    └── mdocUtils.ts               # mdoc (CBOR + COSE_Sign1) 実装
```

## 設計上の注意点

### JSON-LD の `safe: false` について

`jsonld` v8 の `normalize()` はデフォルトで `safe: true` (安全モード) が有効です。このモードでは、コンテキストにマップされていない用語が存在するとエラーになります。本ツールのベンチマークでは `safe: false` を設定して実行しています。

**本番環境では `safe: true` (デフォルト) のまま使用するか、ドキュメントのコンテキストを完全に定義してください。** `safe: true` でエラーになる場合、未定義用語が署名対象から**サイレントに除外される**ことを防いでいます。これを無効化すると署名対象フィールドが意図せず変わるリスクがあります。

### mdoc の実装範囲

`src/lib/mdocUtils.ts` は ISO 18013-5 の構造を忠実に再現していますが、以下は省略しています。

- デバイス署名 (Device Signed) / デバイス認証
- MSO の X.509 証明書チェーン検証
- Session Transcript / Engagement
- Selective Disclosure の提示フロー

ベンチマーク目的の実装のため、発行 (IssuerSigned) と検証の基本パスのみを実装しています。

## 参照規格

- [IETF RFC 9901 — SD-JWT VC](https://www.rfc-editor.org/rfc/rfc9901)
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C RDF Dataset Canonicalization (RDFC-1.0)](https://www.w3.org/TR/rdf-canon/)
- [ISO/IEC 18013-5 — mDL (mdoc)](https://www.iso.org/standard/69084.html)
- [IETF RFC 9052 — COSE: Structures and Process](https://www.rfc-editor.org/rfc/rfc9052)
- [IETF RFC 8725 — JWT Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
