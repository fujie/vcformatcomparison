const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, TabStopType, TabStopPosition,
  FootnoteReferenceRun, ImageRun
} = require("docx");

// ── Helpers ──────────────────────────────────────────────────────────
const DXA_INCH = 1440;
const PAGE_W = 12240;
const PAGE_H = 15840;
const MARGIN = DXA_INCH;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function bodyPara(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 360 },
    indent: { firstLine: 480 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
    children: [new TextRun({ text, font: "Times New Roman", size: 22 })],
  });
}

function bodyRuns(parts, opts = {}) {
  const children = parts.map(part => {
    const r = { font: "Times New Roman", size: part.size || 22 };
    if (part.bold) r.bold = true;
    if (part.italics) r.italics = true;
    if (part.superScript) r.superScript = true;
    r.text = part.text;
    return new TextRun(r);
  });
  return new Paragraph({
    spacing: { after: 120, line: 360 },
    indent: { firstLine: 480 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
    children,
  });
}

// bodyPara without first-line indent (for continuation paragraphs)
function bodyParaFlat(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 360 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
    children: [new TextRun({ text, font: "Times New Roman", size: 22 })],
  });
}

function bodyRunsFlat(parts, opts = {}) {
  const children = parts.map(part => {
    const r = { font: "Times New Roman", size: part.size || 22 };
    if (part.bold) r.bold = true;
    if (part.italics) r.italics = true;
    if (part.superScript) r.superScript = true;
    r.text = part.text;
    return new TextRun(r);
  });
  return new Paragraph({
    spacing: { after: 120, line: 360 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
    children,
  });
}


function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, font: "Times New Roman", size: 26, bold: true })],
  });
}

function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text, font: "Times New Roman", size: 24, bold: true })],
  });
}

function heading3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, font: "Times New Roman", size: 22, bold: true })],
  });
}

function emptyLine() {
  return new Paragraph({ spacing: { after: 60 }, children: [] });
}

function makeTable(headers, rows, colWidths) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const headerCells = headers.map((h, i) =>
    new TableCell({
      borders,
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { fill: "E8E8E8", type: ShadingType.CLEAR },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: h, bold: true, font: "Times New Roman", size: 20 })]
      })]
    })
  );
  const dataRows = rows.map(row =>
    new TableRow({
      children: row.map((cell, i) =>
        new TableCell({
          borders,
          width: { size: colWidths[i], type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({
            alignment: typeof cell === "number" || /^[\d.,]+$/.test(String(cell)) ? AlignmentType.CENTER : AlignmentType.LEFT,
            children: [new TextRun({ text: String(cell), font: "Times New Roman", size: 20 })]
          })]
        })
      )
    })
  );
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [new TableRow({ children: headerCells }), ...dataRows],
  });
}

// Code block helper: renders monospace lines with a light grey background
function codeBlock(lines) {
  const bgShading = { fill: "F5F5F5", type: ShadingType.CLEAR };
  const result = [];
  // Top border line
  result.push(new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 1 } },
    spacing: { before: 120, after: 0 },
    indent: { left: 360, right: 360 },
    shading: bgShading,
    children: [],
  }));
  for (const line of lines) {
    result.push(new Paragraph({
      spacing: { after: 0, line: 260 },
      indent: { left: 360, right: 360 },
      shading: bgShading,
      children: [new TextRun({ text: line || " ", font: "Courier New", size: 17 })],
    }));
  }
  // Bottom border line
  result.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 1 } },
    spacing: { before: 0, after: 120 },
    indent: { left: 360, right: 360 },
    shading: bgShading,
    children: [],
  }));
  return result;
}

function listingCaption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, font: "Times New Roman", size: 20, bold: true })],
  });
}

function tableCaption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, font: "Times New Roman", size: 20, bold: true })],
  });
}

// ── References ───────────────────────────────────────────────────────
const references = [
  "[1] D. Fett, K. Yasuda, and B. Campbell, \"SD-JWT-based Verifiable Credentials (SD-JWT VC),\" IETF RFC 9901, 2024.",
  "[2] M. Sporny, D. Longley, and D. Chadwick, \"Verifiable Credentials Data Model v2.0,\" W3C Recommendation, 2024.",
  "[3] ISO/IEC 18013-5:2021, \"Personal identification — ISO-compliant driving licence — Part 5: Mobile driving licence (mDL) application,\" 2021.",
  "[4] D. Longley and M. Sporny, \"RDF Dataset Canonicalization (RDFC-1.0),\" W3C Recommendation, 2024.",
  "[5] Y. Sheffer, D. Hardt, and M. Jones, \"JSON Web Token Best Current Practices,\" IETF RFC 8725, 2020.",
  "[6] J. Schaad, \"CBOR Object Signing and Encryption (COSE): Structures and Process,\" IETF RFC 9052, 2022.",
  "[7] D. Fett, B. Campbell, J. Bradley, T. Lodderstedt, M. Jones, and D. Waite, \"Selective Disclosure for JWTs (SD-JWT),\" IETF RFC 9449, 2024.",
  "[8] T. McLaughlin, \"CVE-2015-9235: ‘None’ Algorithm Vulnerability in JWT Libraries,\" NVD, 2015.",
  "[9] W3C, \"RDF Dataset Canonicalization — Security Considerations,\" in RDF Dataset Canonicalization (RDFC-1.0), §4.8, W3C Recommendation, 2024. [Online]. Available: https://www.w3.org/TR/rdf-canon/#security-considerations",
  "[10] D. Longley, M. Sporny, and G. Kellogg, \"Data Integrity 1.0,\" W3C Working Draft, 2024.",
  "[11] M. Jones, J. Bradley, and N. Sakimura, \"JSON Web Token (JWT),\" IETF RFC 7519, 2015.",
  "[12] C. Bormann and P. Hoffman, \"Concise Binary Object Representation (CBOR),\" IETF RFC 8949, 2020.",
  "[13] D. Temoshok, D. Proud-Madruga, Y.-Y. Choong, R. Galluzzo, S. Gupta, C. LaSalle, N. Lefkovitz, and A. Regenscheid, \"Digital Identity Guidelines,\" NIST SP 800-63-4, 2025.",
  "[14] N. Fujie, \"VC Format Comparison Tool,\" GitHub, 2024–2026. [Online]. Available: https://github.com/fujie/vcformatcomparison",
  "[15] A. Buldini, C. Mazzocca, R. Montanari, and S. Uluagac, \"Compact and Selective Disclosure for Verifiable Credentials,\" arXiv:2506.00262, 2025.",
  "[16] S. Abraham, S. More, et al., \"DID and VC: Untangling Decentralized Identifiers and Verifiable Credentials for the Web of Trust,\" in Proc. ACM CODASPY, 2021, pp. 169–180.",
  "[17] A. Helm, T. Lodderstedt, and K. Yasuda, \"Selective-Disclosure in Decentralised Identity: A Comparative Evaluation of BBS+ and SD-JWT,\" TechRxiv, 2025.",
  "[18] European Parliament, \"Regulation (EU) 2024/1183 amending Regulation (EU) No 910/2014 as regards establishing the European Digital Identity Framework (eIDAS 2.0),\" Official Journal of the European Union, 2024.",
  "[19] 1EdTech Consortium, \"Open Badges Specification v3.0,\" 1EdTech Final Release, 2024. [Online]. Available: https://www.imsglobal.org/spec/ob/v3p0/",
  "[20] Digital Credentials Consortium, \"Digital Credentials Consortium — Building the digital credential infrastructure for the future,\" MIT, 2024. [Online]. Available: https://digitalcredentials.mit.edu/",
];

// ── Document ─────────────────────────────────────────────────────────

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Times New Roman", size: 22 } },
    },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Times New Roman" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Times New Roman" },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Times New Roman" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 },
      },
    ],
  },
  footnotes: {
    1: { children: [new Paragraph({ children: [new TextRun({ text: "URDNA2015の最悪計算量については、W3C RDFC-1.0仕様 §4.8.3を参照。", font: "Times New Roman", size: 18 })] })] },
    2: { children: [new Paragraph({ children: [new TextRun({ text: "CVE-2015-9235として登録されている既知の脆弱性。", font: "Times New Roman", size: 18 })] })] },
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: "Verifiable Credentialフォーマット比較における実証的評価", font: "Times New Roman", size: 18, italics: true, color: "888888" })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT], font: "Times New Roman", size: 20 })],
        })],
      }),
    },
    children: [
      // ══════════════════════════════════════════════════════════
      // TITLE
      // ══════════════════════════════════════════════════════════
      emptyLine(),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: "Verifiable Credentialフォーマットの再現可能なベンチマークとセキュリティ分析：", font: "Times New Roman", size: 32, bold: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({ text: "SD-JWT VC、JSON-LD VC、mdocの比較", font: "Times New Roman", size: 28, bold: true })],
      }),
      emptyLine(),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [new TextRun({ text: "A Reproducible Benchmark and Security Analysis of Verifiable Credential Formats:", font: "Times New Roman", size: 26, italics: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: "Comparing SD-JWT VC, JSON-LD VC, and mdoc", font: "Times New Roman", size: 24, italics: true })],
      }),
      emptyLine(),
      // AUTHORS
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [
          new TextRun({ text: "富士榮 尚寛", font: "Times New Roman", size: 24, bold: true }),
          new TextRun({ text: "¹ ²", font: "Times New Roman", size: 24, superScript: true }),
          new TextRun({ text: "　　", font: "Times New Roman", size: 24 }),
          new TextRun({ text: "鈴木 茂哉", font: "Times New Roman", size: 24, bold: true }),
          new TextRun({ text: "³", font: "Times New Roman", size: 24, superScript: true }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: [
          new TextRun({ text: "Naohiro Fujie", font: "Times New Roman", size: 20, italics: true }),
          new TextRun({ text: "          ", font: "Times New Roman", size: 20 }),
          new TextRun({ text: "Shigeya Suzuki", font: "Times New Roman", size: 20, italics: true }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: [
          new TextRun({ text: "¹ ", font: "Times New Roman", size: 18, superScript: true }),
          new TextRun({ text: "伊藤忠テクノソリューションズ株式会社 みらい研究所", font: "Times New Roman", size: 18 }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: [
          new TextRun({ text: "² ", font: "Times New Roman", size: 18, superScript: true }),
          new TextRun({ text: "一般社団法人OpenIDファウンデーションジャパン", font: "Times New Roman", size: 18 }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: [
          new TextRun({ text: "³ ", font: "Times New Roman", size: 18, superScript: true }),
          new TextRun({ text: "慶應義塾大学", font: "Times New Roman", size: 18 }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [
          new TextRun({ text: "naohiro.fujie@ctc-g.co.jp", font: "Times New Roman", size: 18, italics: true }),
          new TextRun({ text: "     ", font: "Times New Roman", size: 18 }),
          new TextRun({ text: "shigeya@wide.ad.jp", font: "Times New Roman", size: 18, italics: true }),
        ],
      }),
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "333333", space: 1 } },
        spacing: { after: 300 },
        children: [],
      }),

      // ══════════════════════════════════════════════════════════
      // ABSTRACT
      // ══════════════════════════════════════════════════════════
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: "概要", font: "Times New Roman", size: 24, bold: true })],
      }),
      new Paragraph({
        spacing: { after: 80, line: 340 },
        alignment: AlignmentType.JUSTIFIED,
        indent: { left: 480, right: 480 },
        children: [new TextRun({
          text: "本稿では、検証可能なデジタルクレデンシャル（Verifiable Credential: VC）の主要3フォーマット——SD-JWT VC（IETF RFC 9901）、JSON-LD VC（W3C VCDM 2.0）、mdoc（ISO/IEC 18013-5）——について、署名検証性能・デシリアライズおよび検証実装複雑性・正規化セキュリティの3軸で実証的比較評価を行った。ベンチマークはSMT無効化・CPUコア固定を施した専用Linuxサーバ（AMD EPYC 7763）上で、Node.js・Go・Pythonの3言語を同一環境・同一手法で計測し、ナノ秒精度タイマによるN=2,000×独立5回実行の統計量中央値に基づく（外れ値はTukey基準で検出・報告し、代表値には中央値p50を用いる）。署名速度ではSD-JWT VCが最速（p50: 0.038 ms/op）、mdoc（0.077 ms/op）、JSON-LD VCが0.101 ms/opであった。検証速度ではmdocが最速（p50: 0.090 ms/op）、SD-JWT VCが0.117 ms/op、JSON-LD VCが0.178 ms/op（SD-JWT VC比約1.5倍）であった。属性数スケーリング評価では、JSON-LD VCのURDNA2015正規化が500属性でSD-JWT VCの約37倍と線形以上の増大を示した。さらに、実運用の教育スキーマ（1EdTech OpenBadges v3.0、DCC型学位クレデンシャル）を用いた評価では、ブランクノードを含む複雑なクレデンシャルの正規化が単純なクレデンシャルの約22〜41倍に達し、実運用スキーマではURDNA2015正規化が検証パイプラインの支配的コストとなることを示した。Ed25519統一ベンチマークにより、署名アルゴリズムの差と検証パイプライン（正規化・前処理）の差を分離して評価し、署名はSD-JWT VCが同一アルゴリズム条件でも最速である一方、検証はSD-JWT VCとmdocが同等となり、mdocのデフォルト構成における検証の高速性はECDSA P-256/COSE構成に部分的に依存することを確認した。実装複雑性分析では、JSON-LD VCの循環的複雑度が8と最も高く、外部ネットワーク依存が存在することを確認した。セキュリティ評価では、JSON-LD/RDFC系の検証パイプラインがリモートコンテキスト解決やURDNA2015正規化に由来する追加の攻撃面を持ち、適切な緩和策（document loader制限、call limit設定等）を欠く実装ではDoS・コンテキストインジェクション・SSRFのリスクが顕在化し得ることを確認した。SD-JWT VCおよびmdocは、本稿で評価した攻撃ベクトルの範囲において、標準的な検証設定で耐性を示した。実験ツールはオープンソースで公開しており、再現可能な評価フレームワークとして、実装者・標準化関係者のフォーマット選定に資することを目的とする。",
          font: "Times New Roman", size: 20,
        })],
      }),
      emptyLine(),
      new Paragraph({
        spacing: { after: 80 },
        indent: { left: 480, right: 480 },
        children: [
          new TextRun({ text: "キーワード：", font: "Times New Roman", size: 20, bold: true }),
          new TextRun({ text: "Verifiable Credentials, SD-JWT, JSON-LD, mdoc, 署名検証, RDF正規化, URDNA2015, セキュリティ評価", font: "Times New Roman", size: 20, italics: true }),
        ],
      }),
      emptyLine(),

      // ENGLISH ABSTRACT
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: "Abstract", font: "Times New Roman", size: 24, bold: true, italics: true })],
      }),
      new Paragraph({
        spacing: { after: 80, line: 340 },
        alignment: AlignmentType.JUSTIFIED,
        indent: { left: 480, right: 480 },
        children: [new TextRun({
          text: "This paper presents an empirical comparative evaluation of three major Verifiable Credential (VC) formats and their verification pipelines: SD-JWT VC (IETF RFC 9901), JSON-LD VC (W3C VCDM 2.0), and mdoc (ISO/IEC 18013-5). The evaluation encompasses three dimensions: signature verification performance, deserialization and verification implementation complexity, and canonicalization security. Benchmarks are performed on a dedicated Linux server (AMD EPYC 7763, SMT disabled, pinned core), measuring Node.js, Go, and Python under an identical environment and methodology with nanosecond-precision timers, N=2,000 iterations across five independent runs, reporting the median of each statistic; outliers are detected via Tukey fences and reported without removal, and the median (p50) serves as the primary statistic. SD-JWT VC achieves the fastest signing (p50: 0.038 ms/op), while mdoc achieves the fastest verification (p50: 0.090 ms/op) followed by SD-JWT VC (0.117 ms/op). JSON-LD VC exhibits the highest latency (sign: 0.101 ms/op, verify: 0.178 ms/op, about 1.5x SD-JWT VC). Attribute scaling evaluation demonstrates that JSON-LD URDNA2015 canonicalization grows superlinearly, reaching about 37x SD-JWT VC at 500 attributes. Evaluation with production education schemas (1EdTech Open Badges v3.0 and a DCC-style academic credential) further shows that canonicalizing complex credentials containing blank nodes costs 22-41x more than a simple credential, making URDNA2015 the dominant cost of the verification pipeline for real-world schemas. An Ed25519 unified benchmark separates the effects of signature algorithm selection from verification pipeline overheads (canonicalization and preprocessing), showing that SD-JWT VC remains the fastest signer under a unified algorithm, that SD-JWT VC and mdoc verify at comparable speed, and that mdoc's default verification advantage depends partly on its ECDSA P-256/COSE configuration. Implementation complexity analysis reveals that JSON-LD VC has the highest cyclomatic complexity (8) and requires external network dependencies. Security evaluation reveals that the JSON-LD/RDFC verification pipeline carries additional attack surface stemming from remote context resolution and URDNA2015 canonicalization; without appropriate mitigations (static document loaders, context allowlists, call limits), DoS exposure, context injection, and SSRF risks may materialize. Within the scope of the evaluated attack vectors, SD-JWT VC and mdoc demonstrated resilience under standard verification settings. All experimental tools are released as open source, providing a reproducible evaluation framework for implementers and standardization stakeholders.",
          font: "Times New Roman", size: 20,
        })],
      }),
      emptyLine(),
      new Paragraph({
        spacing: { after: 80 },
        indent: { left: 480, right: 480 },
        children: [
          new TextRun({ text: "Keywords: ", font: "Times New Roman", size: 20, bold: true }),
          new TextRun({ text: "Verifiable Credentials, SD-JWT, JSON-LD, mdoc, Signature Verification, RDF Canonicalization, URDNA2015, Security Evaluation", font: "Times New Roman", size: 20, italics: true }),
        ],
      }),

      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: "999999", space: 1 } },
        spacing: { after: 200 },
        children: [],
      }),

      // ══════════════════════════════════════════════════════════
      // 1. INTRODUCTION
      // ══════════════════════════════════════════════════════════
      heading1("1. はじめに"),

      bodyPara("デジタルアイデンティティの分野において、検証可能なデジタルクレデンシャル（Verifiable Credential: VC）は、発行者がデジタル署名を付与した主張を、検証者が第三者への問い合わせなしに機械的に検証できる仕組みとして注目を集めている。現在、VCの主要なシリアライゼーションフォーマットとして、SD-JWT VC [1]、JSON-LD VC [2]、およびmdoc [3]の3つが存在する。これらはそれぞれ異なる設計哲学に基づいており、フォーマット選定には多角的な評価が求められる。"),

      bodyPara("SD-JWT VCはIETF RFC 9901として標準化され、JWTコンパクトシリアライゼーションを採用する。既存のOAuth 2.0/OpenID Connectエコシステムとの親和性が高く、選択的開示はSD-JWT仕様 [7] により実現される。JSON-LD VCはW3C Verifiable Credentials Data Model 2.0 [2] のJSON-LD表現に基づく実装であり、RDFに基づくセマンティック相互運用性を提供するが、署名・検証に際してURDNA2015によるRDF正規化 [4] が必須となる。mdocはISO/IEC 18013-5 [3] で規定されたモバイル身分証明書向けフォーマットであり、CBOR/COSEベースのバイナリエンコーディングを採用する。"),

      bodyPara("しかしながら、これら3フォーマットを同一条件下で実証的に比較した研究は限られており、特にセキュリティ評価を含む包括的な比較は行われていない。また、EU規則2024/1183（eIDAS 2.0）[18] においてSD-JWT VCおよびmdocがEuropean Digital Identity Wallet（EUDIW）の必須フォーマットとして規定されたことで、フォーマット間の定量的な比較の実用的重要性が増している。本稿では、オープンソースで公開したベンチマークツールを用いて以下の3つの評価軸で再現可能な比較評価を行う。第一に、署名生成・検証のスループットとレイテンシを計測する署名検証速度ベンチマーク。第二に、コード量・循環的複雑度・非同期ステップ数等を計測するデシリアライズ複雑性分析。第三に、明示的な脅威モデルに基づき、DoS・インジェクション・SSRF・アルゴリズム混同等の攻撃ベクトルに対する正規化セキュリティテストである。主要な実験はNode.js（TypeScript）バックエンド環境で実施し、GoおよびPython環境では相対的な性能順位の一貫性を補助的に確認した。"),

      bodyPara("なお、本稿の性能比較では各フォーマットのエコシステムで標準的に使用される署名アルゴリズム（SD-JWT VCおよびJSON-LD VCではEd25519、mdocではECDSA P-256）を採用しており、計測結果には検証パイプライン（正規化・前処理）の差だけでなく署名アルゴリズムの差も含まれる。この交絡因子については6章の考察および8章のThreats to Validityで詳しく議論する。"),

      // ══════════════════════════════════════════════════════════
      // 2. RELATED WORK
      // ══════════════════════════════════════════════════════════
      heading1("2. 関連研究"),

      bodyPara("VCフォーマットの比較に関する先行研究は複数存在するが、署名検証性能・実装複雑性・セキュリティの3軸を同一環境で定量的に評価した研究は限られている。本節では、本稿の研究と関連する主要な先行研究を概観し、本稿の位置づけを明確にする。"),

      bodyPara("Abraham et al. [16] はDID（Decentralized Identifier）とVCの技術的ランドスケープを包括的に調査し、分散型識別と検証のワークフローを整理した。しかし、同研究はフォーマット間の定量的な性能比較を含まず、概念レベルの分析にとどまっている。"),

      bodyPara("選択的開示メカニズムの比較については、Helm et al. [17] がBBS+署名とSD-JWTの体系的文献レビュー（SLR）を実施し、2017年から2025年にかけてIEEE、ACM、SpringerLink等から31の一次研究を抽出して分析した。同研究では、BBS+の導出証明が約140バイトの固定サイズで検証に約12 msを要する一方、SD-JWTは開示クレーム数に応じて提示サイズが増大するものの2クレーム開示時の検証は10 ms未満であることを報告している。ただし、同研究の焦点は選択的開示プリミティブ（BBS+ vs SD-JWT）の比較であり、本稿が対象とする3フォーマット（SD-JWT VC、JSON-LD VC、mdoc）の署名検証基本性能やセキュリティ特性の比較とは評価軸が異なる。"),

      bodyPara("Buldini et al. [15] は暗号学的アキュムレータを用いた新たなコンパクト選択的開示方式（CSD-JWT）を提案し、SD-JWTと比較してメモリ使用量を最大46%、Verifiable Presentationサイズを最大93%削減することを示した。同研究はリソース制約のあるハードウェアウォレットでの利用を想定しており、100クレームを含むクレデンシャルでも発行が数ミリ秒で完了することを報告している。ただし、同研究の評価対象はSD-JWTとCSD-JWTの比較であり、JSON-LD VCやmdocとの比較は含まれていない。"),

      bodyPara("RDFデータセット正規化のセキュリティについては、W3C RDFC-1.0仕様のセキュリティ考慮事項 [9] においてURDNA2015の最悪計算量やDoS脆弱性が公式に文書化されている。本稿では、この仕様上の懸念を実装レベルで評価し、ポイズングラフによるDoS攻撃面、コンテキストインジェクション、SSRFの3攻撃ベクトルについて定量的な分析を行う。"),

      bodyPara("以上の先行研究に対し、本稿の貢献は以下の3点にある。第一に、SD-JWT VC・JSON-LD VC・mdocの3フォーマットを同一ハードウェア・同一条件下でNode.js環境において計測し、GoおよびPython環境での補助的な再現性確認を行った点。第二に、署名検証性能に加え、実装複雑性とセキュリティを含む3軸の定量的評価を統合し、再現可能なベンチマークフレームワークとしてオープンソースで公開した点。第三に、JSON-LD/RDFC検証パイプラインのセキュリティリスクを理論的な指摘にとどまらず、明示的な脅威モデルの下で実装レベルの実証を行った点である。本稿はVCフォーマットの最終的な優劣判定を目的とするものではなく、実装者・標準化関係者がフォーマット選定時に参照できる定量的データの提供を主たる目的とする。"),

      // ══════════════════════════════════════════════════════════
      // 3. TECHNICAL SPECIFICATIONS
      // ══════════════════════════════════════════════════════════
      heading1("3. 各フォーマットの技術仕様"),

      heading2("3.1 概要"),

      bodyPara("本稿で評価対象とする3フォーマットの基本構成を表1に示す。各フォーマットは異なるシリアライズ方式、署名アルゴリズム、および正規化要件を有しており、これらの差異が性能・複雑性・セキュリティの各評価軸に直接影響する。以降の節では、各フォーマットの技術仕様、データモデル、および署名・検証における処理方式と処理内容を詳述する。"),

      tableCaption("表1 評価対象フォーマットの基本構成"),
      makeTable(
        ["フォーマット", "シリアライズ", "署名アルゴリズム", "正規化", "主要規格"],
        [
          ["SD-JWT VC", "JWTコンパクト (JSON)", "EdDSA (Ed25519)", "なし", "IETF RFC 9901"],
          ["JSON-LD VC", "JSONテキスト", "Ed25519 + SHA-256", "URDNA2015 (RDF)", "W3C VCDM 2.0"],
          ["mdoc", "CBORバイナリ", "ECDSA P-256 (ES256)", "なし", "ISO/IEC 18013-5"],
        ],
        [1600, 2100, 2100, 1800, 1760]
      ),
      emptyLine(),

      // ── 2.2 SD-JWT VC ─────────────────────────────────────────
      heading2("3.2 SD-JWT VC"),

      heading3("3.2.1 規格の位置づけ"),

      bodyPara("SD-JWT VC（SD-JWT-based Verifiable Credentials）はIETF RFC 9901 [1] として標準化されたクレデンシャルフォーマットである。その基盤技術としてJSON Web Token（JWT, RFC 7519 [11]）およびJSON Web Signature（JWS, RFC 7515）を採用し、選択的開示にはSD-JWT（Selective Disclosure for JWTs, RFC 9449 [7]）の仕組みを用いる。既存のOAuth 2.0/OpenID Connectエコシステムとの高い親和性を特長とする。"),

      heading3("3.2.2 データモデル"),

      bodyPara("SD-JWT VCのデータはJWTコンパクトシリアライゼーション形式で表現される。JWTは「Header.Payload.Signature」の3パートをBase64urlエンコードし、ドット（.）で連結した文字列である。Headerにはアルゴリズム識別子（alg）とトークンタイプ（typ）が含まれ、Payloadにはクレデンシャルのクレーム（属性情報）が格納される。"),

      bodyPara("SD-JWT VCにおいて規定される主要なクレームは以下の通りである。iss（Issuer）は発行者の識別子、sub（Subject）はクレデンシャル主体の識別子、vct（Verifiable Credential Type）はクレデンシャルの種類を示す。iat（Issued At）とexp（Expiration Time）は発行時刻と有効期限を示すタイムスタンプである。これらに加え、クレデンシャル固有の属性（氏名・生年月日等）が任意のクレームとして含まれる。"),

      listingCaption("リストA SD-JWT VCのデータ構造例"),
      ...codeBlock([
        "// Header (Base64url encoded)",
        '{ "alg": "EdDSA", "typ": "vc+sd-jwt" }',
        "",
        "// Payload (Base64url encoded)",
        "{",
        '  "iss": "https://issuer.example.com",',
        '  "sub": "did:example:holder123",',
        '  "vct": "https://credentials.example.com/identity",',
        '  "iat": 1714000000,',
        '  "exp": 1714003600,',
        '  "given_name": "Taro",',
        '  "family_name": "Yamada",',
        '  "birthdate": "1990-01-01"',
        "}",
        "",
        "// Compact Serialization: Header.Payload.Signature",
        "eyJhbGciOiJFZERTQSJ9.eyJpc3MiOi...._dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      ]),

      heading3("3.2.3 署名処理"),

      bodyPara("SD-JWT VCの署名処理は、JWS仕様に基づく以下の手順で行われる。まず、Headerを構築しBase64urlエンコードする。次に、Payloadを構築しBase64urlエンコードする。署名入力（Signing Input）として「Base64url(Header) || '.' || Base64url(Payload)」を構成し、この入力に対して秘密鍵で署名を生成する。最後に、署名値をBase64urlエンコードし、「Header.Payload.Signature」のコンパクトシリアライゼーションを出力する。"),

      bodyPara("使用可能な署名アルゴリズムはRFC 9901において規定されており、EdDSA（Ed25519/Ed448）、ES256（ECDSA with P-256）、ES384、ES512等が含まれる。本実験ではEdDSA（Ed25519）を使用した。署名処理全体が単一のAPI呼び出し（SignJWT.sign()）で完結する点が、他のフォーマットと比較した際の実装上の簡潔さに直結している。"),

      heading3("3.2.4 検証処理"),

      bodyPara("検証処理もJWS仕様に準拠する。トークンをドットで3分割し、Headerをデコードしてalgクレームを取得する。検証者は受理可能なアルゴリズムの許可リストとalgを照合し、許可リスト外のアルゴリズムを拒否する。これはRFC 8725 [5]（JWT Best Current Practices）で推奨される防御策であり、alg:none攻撃やアルゴリズム混同攻撃への対策となる。次に、署名入力を再構成し、発行者の公開鍵を用いて署名を検証する。署名が有効であれば、Payloadをデコードしてiss、vct、exp等の必須クレームの存在と値を確認する。"),

      heading3("3.2.5 選択的開示"),

      bodyPara("SD-JWT VCにおける選択的開示は、SD-JWT仕様 [7] により実現される。発行者はPayload内の開示対象クレームをSHA-256ハッシュに置換し、元の値をDisclosureとして別途提供する。Disclosureは「ソルト || クレーム名 || クレーム値」をBase64urlエンコードしたものであり、提示者は検証者に開示するDisclosureのみを選択して送信する。検証者はDisclosureのハッシュとPayload内のハッシュを照合することで、開示されたクレームの真正性を確認する。この方式により、正規化処理なしに選択的開示を実現している。"),

      // ── 2.3 JSON-LD VC ────────────────────────────────────────
      heading2("3.3 JSON-LD VC（W3C Verifiable Credentials Data Model 2.0）"),

      heading3("3.3.1 規格の位置づけ"),

      bodyPara("JSON-LD VCはW3C Verifiable Credentials Data Model 2.0（VCDM 2.0）[2] に基づくクレデンシャルフォーマットである。JSON-LD（JSON for Linking Data）によるセマンティック相互運用性を提供し、RDF（Resource Description Framework）のグラフモデルに基づく意味的な型付けを実現する。署名方式にはW3C Data Integrity仕様 [10] で定義される暗号スイートを使用する。本実験ではeddsa-rdfc-2022暗号スイート（変換: RDFC-1.0/URDNA2015、ハッシュ: SHA-256、署名: EdDSA Ed25519）を採用した。Ed25519Signature2020は旧Linked Data Proofs系の暗号スイートであり、eddsa-rdfc-2022はData Integrity 1.0仕様で定義された後継スイートである。両者はURDNA2015正規化とEd25519署名を共有するため、正規化・署名パイプラインの性能特性は同等である。"),

      heading3("3.3.2 データモデル"),

      bodyPara("JSON-LD VCのデータ構造は、@contextによる語彙定義、type、issuer、credentialSubject、およびproof（署名情報）で構成される。@contextはJSON-LDの中核概念であり、JSON内のキー（プロパティ名）をIRI（Internationalized Resource Identifier）にマッピングする外部語彙定義への参照を含む。これにより、異なる発行者が発行したVCであっても、同一の@contextを共有する限り、フィールドの意味が機械的に一意に解釈される。"),

      listingCaption("リストB JSON-LD VCのデータ構造例"),
      ...codeBlock([
        "{",
        '  "@context": [',
        '    "https://www.w3.org/2018/credentials/v1"',
        "  ],",
        '  "id": "https://example.com/credentials/1872",',
        '  "type": "VerifiableCredential",',
        '  "issuer": "https://issuer.example.com",',
        '  "issuanceDate": "2024-01-01T00:00:00Z",',
        '  "credentialSubject": {',
        '    "id": "did:example:holder123",',
        '    "given_name": "Taro",',
        '    "family_name": "Yamada",',
        '    "birthdate": "1990-01-01"',
        "  },",
        '  "proof": {',
        '    "type": "DataIntegrityProof",',
        '    "cryptosuite": "eddsa-rdfc-2022",',
        '    "created": "2024-01-01T00:00:00Z",',
        '    "verificationMethod": "did:example:issuer#key-1",',
        '    "proofPurpose": "assertionMethod",',
        '    "proofValue": "z58DAdFfa9SkqZMVP..."',
        "  }",
        "}",
      ]),

      heading3("3.3.3 Data Integrity Proof仕様"),

      bodyPara("W3C Verifiable Credential Data Integrity 1.0仕様 [10] は、VCに対する暗号学的証明（proof）を生成・検証するための汎用フレームワークを定義する。本仕様は、具体的な暗号アルゴリズムの選択を暗号スイート（cryptosuite）として外部化し、フレームワーク本体は暗号スイートに依存しない3段階のパイプライン——変換（Transformation）・ハッシュ化（Hashing）・証明生成/検証（Proof Generation/Verification）——を規定する。"),

      bodyRuns([
        { text: "proofオブジェクト。", bold: true },
        { text: "Data Integrityにおいて、署名情報はproofオブジェクトとしてVCに埋め込まれる。proofオブジェクトの主要プロパティは以下の通りである。" },
      ]),

      tableCaption("表A proofオブジェクトの主要プロパティ（Data Integrity 1.0）"),
      makeTable(
        ["プロパティ", "必須", "説明"],
        [
          ["type", "必須", "証明の種類（例：DataIntegrityProof）"],
          ["cryptosuite", "必須", "暗号スイート識別子（例：eddsa-rdfc-2022）"],
          ["verificationMethod", "必須", "検証に用いる公開鍵の識別子（通常DID URL）"],
          ["proofPurpose", "必須", "証明の目的（assertionMethod / authentication等）"],
          ["created", "任意", "証明の生成日時（xsd:dateTime）"],
          ["domain", "任意", "証明の有効ドメイン（リプレイ攻撃防止）"],
          ["challenge", "任意", "チャレンジ値（リプレイ攻撃防止）"],
          ["proofValue", "必須", "署名値（Multibase + Base58btcエンコード）"],
        ],
        [2000, 800, 6560]
      ),
      emptyLine(),

      heading3("3.3.4 暗号スイートのアーキテクチャ"),

      bodyPara("Data Integrity仕様は、暗号スイートが実装すべき3つのアルゴリズムを規定する。第一に、変換アルゴリズム（Transformation Algorithm）は入力ドキュメントをハッシュ化に適した形式に変換する。第二に、ハッシュ化アルゴリズム（Hashing Algorithm）は変換済みデータに暗号学的ハッシュ関数を適用する。第三に、証明シリアライゼーションアルゴリズム（Proof Serialization Algorithm）はハッシュ値に対して署名を生成（または検証）する。この3段階の分離により、異なる暗号アルゴリズムの組み合わせをプラグイン的に構成できる。"),

      bodyPara("W3Cは現在、以下の暗号スイートを標準化している。"),

      tableCaption("表B W3C Data Integrity暗号スイート一覧"),
      makeTable(
        ["暗号スイート", "変換", "ハッシュ", "署名", "仕様"],
        [
          ["eddsa-rdfc-2022", "RDFC-1.0 (URDNA2015)", "SHA-256", "EdDSA (Ed25519/Ed448)", "VC DI EdDSA 1.0"],
          ["eddsa-jcs-2022", "JCS (RFC 8785)", "SHA-256", "EdDSA (Ed25519/Ed448)", "VC DI EdDSA 1.0"],
          ["ecdsa-rdfc-2019", "RDFC-1.0 (URDNA2015)", "SHA-256/384", "ECDSA (P-256/P-384)", "VC DI ECDSA 1.0"],
          ["ecdsa-jcs-2019", "JCS (RFC 8785)", "SHA-256/384", "ECDSA (P-256/P-384)", "VC DI ECDSA 1.0"],
          ["bbs-2023", "RDFC-1.0 + BBS固有", "SHA-256", "BBS (BLS12-381)", "VC DI BBS 1.0"],
        ],
        [2000, 2200, 1500, 2160, 1500]
      ),
      emptyLine(),

      bodyPara("本実験で使用したeddsa-rdfc-2022暗号スイートは、変換にRDFC-1.0（URDNA2015）正規化を採用し、ハッシュ化にSHA-256を使用し、署名にEdDSA（Ed25519）を使用する。一方、eddsa-jcs-2022はRDFC-1.0の代わりにJSON Canonicalization Scheme（JCS, RFC 8785）を採用しており、RDFグラフの正規化を行わないため、URDNA2015固有の計算量問題を回避できる。ただし、JCSベースの暗号スイートはRDFに基づくセマンティック相互運用性を提供しないため、JSON-LD VCの本来の設計意図からは外れる。また、bbs-2023はBBS署名スキームを用いることで、ゼロ知識証明に基づく選択的開示と提示の非連結性（unlinkability）を実現する暗号スイートである。"),

      heading3("3.3.5 署名処理（Add Proof Algorithm）"),

      bodyPara("Data Integrity仕様のAdd Proofアルゴリズムに基づく署名処理は、以下の手順で構成される。eddsa-rdfc-2022暗号スイートを例として解説する。"),

      bodyRuns([
        { text: "手順1：proof optionsの構築。", bold: true },
        { text: "type、cryptosuite、verificationMethod、proofPurpose、created等のメタデータからproof optionsオブジェクトを構築する。このオブジェクトにはproofValueフィールドは含まない（署名前であるため）。" },
      ]),

      bodyRuns([
        { text: "手順2：ドキュメントの変換（Transformation）。", bold: true },
        { text: "入力ドキュメント（proofを除く）に対して、RDFC-1.0正規化アルゴリズム（URDNA2015）を適用する。まず、@contextに基づいてJSON-LDコンテキストを解決し、ドキュメントをRDFデータセットに展開する。次に、RDFデータセット内のブランクノードに対して正準ラベルを付与し、正規化されたN-Quads形式の文字列を出力する。この正規化処理が、全ブランクノードに対してグラフ構造に基づく一意なラベルを決定するため、計算量的に最もコストの高いステップとなりうる。" },
      ]),

      bodyRuns([
        { text: "手順3：proof optionsの正規化とハッシュ化。", bold: true },
        { text: "手順1で構築したproof optionsオブジェクトもJSON-LDドキュメントとして扱い、同様にRDFC-1.0正規化を行う。正規化されたproof options文字列に対してSHA-256ハッシュを計算し、32バイトのproofOptionsHash（proof configuration hash）を得る。この手順により、proof optionsの内容も署名で保護される。" },
      ]),

      bodyRuns([
        { text: "手順4：ドキュメントのハッシュ化。", bold: true },
        { text: "手順2で得た正規化済みドキュメント文字列に対してSHA-256ハッシュを計算し、32バイトのtransformedDocumentHashを得る。" },
      ]),

      bodyRuns([
        { text: "手順5：ハッシュデータの連結。", bold: true },
        { text: "proofOptionsHash（32バイト）とtransformedDocumentHash（32バイト）を連結し、64バイトのhashDataを生成する。この連結によって、proof optionsとドキュメント本体の両方が単一の署名で保護される。" },
      ]),

      bodyRuns([
        { text: "手順6：署名生成。", bold: true },
        { text: "hashData（64バイト）に対してEd25519秘密鍵でEdDSA署名を生成する。署名値はMultibaseエンコーディング（Base58btcヘッダー「z」+ Base58btcエンコード）としてproofValueフィールドに格納される。" },
      ]),

      bodyRuns([
        { text: "手順7：proofの付加。", bold: true },
        { text: "proofValueを含むproofオブジェクトをクレデンシャルに付加し、署名済みVCを出力する。" },
      ]),

      listingCaption("リストB2 Data Integrity署名処理の概念的フロー"),
      ...codeBlock([
        "// Add Proof Algorithm (eddsa-rdfc-2022)",
        "",
        "// 1. proof optionsの構築（proofValue以外）",
        "proofOptions = {",
        '  type: "DataIntegrityProof",',
        '  cryptosuite: "eddsa-rdfc-2022",',
        '  verificationMethod: "did:example:issuer#key-1",',
        '  proofPurpose: "assertionMethod",',
        '  created: "2024-01-01T00:00:00Z"',
        "}",
        "",
        "// 2. ドキュメントの変換（Transformation）",
        "//    RDFC-1.0 正規化 → N-Quads文字列",
        "canonicalDoc = RDFC_1_0.canonicalize(",
        "  document_without_proof)",
        "",
        "// 3. proof optionsの正規化 + ハッシュ化",
        "canonicalOpts = RDFC_1_0.canonicalize(proofOptions)",
        "proofOptionsHash = SHA256(canonicalOpts)  // 32 bytes",
        "",
        "// 4. ドキュメントのハッシュ化",
        "docHash = SHA256(canonicalDoc)            // 32 bytes",
        "",
        "// 5. ハッシュデータ連結",
        "hashData = proofOptionsHash || docHash    // 64 bytes",
        "",
        "// 6. EdDSA署名生成",
        "signature = Ed25519.sign(hashData, privateKey)",
        "",
        "// 7. proofValueとしてMultibaseエンコード",
        'proofOptions.proofValue = "z" +',
        "  Base58btc.encode(signature)",
      ]),

      bodyPara("この処理フローの重要な特徴として、正規化処理がドキュメント本体とproof optionsの2回実行される点がある。これにより、検証時にはドキュメントの内容だけでなく、proof optionsに含まれるverificationMethod、proofPurpose、created等のメタデータも署名で保護されていることが保証される。"),

      heading3("3.3.6 検証処理（Verify Proof Algorithm）"),

      bodyPara("Data Integrity仕様のVerify Proofアルゴリズムは、Add Proofの逆操作として構成される。検証者は以下の手順を実行する。"),

      bodyRuns([
        { text: "手順1：proofの分離。", bold: true },
        { text: "VCからproofオブジェクトを取り出し、proofValue（署名値）を取得・保持した上でproofオブジェクトからproofValueを除去してproof optionsを再構成する。" },
      ]),

      bodyRuns([
        { text: "手順2：ドキュメントの変換とハッシュ化。", bold: true },
        { text: "署名時と同一の手順で、proofを除いたドキュメントに対してRDFC-1.0正規化を行い、SHA-256ハッシュ（transformedDocumentHash）を計算する。" },
      ]),

      bodyRuns([
        { text: "手順3：proof optionsの正規化とハッシュ化。", bold: true },
        { text: "proof optionsに対してRDFC-1.0正規化を行い、SHA-256ハッシュ（proofOptionsHash）を計算する。" },
      ]),

      bodyRuns([
        { text: "手順4：ハッシュデータの連結と署名検証。", bold: true },
        { text: "proofOptionsHashとtransformedDocumentHashを連結してhashData（64バイト）を再構成する。proofValueからMultibaseデコードして署名値を取得し、verificationMethodで特定された公開鍵を用いてEdDSA署名を検証する。" },
      ]),

      bodyPara("検証処理における重要な特性として、正規化処理のネットワーク依存がある。@contextに指定されたURLへのHTTPリクエストが発生するため、ネットワーク遅延やコンテキストサーバーの障害が検証処理の可用性に直接影響する。また、攻撃者が悪意のあるURLを@contextに含めることでSSRF攻撃が成立する可能性がある。対策として、信頼できるコンテキストを事前にキャッシュする静的ローダーの使用や、Document Loaderによる許可リスト検証が推奨される。"),

      heading3("3.3.7 URDNA2015正規化アルゴリズムの詳細"),

      bodyPara("Data Integrityの署名・検証パイプラインにおいて、変換段階で用いられるURDNA2015（W3C RDFC-1.0として標準化 [4]）は、RDFデータセットの正規化（canonicalization）を行うアルゴリズムである。正規化の目的は、意味的に等価な2つのRDFグラフが同一の文字列表現を持つことを保証することにある。これにより、同じ内容のVCに対しては、表現の違い（プロパティの順序、空白文字、ブランクノードラベルの差異等）にかかわらず、常に同一のハッシュ値が得られる。"),

      bodyPara("URDNA2015のアルゴリズムは大きく以下の3フェーズで構成される。第一フェーズ（Initialization）では、入力RDFデータセット内の全ブランクノードを列挙し、各ブランクノードに対してハッシュ値を計算する初期マップを構築する。第二フェーズ（Hash First Degree Quads）では、各ブランクノードについて、そのブランクノードが直接参照するクワッドのハッシュ値を計算する。第三フェーズ（Hash N-Degree Quads）では、第二フェーズで識別できなかったブランクノードについて、より広い範囲のクワッドを考慮した再帰的なハッシュ計算を行い、全ブランクノードに一意な正準ラベル（canonical label）を付与する。"),

      bodyPara("第三フェーズの再帰的なハッシュ計算が、最悪ケースで指数的な計算量に達する原因である。全てのブランクノードが相互に参照する循環構造（ポイズングラフ）が入力された場合、N-Degree Quadsハッシュの計算において組み合わせ的な爆発が発生する。W3C RDFC-1.0仕様の§4.8.3では、Hash N-Degree Quads関数の呼び出し回数に上限（call limit）を設けることを推奨しており、上限を超えた場合は処理を中断してエラーを返すことが望ましいとされている。しかし、多くの実装ではデフォルトでこの上限が未設定である。本実験では小規模な循環グラフに対するcall limit設定の挙動を確認した（5.9節）。顕著なDoSを再現するにはより大規模なブランクノードグラフを用いた追加評価が必要であるが、RDFC-1.0仕様で指摘される最悪計算量特性を踏まえると、call limitは防御的実装として重要である。"),

      heading3("3.3.8 セマンティック相互運用性"),

      bodyPara("JSON-LD VCの最大の技術的特長は、RDFに基づくセマンティック相互運用性である。@contextにより全てのプロパティがグローバルに一意なIRIにマッピングされるため、異なるエコシステム間でクレデンシャルを交換する際に、フィールドの意味が曖昧になることがない。例えば、「issuer」というフィールドはW3C VCコンテキストにより「https://www.w3.org/2018/credentials#issuer」というIRIに解決され、どのシステムでも同一の意味として解釈される。この特性は、分散型アイデンティティ（DID）エコシステムにおけるクレデンシャルの相互運用において本質的な役割を果たす。ただし、このセマンティック相互運用性の代償として、前述の正規化処理によるパフォーマンスおよびセキュリティ上のオーバーヘッドが生じる。"),

      // ── 2.4 mdoc ──────────────────────────────────────────────
      heading2("3.4 mdoc（ISO/IEC 18013-5）"),

      heading3("3.4.1 規格の位置づけ"),

      bodyPara("mdocはISO/IEC 18013-5:2021 [3]（Personal identification — ISO-compliant driving licence — Part 5: Mobile driving licence (mDL) application）で規定されたモバイル身分証明書向けのクレデンシャルフォーマットである。CBOR（Concise Binary Object Representation, RFC 8949 [12]）によるバイナリエンコーディングとCOSE（CBOR Object Signing and Encryption, RFC 9052 [6]）による署名方式を採用し、近距離通信（NFC、BLE、Wi-Fi Aware）を介したオフライン提示を主要なユースケースとして設計されている。ISO/IEC TS 18013-7ではオンライン提示（OID4VP）への拡張が規定されている。"),

      heading3("3.4.2 データモデル"),

      bodyPara("ISO/IEC 18013-5では、mdocのデータモデルをCDDL（Concise Data Definition Language, RFC 8610）で定義している。最上位構造はDocumentであり、docType（文書種別）とissuerSigned（発行者署名データ）で構成される。issuerSignedはnameSpaces（名前空間ごとのデータ要素）とissuerAuth（発行者認証データ）を含む。"),

      bodyPara("個々のデータ要素はIssuerSignedItem構造として格納される。IssuerSignedItemはdigestID（ダイジェスト識別子）、random（16バイト以上のランダム値）、elementIdentifier（データ要素識別子）、elementValue（データ要素値）の4フィールドで構成される。randomフィールドの目的は、ダイジェスト値単体からデータ要素の内容を推測できないようにすることであり、選択的開示時のプライバシー保護に寄与する。"),

      listingCaption("リストC mdocのデータ構造（CDDL定義、ISO/IEC 18013-5 §9.1.2.4より）"),
      ...codeBlock([
        "Document = {",
        '  "docType" : DocType,',
        '  "issuerSigned" : IssuerSigned',
        "}",
        "",
        "IssuerSigned = {",
        '  "nameSpaces" : IssuerNameSpaces,',
        '  "issuerAuth" : IssuerAuth      ; COSE_Sign1',
        "}",
        "",
        "IssuerNameSpaces = {",
        "  + NameSpace => [ + IssuerSignedItemBytes ]",
        "}",
        "",
        "IssuerSignedItemBytes = #6.24(bstr .cbor IssuerSignedItem)",
        "",
        "IssuerSignedItem = {",
        '  "digestID" : uint,',
        '  "random" : bstr,               ; min 16 bytes',
        '  "elementIdentifier" : DataElementIdentifier,',
        '  "elementValue" : DataElementValue',
        "}",
      ]),

      heading3("3.4.3 Mobile Security Object（MSO）"),

      bodyPara("mdocの署名はMobile Security Object（MSO）を介して行われる。MSOは全データ要素のダイジェスト値を集約した構造体であり、IssuerAuth（COSE_Sign1）のペイロードとして格納される。MSOの主要フィールドは以下の通りである。versionはMSO構造のバージョン（現行「1.0」）、digestAlgorithmはダイジェストアルゴリズム識別子（SHA-256/SHA-384/SHA-512のいずれか）、valueDigestsは名前空間ごとのダイジェストIDとダイジェスト値のマップ、deviceKeyInfoはmdoc認証用公開鍵、docTypeは文書種別、validityInfoは署名日時・有効期間の情報をそれぞれ格納する。"),

      listingCaption("リストD MSOの構造定義（ISO/IEC 18013-5 §9.1.2.4より）"),
      ...codeBlock([
        "IssuerAuth = COSE_Sign1",
        "  ; payload = MobileSecurityObjectBytes",
        "",
        "MobileSecurityObjectBytes =",
        "  #6.24(bstr .cbor MobileSecurityObject)",
        "",
        "MobileSecurityObject = {",
        '  "version" : tstr,              ; "1.0"',
        '  "digestAlgorithm" : tstr,      ; "SHA-256" etc.',
        '  "valueDigests" : ValueDigests,',
        '  "deviceKeyInfo" : DeviceKeyInfo,',
        '  "docType" : tstr,',
        '  "validityInfo" : ValidityInfo',
        "}",
        "",
        "ValueDigests = {",
        "  + NameSpace => DigestIDs",
        "}",
        "",
        "DigestIDs = {",
        "  + DigestID => Digest  ; DigestID = uint, Digest = bstr",
        "}",
        "",
        "ValidityInfo = {",
        '  "signed" : tdate,',
        '  "validFrom" : tdate,',
        '  "validUntil" : tdate,',
        '  ? "expectedUpdate" : tdate',
        "}",
      ]),

      heading3("3.4.4 署名処理"),

      bodyPara("mdocの署名（発行）処理は、ISO/IEC 18013-5 §9.1.2で規定される以下の手順で行われる。"),

      bodyRuns([
        { text: "第一段階：データ要素のCBORエンコードとダイジェスト計算。", bold: true },
        { text: "各データ要素（elementIdentifier + elementValue）に対して、ランダムな16バイト以上のソルト（random）とdigestIDを付与してIssuerSignedItem構造を構築し、CBORエンコードする。エンコードされた各IssuerSignedItemBytesに対して、個別にSHA-256（またはSHA-384/SHA-512）ダイジェストを計算する。このダイジェストはIssuerSignedItemBytes全体（ソルトを含む）に対して計算されるため、ダイジェスト値からデータ要素の内容を推測することはできない。" },
      ]),

      bodyRuns([
        { text: "第二段階：MSOの構築。", bold: true },
        { text: "全データ要素のダイジェストをvalueDigestsに集約し、digestAlgorithm、deviceKeyInfo、docType、validityInfoと合わせてMobileSecurityObject構造を構築する。MSOをCBORエンコードし、tagged bytestring（CBOR tag 24）としてMobileSecurityObjectBytesを生成する。" },
      ]),

      bodyRuns([
        { text: "第三段階：COSE_Sign1署名。", bold: true },
        { text: "COSE_Sign1構造 [6] に基づき、MobileSecurityObjectBytesをペイロードとして署名を生成する。プロテクトヘッダーにはalgパラメータ（例：ES256 = -7）を含め、Sig_Structure（= [\"Signature1\", protected_header, external_aad, payload]）を構築する。Sig_Structureに対して発行者の秘密鍵でECDSA（P-256/P-384/P-521）またはEdDSA署名を生成する。ISO/IEC 18013-5は、ES256、ES384、ES512、EdDSAの4種のアルゴリズムを規定している。署名者の公開鍵証明書はCOSE非プロテクトヘッダーのx5chainパラメータに格納される。" },
      ]),

      bodyRuns([
        { text: "第四段階：mdocの組立。", bold: true },
        { text: "COSE_Sign1構造（= [protected_header, unprotected_header, payload, signature]）をissuerAuthとし、IssuerSignedItemBytesの配列をnameSpacesとして、Document構造を組み立てる。最終的なmdocはCBORバイナリとしてシリアライズされる。" },
      ]),

      heading3("3.4.5 検証処理"),

      bodyPara("mdocの検証（ISO/IEC 18013-5 §9.3.1 Inspection procedure for issuer data authentication）は、以下の手順で行われる。"),

      bodyRuns([
        { text: "第一段階：CBORデコードと構造展開。", bold: true },
        { text: "受信したmdocバイナリをCBORデコードし、Document構造を得る。issuerSigned内のissuerAuth（COSE_Sign1）を展開し、プロテクトヘッダー、ペイロード（MobileSecurityObjectBytes）、署名値を取得する。" },
      ]),

      bodyRuns([
        { text: "第二段階：COSE_Sign1署名検証。", bold: true },
        { text: "プロテクトヘッダーからalgパラメータを取得し、許可されたアルゴリズム（ES256/ES384/ES512/EdDSA）であることを確認する。署名時と同一のSig_Structure（= [\"Signature1\", protected_header, b'', payload]）を再構築し、COSE非プロテクトヘッダーのx5chainから発行者の公開鍵証明書を取得する。証明書チェーンの検証（信頼アンカーまでの経路検証、失効確認）を行った上で、公開鍵を用いて署名を検証する。プロテクトヘッダーはSig_Structureに含まれるため、ヘッダーの改ざんは署名不一致として検出される。" },
      ]),

      bodyRuns([
        { text: "第三段階：要素別ダイジェスト検証。", bold: true },
        { text: "MSOをデコードし、valueDigests内のダイジェストマップを取得する。受信した各IssuerSignedItemBytesに対してSHA-256ダイジェストを計算し、MSO内の対応するダイジェスト値（digestIDで紐付け）と照合する。全要素のダイジェストが一致した場合にのみ、データの真正性が確認される。この要素別ダイジェスト方式により、検証者は全データ要素を受信しなくても、受信した要素のみの真正性を個別に検証できる。" },
      ]),

      heading3("3.4.6 選択的開示とプライバシー保護"),

      bodyPara("mdocにおける選択的開示は、そのデータモデルの設計により構造的に実現されている。MSOには全データ要素のダイジェストが含まれるが、提示者は検証者に対して開示するデータ要素（IssuerSignedItem）のみを送信する。検証者は受信した各IssuerSignedItemのダイジェストをMSO内のダイジェストと照合することで、開示されたデータ要素のみの真正性を検証できる。未開示のデータ要素については、ダイジェスト値がMSO内に存在するが、randomフィールド（16バイト以上のソルト）の存在により、ダイジェスト値からデータ要素の内容を推測することは計算量的に困難である。"),

      bodyPara("さらに、ISO/IEC 18013-5ではmdoc認証（mdoc authentication）として、DeviceKeyを用いたMAC認証とECDSA/EdDSA署名認証の2つの方式を規定している。MAC認証はECDH鍵合意に基づくエフェメラルMACキー（EMacKey）を使用し、提示者のデバイスがMACを計算する。この方式はデバイスが否認可能な認証を行える（検証者もMACを生成できるため、第三者に対してデバイスの関与を証明できない）点で、署名方式よりもプライバシー保護に優れている。"),

      heading3("3.4.7 ISO/IEC TS 18013-7によるオンライン提示への拡張"),

      bodyPara("ISO/IEC TS 18013-7はmdocのオンライン提示プロトコルを規定する技術仕様であり、OID4VP（OpenID for Verifiable Presentations）を用いたWebブラウザ経由でのmdoc提示フローを定義している。これにより、ISO/IEC 18013-5が想定するNFC/BLEによる対面提示に加え、リモートでのmdoc検証が可能となる。mdocのデータモデルおよびissuer署名構造はISO/IEC 18013-5と共通であるため、本稿の結果はオンライン提示におけるクレデンシャル構造・署名検証部分の評価として参考になる。ただし、ISO/IEC TS 18013-7/OID4VP全体のプロトコル性能やセキュリティは、セッション暗号化、reader authentication、nonce処理、transport/API依存の処理を含むため、別途評価が必要である。"),

      // ══════════════════════════════════════════════════════════
      // 4. EXPERIMENTAL DESIGN
      // ══════════════════════════════════════════════════════════
      heading1("4. 実験設計"),

      heading2("4.1 実行環境"),

      bodyPara("本実験のベンチマークは、以下の環境で実施した。"),

      bodyPara("本実験の全ベンチマーク（署名検証・言語間比較・シリアライズ・スケーリング・選択的開示・Ed25519統一・複雑クレデンシャル正規化）は、計測専用に確保した単一のLinuxサーバ上で実施した。"),

      tableCaption("表2 実行環境"),
      makeTable(
        ["項目", "詳細"],
        [
          ["ハードウェア", "専用Linuxサーバ（Azure、AMD EPYC 7763、x86_64）。4 vCPUのうち2コアをオフライン化しSMT無効。計測プロセスはtasksetで単一コアに固定"],
          ["OS", "Ubuntu Linux（カーネル6.17.0-azure）"],
          ["ランタイム", "Node.js v24.18.0（V8 13.6 / OpenSSL 3.5.7）、Go 1.22.2、Python 3.12.3"],
          ["計測 API", "process.hrtime.bigint() / time.Now() / time.perf_counter_ns()（いずれもナノ秒精度）"],
          ["イテレーション数", "N=2,000回/ベンチマーク（ウォームアップ50回実施後に本計測）"],
          ["実行回数", "独立5回のプロセス実行。各統計量は5回実行の中央値を報告"],
        ],
        [3000, 6360]
      ),
      emptyLine(),

      bodyPara("計測はGUIやブラウザを介さないサーバサイドのLinux環境で実施し、SMT無効化・未使用コアのオフライン化・tasksetによるコア固定により他プロセスの干渉を最小化した。さらに、独立した5回のプロセス実行を行い、各統計量（平均・σ・p50・p95等）について5回実行の中央値を採用することで、単一実行に混入するノイズの影響を緩和している。実行間のp50変動は大半のベンチマークで3%以内であった。なお本環境はクラウドVM上の専用サーバであり、ハイパーバイザ層の影響を完全には排除できない点は制約として残る（7章）。"),

      heading2("4.2 テストツールの構成"),

      bodyRuns([
        { text: "本実験では、自作のベンチマークツール（VC Comparison Tool）を使用した。本稿の計測は、同ツールから計測エンジンを切り出したスタンドアロンのCLIキット（linux-bench。Node.js / Go / Python の3エンジンと共通集計スクリプトで構成）により、GUIやWebサーバを介さずに実施した。各エンジンはナノ秒精度のタイムスタンプで生タイミングのみを記録し、統計計算は共通スクリプトで一元的に行う。Node.jsの暗号処理にはnode:cryptoモジュールを直接使用し、ブラウザ環境のWebCrypto APIと比較してオーバーヘッドが最小化されている。ソースコードは GitHub リポジトリ " },
        { text: "https://github.com/fujie/vcformatcomparison", italics: true },
        { text: " にて公開しており [14]、再現実験が可能である。各フォーマットの署名・検証処理は、以下のライブラリを用いて実装している。" },
      ]),

      tableCaption("表3 各フォーマットの使用ライブラリ（バージョンは計測時にnode_modulesから解決した実測値）"),
      makeTable(
        ["フォーマット", "主要ライブラリ", "役割"],
        [
          ["SD-JWT VC", "node:crypto（Node.js v24.18.0 / OpenSSL 3.5.7）", "EdDSA (Ed25519) 署名生成・検証（ライブラリあり/なし共通）"],
          ["SD-JWT VC", "jose@6.2.3", "JWT構造処理の参照実装（デシリアライズ複雑性分析および参考計測用）"],
          ["JSON-LD VC", "jsonld@8.3.3（rdf-canonize@3.4.0）", "JSON-LDプロセッシング・URDNA2015正規化"],
          ["JSON-LD VC", "node:crypto (Ed25519, SHA-256)", "Ed25519署名・SHA-256ハッシュ"],
          ["JSON-LD VC (JCS)", "canonicalize@1.0.8", "JCS (RFC 8785) 正規化（ライブラリあり）"],
          ["mdoc", "cbor-x@1.6.4", "CBORエンコード/デコード（ライブラリあり）"],
          ["mdoc", "node:crypto (ECDSA P-256)", "ECDSA P-256署名・COSE_Sign1検証"],
          ["（複雑クレデンシャル評価）", "@digitalcredentials/open-badges-context@3.0.0, @digitalbazaar/credentials-context@3.2.0", "OpenBadges v3.0 / VCDM 2.0コンテキストの静的埋め込み（5.11節）"],
        ],
        [2200, 3560, 3600]
      ),
      emptyLine(),

      heading2("4.3 ベンチマーク手法"),

      heading3("4.3.1 署名検証速度ベンチマーク"),

      bodyPara("各フォーマットについて、同一のクレデンシャル情報（氏名・生年月日・住所等）を対象に署名生成（sign）と署名検証（verify）を繰り返し実行し、レイテンシ（ms/op）とスループット（ops/sec）を計測した。計測にはナノ秒精度のモノトニッククロック（Node.js: process.hrtime.bigint()、Go: time.Now()、Python: time.perf_counter_ns()）を使用し、各イテレーションの所要時間を個別に記録した。ウォームアップを50回実行した後に本計測を行うことで、JIT最適化やキャッシュの初期化による偏りを低減している。これらのタイマはブラウザのperformance.now()（DOMHighResTimeStamp、Spectre緩和のため約0.1 ms程度に分解能が制限される）と比較して大幅に高精度であり、サブミリ秒の操作の計測に適している。本実験ではベンチマークあたりN=2,000回のイテレーションについて算術平均・標本標準偏差（σ）・95%信頼区間（95%CI）・中央値（p50）・95パーセンタイル（p95）を算出し、いずれも小数第3位（p50・p95を含む）まで報告する。パーセンタイルは線形補間により算出した。各言語のエンジンは生タイミング（ns）のみを出力し、統計計算は3言語共通の集計スクリプトで一元的に行うことで、言語間で統計手法の差が生じないようにしている。"),

      bodyPara("外れ値の扱いについては、Tukeyの基準（第1・第3四分位点から1.5×IQRを超える値）により外れ値を検出・報告するが、計測値からの除去は行わない。ガベージコレクションやOSスケジューリングに起因する右裾の長い分布となるため、代表値としては外れ値の影響を受けにくい中央値（p50）を主たる統計量とし、平均は参考値として併記する。主要ベンチマークにおける外れ値の割合は4〜20%程度であり、Tukey基準による外れ値を除外したトリム平均はp50とほぼ一致することを確認している。さらに、計測全体を独立した5回のプロセス実行として繰り返し、各統計量について5回実行の中央値を報告することで、単一実行に混入する系統的なノイズ（他プロセスの干渉等）の影響を緩和している。"),

      bodyRuns([
        { text: "ベンチマークのコアロジックを以下の擬似コードで示す。同期版（bench）と非同期版（benchAsync）の2種を用意し、各フォーマットのsign/verify関数をN回呼び出し、各イテレーションの所要時間をナノ秒精度で個別に記録して分布統計を算出する。" },
      ]),

      // Pseudocode block
      new Paragraph({
        spacing: { before: 120, after: 40 },
        indent: { left: 720 },
        children: [new TextRun({ text: "// バックエンド ベンチマーク（Node.js）", font: "Courier New", size: 19, color: "666666" })],
      }),
      new Paragraph({
        spacing: { after: 20 },
        indent: { left: 720 },
        children: [new TextRun({ text: "function bench(label, n, fn) {", font: "Courier New", size: 19 })],
      }),
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 20 },
        children: [new TextRun({ text: "  for (let i = 0; i < 50; i++) fn();  // warmup ×50", font: "Courier New", size: 19 })],
      }),
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 20 },
        children: [new TextRun({ text: "  const t = new Array(n);", font: "Courier New", size: 19 })],
      }),
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 20 },
        children: [new TextRun({ text: "  for (let i = 0; i < n; i++) {", font: "Courier New", size: 19 })],
      }),
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 20 },
        children: [new TextRun({ text: "    const s = process.hrtime.bigint();", font: "Courier New", size: 19 })],
      }),
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 20 },
        children: [new TextRun({ text: "    fn();", font: "Courier New", size: 19 })],
      }),
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 20 },
        children: [new TextRun({ text: "    t[i] = Number(process.hrtime.bigint() - s);  // 各回を個別記録", font: "Courier New", size: 19 })],
      }),
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 20 },
        children: [new TextRun({ text: "  }", font: "Courier New", size: 19 })],
      }),
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 20 },
        children: [new TextRun({ text: "  return stats(t);  // mean, σ, 95%CI, p50, p95, 外れ値数 (Tukey 1.5×IQR)", font: "Courier New", size: 19 })],
      }),
      new Paragraph({
        indent: { left: 720 },
        spacing: { after: 120 },
        children: [new TextRun({ text: "}", font: "Courier New", size: 19 })],
      }),

      bodyPara("JSON-LD VCについては、署名処理全体に加えて内部ステップ（URDNA2015正規化・SHA-256ハッシュ・Ed25519署名）の内訳も個別にprocess.hrtime.bigint()で計測した。各ステップの前後でタイムスタンプを取得し、その差分を各ステップの所要時間として記録する方式である。"),

      heading3("4.3.2 デシリアライズ複雑性分析"),

      bodyPara("各フォーマットのデシリアライズ処理について、コード行数（LOC）、非同期ステップ数、循環的複雑度（McCabe複雑度）、外部ネットワーク呼び出し数、および外部依存ライブラリ数の5つの静的・動的メトリクスを計測した。これらのメトリクスは、実装の保守性・監査可能性・脆弱性混入リスクの間接的指標となる。なお、LOCは実装スタイル（エラーハンドリングの省略度合い、ライブラリ利用度）に依存し、循環的複雑度はデシリアライズ関数の全体を対象とした値である。外部依存ライブラリ数はサプライチェーンリスクの代理指標であるが、個々のライブラリの成熟度・メンテナンス状況・CVE履歴は評価対象外とした。これらの限界はThreats to Validity（8章）で議論する。"),

      heading3("4.3.3 脅威モデル"),

      bodyPara("セキュリティ評価に先立ち、本稿で想定する脅威モデルを明示する。"),

      bodyPara("攻撃者モデル：本実験では、悪意あるHolder（提示者）が改ざんしたVP/VCをVerifierに提示するシナリオ、および悪意ある外部コンテキスト提供者がVerifierの処理に介入するシナリオを想定する。Issuerは正当であると仮定する。"),

      bodyPara("検証者モデル：Verifierは、任意のIssuerからのVCを受け入れる可能性がある公開APIとして構成される。信頼済みIssuerのみを受け入れるクローズドな構成は想定しない。"),

      bodyPara("ネットワーク前提：デフォルト設定の検証実装を対象とし、JSON-LD VCについてはリモートコンテキスト取得が有効な状態（document loaderに制限なし、context allowlist未設定、URDNA2015 call limit未設定）を基準とする。これは、ライブラリのデフォルト設定に対する脆弱性を検出するためである。ただし、本番環境の推奨設定（静的document loader、context allowlist、call limit、タイムアウト等）を適用した場合のリスク緩和効果については6.3節で考察する。"),

      bodyPara("成功条件：DoS攻撃は検証処理の顕著な遅延（通常処理の100倍以上のレイテンシ増大）をもって成功とする。SSRFは外部URLに対するHTTPリクエストの発生（内部情報の取得有無にかかわらず）をもって攻撃面の存在を確認する。コンテキストインジェクションは、検証結果やクレームの意味の改変可能性をもって成功とする。"),

      heading3("4.3.4 正規化セキュリティテスト"),

      bodyPara("上記の脅威モデルに基づき、各フォーマットに対して既知の攻撃ベクトルによるセキュリティテストを実施した。JSON-LD VCに対してはポイズングラフDoS（URDNA2015の最悪ケース計算量を悪用）、コンテキストインジェクション（@context用語の上書き）、SSRF（悪意のあるコンテキストURLによる内部ネットワーク探索）の3種を検証した。SD-JWT VCに対してはalg:none攻撃 [8] とアルゴリズム混同攻撃、mdocに対してはデータ要素改ざんおよびCOSEプロテクトヘッダー改ざんの検出能力を検証した。なお、JSON-LD VCのテストはデフォルト設定（緩和策なし）で実施しており、本番環境における適切な設定により緩和可能な攻撃ベクトルが含まれる点に留意されたい。"),

      heading3("4.3.5 複雑クレデンシャルにおける正規化評価"),

      bodyPara("主要ベンチマーク（4.3.1）で使用するクレデンシャルはブランクノードを含まない単純な構造であり、URDNA2015正規化のコストを過小評価する可能性がある。そこで、実運用で使用されている複雑なスキーマとして、教育分野で広く採用されている1EdTech OpenBadges v3.0（OB3）のAchievementCredential、およびDCC（Digital Credentials Consortium）が発行するOB3プロファイルの学位クレデンシャルを模したサンプルを用意し、URDNA2015正規化の所要時間を計測した（5.11節）。OB3クレデンシャルはachievement配下のcriteria・alignment・resultなど、idを持たないノード（RDFデータセット上のブランクノード）を複数含み、JFF PlugfestなどのVC相互運用性テストでも使用される代表的な複雑スキーマである。JSON-LDコンテキスト（VCDM 2.0およびOB3 v3.0.3）は@digitalcredentials/open-badges-contextおよび@digitalbazaar/credentials-contextパッケージから静的に埋め込み、計測中のネットワークI/Oを排除した。加えて、ブランクノード数の影響を分離するため、idを持たない子ノードを10個・50個含む合成クレデンシャルも計測した。"),

      bodyPara("なお、計測に使用した実装コード（各フォーマットのベンチマーク実装）、複雑性分析の対象とした参照実装、およびセキュリティテストの実装は付録Aに示す。"),

      // ══════════════════════════════════════════════════════════
      // 5. RESULTS
      // ══════════════════════════════════════════════════════════
      heading1("5. 実験結果"),

      heading2("5.1 署名検証速度"),

      bodyPara("署名生成・検証のベンチマーク結果（Node.js hrtimeによるナノ秒精度計測、N=2,000×5回実行の中央値）を表4に示す。以降、比較の主たる統計量には中央値（p50）を用い、平均は参考値として併記する。表4では署名・検証それぞれのp50と平均を要約として示し、σ・95%CI・p95・外れ値を含む完全な統計量は署名側・検証側とも表8に示す。署名速度ではSD-JWT VCが最速（p50: 0.038 ms/op）であり、mdoc（0.077 ms/op）、JSON-LD VC（0.101 ms/op）が続いた。検証速度ではmdocが最速（p50: 0.090 ms/op）であった。SD-JWT VCの検証レイテンシ（p50: 0.117 ms/op）を基準とした場合、mdocは0.77倍（より高速）、JSON-LD VCは約1.52倍であった。"),

      tableCaption("表4 署名生成・検証の性能比較（Node.js hrtime, ライブラリあり, N=2,000×5回実行の中央値。完全な統計量は表8）"),
      makeTable(
        ["フォーマット", "署名p50(ms)", "署名平均(ms)", "検証p50(ms)", "検証平均(ms)", "検証σ(ms)", "検証p95(ms)", "検証ops/sec", "検証p50 対SD-JWT比"],
        [
          ["SD-JWT VC", "0.038", "0.044", "0.117", "0.120", "0.026", "0.128", "8,321", "1.00x"],
          ["JSON-LD VC", "0.101", "0.162", "0.178", "0.200", "0.169", "0.205", "5,011", "1.52x"],
          ["mdoc", "0.077", "0.102", "0.090", "0.093", "0.019", "0.106", "10,707", "0.77x"],
        ],
        [1400, 1000, 1000, 1000, 1000, 1000, 1100, 1100, 1160]
      ),
      emptyLine(),

      bodyPara("JSON-LD VCの署名処理内訳を表5に示す。各ステップ（URDNA2015正規化・SHA-256ハッシュ・Ed25519署名）を表4と同一環境・同一条件（N=2,000×5回実行の中央値）で個別に計測した。p50ベースでは、URDNA2015正規化ステップが内訳合計の約52%、Ed25519署名ステップが約45%と同オーダーであった。SHA-256ハッシュ計算（p50: 0.002 ms）はボトルネックではない。なお、単純なクレデンシャルにおけるこの比率構造はブランクノードを含む複雑なクレデンシャルでは大きく変化し、正規化が支配的となる（5.11節）。"),

      tableCaption("表5 JSON-LD VC署名処理の内訳（各ステップ個別計測、N=2,000×5回実行の中央値）"),
      makeTable(
        ["処理ステップ", "平均(ms)", "p50(ms)", "内訳合計に占める割合 (%, p50基準)"],
        [
          ["正規化 (URDNA2015)", "0.094", "0.043", "52.4"],
          ["ハッシュ計算 (SHA-256)", "0.004", "0.002", "2.4"],
          ["署名 (Ed25519)", "0.040", "0.037", "45.1"],
        ],
        [3200, 2000, 2000, 2160]
      ),
      emptyLine(),
      new Paragraph({
        spacing: { after: 100 },
        indent: { left: 240 },
        children: [new TextRun({ text: "※ 内訳合計 (p50: 0.082 ms) と署名処理全体の個別計測 (p50: 0.096 ms) の差は、JSON-LDドキュメント処理等ステップ間のオーバーヘッドによる。割合は内訳合計(p50)に対する比率。", font: "Times New Roman", size: 18, italics: true })],
      }),

      heading2("5.2 デシリアライズ複雑性"),

      bodyPara("デシリアライズ処理の各メトリクスを表6に示す。JSON-LD VCが全メトリクスにおいて最も高い複雑性を示し、SD-JWT VCが最も単純であった。"),

      tableCaption("表6 デシリアライズ複雑性の比較"),
      makeTable(
        ["メトリクス", "SD-JWT VC", "JSON-LD VC", "mdoc"],
        [
          ["コード行数 (LOC)", "10", "35", "25"],
          ["非同期ステップ数", "1", "4", "2"],
          ["循環的複雑度", "3", "8", "5"],
          ["外部ネットワーク呼び出し", "0", "2", "0"],
          ["外部依存ライブラリ", "1 (jose)", "4", "2"],
        ],
        [2500, 2200, 2360, 2300]
      ),
      emptyLine(),

      bodyPara("以下に、各フォーマットのデシリアライズ処理の実装コードを示す。コード中のコメントにより、表6の各メトリクス（分岐箇所、非同期ステップ、外部呼び出し）が具体的にどの処理に対応するかを明示する。"),

      // ── SD-JWT VC deserialization (complexity-annotated) ──
      heading3("5.2.1 SD-JWT VC（循環的複雑度: 3）"),

      bodyPara("付録A.5のリスト9にSD-JWT VCのデシリアライズ処理を示す。コード行数10行、非同期ステップ1（jwtVerifyのみ）、分岐3箇所という最小構成である。外部依存はjoseライブラリ1つのみであり、ネットワーク呼び出しは発生しない。"),


      // ── JSON-LD VC deserialization (complexity-annotated) ──
      heading3("5.2.2 JSON-LD VC（循環的複雑度: 8）"),

      bodyPara("付録A.5のリスト10にJSON-LD VCのデシリアライズ処理を示す。コード行数35行、非同期ステップ4、分岐8箇所と3フォーマット中で最も複雑である。特に、外部コンテキストのHTTP取得（2回）とURDNA2015正規化が複雑性の主因となっている。コメント中の「★NETWORK」「★DoS RISK」は、セキュリティ上の注意を要する箇所を示す。"),


      // ── mdoc deserialization (complexity-annotated) ──
      heading3("5.2.3 mdoc（循環的複雑度: 5）"),

      bodyPara("付録A.5のリスト11にmdocのデシリアライズ（検証）処理を示す。コード行数25行、非同期ステップ2、分岐5箇所と中間的な複雑性を持つ。CBORデコードとCOSE_Sign1検証の2段階に明確に分離されており、外部ネットワーク呼び出しは一切発生しない。要素ごとのダイジェスト検証ループがあるため、要素数に比例した処理コストが発生する点が特徴的である。"),


      bodyPara("リスト9〜11（付録A.5）の比較から、表6の定量的メトリクスが具体的なコード構造の差異に裏付けられていることがわかる。SD-JWT VCはjwtVerifyの1回の非同期呼び出しで検証が完結するのに対し、JSON-LD VCはコンテキストの取得・展開・正規化・ハッシュ・署名検証・スキーマ検証と多段階の処理を経る。mdocは非同期ステップこそ2つだが、要素ごとのダイジェスト検証ループという固有の処理パターンを持つ。"),

      heading2("5.3 正規化セキュリティテスト"),

      bodyPara("セキュリティテストの結果一覧を表7に示す。JSON-LD VCにおいて3件の構造的脆弱性（ポイズングラフDoS・コンテキストインジェクション・SSRF）が検出されたのに対し、SD-JWT VCおよびmdocでは検証した全攻撃ベクトルが緩和済みまたは該当なしと判定された。"),

      tableCaption("表7 セキュリティテスト結果一覧"),
      makeTable(
        ["テスト項目", "対象", "深刻度", "結果"],
        [
          ["ポイズングラフ DoS (URDNA2015)", "JSON-LD VC", "HIGH", "脆弱"],
          ["コンテキストインジェクション", "JSON-LD VC", "HIGH", "部分的に脆弱"],
          ["リモートコンテキスト経由 SSRF", "JSON-LD VC", "CRITICAL", "脆弱"],
          ["正規化なし（SD-JWT / mdoc）", "SD-JWT / mdoc", "NONE", "該当なし"],
          ["alg:none 攻撃", "SD-JWT VC", "CRITICAL", "緩和済み"],
          ["アルゴリズム混同 RS256→EdDSA", "SD-JWT VC", "HIGH", "緩和済み"],
          ["データ要素改ざん検出", "mdoc", "HIGH", "緩和済み"],
          ["COSEプロテクトヘッダー改ざん", "mdoc", "HIGH", "緩和済み"],
          ["SSRF なし・ネットワーク取得なし", "mdoc", "NONE", "該当なし"],
        ],
        [2800, 1800, 1600, 2000]
      ),
      emptyLine(),

      // ── 4.4 CROSS-LANGUAGE COMPARISON ──
      heading2("5.4 言語・実行環境別の性能比較"),

      bodyPara("Node.jsでのprocess.hrtime.bigint()（ナノ秒精度）による署名検証速度の実測結果を表8に示す。「ライブラリあり」は各フォーマットの標準的なシリアライズ・正規化ライブラリ（jsonld、canonicalize、cbor-x）を使用した場合、「ライブラリなし」はnode:cryptoのみで実装した場合を示す。SD-JWT VCの暗号処理は表3のとおり両モードともnode:cryptoを直接使用するため単一の行（共通）として示し、参考としてjoseライブラリのフルJWTパイプライン（クレーム検証を含むSignJWT/jwtVerify）による計測値も併記する。全ベンチマークをN=2,000×5回実行で計測した。"),

      tableCaption("表8 Node.js 署名検証速度 — process.hrtime.bigint()（N=2,000×5回実行の中央値）"),
      makeTable(
        ["フォーマット", "モード", "操作", "平均(ms)", "σ(ms)", "95%CI", "p50(ms)", "p95(ms)", "ops/sec"],
        [
          ["SD-JWT VC", "node:crypto（あり/なし共通）", "sign", "0.044", "0.058", "±0.0025", "0.038", "0.050", "22,787"],
          ["SD-JWT VC", "node:crypto（あり/なし共通）", "verify", "0.120", "0.026", "±0.0011", "0.117", "0.128", "8,321"],
          ["SD-JWT VC", "jose（参考）", "sign", "0.114", "0.094", "±0.0041", "0.101", "0.135", "8,737"],
          ["SD-JWT VC", "jose（参考）", "verify", "0.185", "0.190", "±0.0083", "0.170", "0.199", "5,420"],
          ["JSON-LD VC", "ライブラリあり", "sign", "0.162", "0.313", "±0.0137", "0.101", "0.200", "6,187"],
          ["JSON-LD VC", "ライブラリあり", "verify", "0.200", "0.169", "±0.0074", "0.178", "0.205", "5,011"],
          ["JSON-LD VC", "ライブラリなし", "sign", "0.052", "0.118", "±0.0052", "0.041", "0.054", "19,263"],
          ["JSON-LD VC", "ライブラリなし", "verify", "0.123", "0.031", "±0.0013", "0.120", "0.132", "8,123"],
          ["JSON-LD VC (JCS)", "ライブラリあり", "sign", "0.053", "0.096", "±0.0042", "0.044", "0.061", "18,697"],
          ["JSON-LD VC (JCS)", "ライブラリあり", "verify", "0.128", "0.047", "±0.0021", "0.123", "0.138", "7,840"],
          ["JSON-LD VC (JCS)", "ライブラリなし", "sign", "0.049", "0.067", "±0.0029", "0.044", "0.057", "20,541"],
          ["JSON-LD VC (JCS)", "ライブラリなし", "verify", "0.130", "0.093", "±0.0041", "0.123", "0.136", "7,665"],
          ["mdoc", "ライブラリあり", "sign", "0.102", "0.169", "±0.0074", "0.077", "0.108", "9,773"],
          ["mdoc", "ライブラリあり", "verify", "0.093", "0.019", "±0.0008", "0.090", "0.106", "10,707"],
          ["mdoc", "ライブラリなし", "sign", "0.101", "0.122", "±0.0053", "0.084", "0.120", "9,920"],
          ["mdoc", "ライブラリなし", "verify", "0.095", "0.018", "±0.0008", "0.092", "0.108", "10,546"],
        ],
        [1300, 1500, 600, 850, 800, 900, 900, 900, 950]
      ),
      emptyLine(),

      bodyPara("ナノ秒精度での計測結果は以下のとおりである。署名速度（p50）ではSD-JWT VC（0.038 ms/op）が最速であり、mdoc（ライブラリあり: 0.077 ms/op）、JSON-LD VC（0.101 ms/op）が続いた。検証速度（p50）ではmdocが最速（0.090 ms/op、σ=0.019）であり、SD-JWT VC（0.117 ms/op、σ=0.026）、JSON-LD VC（0.178 ms/op、σ=0.169）の順であった。注目すべきは、ライブラリなし実装ではJSON-LD VCの署名がp50: 0.041 ms/op、検証がp50: 0.120 ms/opとSD-JWT VC（署名0.038 ms、検証0.117 ms）とほぼ同等の性能を示す点であり、JSON-LD VCの性能差がフォーマット仕様ではなくjsonldライブラリのJSON-LDプロセッシングオーバーヘッドに起因することが明確に示された。また、JSON-LD VC (JCS)はライブラリありでも署名p50: 0.044 ms/op・検証p50: 0.123 ms/opと、URDNA2015の代わりにJCS正規化を用いることでSD-JWT VCに近いレイテンシを実現した。"),

      bodyPara("「ライブラリあり」と「ライブラリなし」の比較では、JSON-LD VCのみ顕著な差が見られた（署名p50: 0.101 vs 0.041 ms/opでライブラリなしが約2.5倍高速）。これはjsonldライブラリのJSON-LDプロセッシングオーバーヘッドが支配的であることを示す。SD-JWT VCは両モードとも暗号処理がnode:crypto共通であり、mdocもcbor-xと手書きCBORの差は小さい。参考計測として、joseライブラリのフルJWTパイプライン（トークンパース・クレーム検証を含む）ではSD-JWT VCの署名がp50: 0.101 ms/op・検証がp50: 0.170 ms/opとなり、生の暗号演算に対して約1.5〜2.7倍のライブラリオーバーヘッドが存在することが確認された。実運用の検証レイテンシは、暗号演算そのものよりも周辺のライブラリパイプラインに律速される可能性がある点に留意が必要である。"),

      bodyPara("図1〜3に、各言語環境における「ライブラリあり」モードでの署名・検証速度の比較（いずれもp50）を示す。3言語とも表2の同一サーバ上で、同一のクレデンシャル・同一の計測手法（ナノ秒精度タイマ、N=2,000×5回実行の中央値、統計は共通スクリプトで一元計算）により計測した。使用ライブラリは、Node.js: jsonld@8.3.3・cbor-x@1.6.4（図1）、Python 3.12.3: PyLD 3.1.0・cbor2 6.1.3・cryptography 49.0.0（図2）、Go 1.22.2: piprate/json-gold v0.8.0・fxamacker/cbor v2.9.2（図3）である。言語間の比較は絶対値ではなくフォーマット間の相対順位と傾向の確認を目的とする。"),

      // ── Figure 1: TypeScript ──
      tableCaption("図1 署名・検証速度 — Node.js（ライブラリあり, hrtime, p50）"),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new ImageRun({
            data: fs.readFileSync(__dirname + "/chart_ts.png"),
            transformation: { width: 480, height: 280 },
            type: "png",
          }),
        ],
      }),
      emptyLine(),

      // ── Figure 2: Python ──
      tableCaption("図2 署名・検証速度 — Python（ライブラリあり, p50）"),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new ImageRun({
            data: fs.readFileSync(__dirname + "/chart_python.png"),
            transformation: { width: 480, height: 280 },
            type: "png",
          }),
        ],
      }),
      emptyLine(),

      // ── Figure 3: Go ──
      tableCaption("図3 署名・検証速度 — Go（ライブラリあり, p50）"),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new ImageRun({
            data: fs.readFileSync(__dirname + "/chart_go.png"),
            transformation: { width: 480, height: 280 },
            type: "png",
          }),
        ],
      }),
      emptyLine(),

      bodyPara("図1のNode.jsでは、署名はSD-JWT VCが最速（0.038 ms）、検証はmdocが最速（0.090 ms）であった。図2のPythonでは署名はSD-JWT VC（0.036 ms）、検証はmdoc（0.074 ms）が最速で、JSON-LD VC（PyLD）は署名0.253 ms・検証0.340 msと3言語中で最も正規化コストが大きい（PyLDの正規化単体でp50: 0.206 ms）。図3のGoでは署名はSD-JWT VC（0.028 ms）が最速だが、検証はmdoc（0.079 ms）よりもSD-JWT VC（0.064 ms）が高速であり、Node.js・Pythonとは順位が逆転した。これはGo標準ライブラリのEd25519検証がOpenSSL系実装（Node/PythonのECDSA P-256検証が相対的に高速）と異なる最適化特性を持つためであり、SD-JWT VCとmdocの検証の相対順位が言語の暗号実装に依存することを同一環境で実証した結果である。一方、3言語を通じて、本稿のライブラリあり実装条件ではJSON-LD VC withLib（URDNA2015正規化を含む）が署名・検証とも最も遅いという傾向は一貫しており（Node: 検証0.178 ms、Go: 0.216 ms、Python: 0.340 ms）、URDNA2015正規化のオーバーヘッドが特定の言語実装ではなく仕様レベルの特性であることが確認された。"),

      // ── 4.5 SERIALIZATION SPEED ──
      heading2("5.5 シリアライズ速度（暗号処理なし）"),

      bodyPara("署名検証を伴わない純粋なシリアライズ（エンコード/デコード/正規化）速度を表9に示す。これにより、暗号処理を除いたデータ変換のオーバーヘッドを評価する。SD-JWT VCはBase64URLエンコード、JSON-LD VCはJSON.parse/stringifyおよびURDNA2015正規化、mdocはCBORエンコードをそれぞれ計測した。加えて、JSON-LD VCについてはURDNA2015に代わるJSON Canonicalization Scheme（JCS, RFC 8785）による正規化速度も計測した。"),

      tableCaption("表9 シリアライズ速度（暗号処理なし、N=2,000×5回実行の中央値）"),
      makeTable(
        ["フォーマット", "操作", "平均(ms)", "σ(ms)", "95%CI", "p50(ms)", "p95(ms)", "ops/sec", "ペイロード(B)"],
        [
          ["SD-JWT VC", "encode", "0.004", "0.027", "±0.0012", "0.002", "0.004", "264,594", "322"],
          ["SD-JWT VC", "decode", "0.005", "0.051", "±0.0022", "0.003", "0.004", "211,999", "322"],
          ["JSON-LD VC", "encode", "0.002", "0.019", "±0.0009", "0.001", "0.003", "485,827", "464"],
          ["JSON-LD VC", "decode", "0.002", "0.007", "±0.0003", "0.002", "0.002", "452,419", "464"],
          ["JSON-LD VC", "URDNA2015 (jsonld)", "0.092", "0.285", "±0.0125", "0.043", "0.089", "10,891", "464"],
          ["JSON-LD VC (JCS)", "JCS (RFC 8785)", "0.011", "0.104", "±0.0045", "0.006", "0.006", "93,669", "612"],
          ["mdoc", "encode", "0.006", "0.099", "±0.0043", "0.003", "0.004", "155,408", "497"],
          ["mdoc", "decode", "0.006", "0.068", "±0.0030", "0.003", "0.004", "169,916", "497"],
        ],
        [1500, 1400, 1000, 900, 950, 950, 950, 1150, 1060]
      ),
      emptyLine(),

      bodyPara("エンコードではSD-JWT VC（Base64URL）がp50: 0.002 ms/op、JSON-LD VC（JSON.stringify）が0.001 ms/op、mdoc（CBORバイナリ）が0.003 ms/opと、いずれもマイクロ秒オーダーであった。JSON-LD VCのJSON encode/decodeはNode.jsネイティブのJSON.parse/stringifyで処理されるため極めて高速である。ペイロード列は、SD-JWT VCはJWTトークン長、JSON-LD VCはURDNA2015正規化後のN-Quads、JSON-LD VC (JCS)はJCS正規化後のJSON、mdocはCBORエンコード後のバイト数を示す。"),

      bodyPara("正規化処理では、JSON-LD VCのURDNA2015正規化（jsonldライブラリ）がp50: 0.043 ms/op（平均0.092、10,891 ops/sec）であるのに対し、JCS（JSON Canonicalization Scheme, RFC 8785）による正規化はp50: 0.006 ms/op（平均0.011、93,669 ops/sec）と約7倍高速であった。JCSはRDFグラフの正規化ではなくJSONの字句的正規化であるため、セマンティック相互運用性は犠牲にするが、ブランクノード処理に伴う計算量爆発のリスクがなく、正規化のみで比較するとURDNA2015の約15%のレイテンシで完了する。"),

      bodyPara("これらのシリアライズ処理（URDNA2015正規化を除きp50で0.006 ms以下）は署名検証（表4: p50 0.090〜0.178 ms）に比べて1〜2桁小さく、署名検証速度の差が暗号アルゴリズム（EdDSA vs ECDSA）および前処理（正規化の有無）に起因し、シリアライゼーション形式自体の差ではないことを裏付けている。mdocのCBORペイロード（497 bytes）はcbor-xライブラリによるバイナリエンコードの効率性を反映している。なお、ここでのURDNA2015計測はブランクノードをほぼ含まない単純なクレデンシャルに対するものであり、複雑なクレデンシャルでは正規化コストが支配的となる（5.11節）。"),


      // ── 5.6 ATTRIBUTE SCALING ──
      heading2("5.6 属性数スケーリング評価"),

      bodyPara("属性数を5、20、100、500と変化させた場合のシリアライズ速度（暗号処理なし、JSON-LD VCはjsonldライブラリによるURDNA2015正規化を含む）の変化を表11および図4に示す。process.hrtime.bigint()によりN=2,000（JSON-LD VCの100属性以上はN=400）×5回実行で計測した。"),

      tableCaption("表11 属性数スケーリング（シリアライズ速度 vs 属性数、N=2,000×5回実行の中央値 †JSON-LD VCの100・500属性はN=400）"),
      makeTable(
        ["フォーマット", "属性数", "平均(ms)", "ops/sec", "σ(ms)", "p50(ms)", "p95(ms)", "サイズ(B)"],
        [
          ["SD-JWT VC", "5", "0.003", "312,515", "0.016", "0.002", "0.004", "272"],
          ["JSON-LD VC", "5", "0.093", "10,776", "0.355", "0.039", "0.082", "681"],
          ["JSON-LD VC (JCS)", "5", "0.014", "70,744", "0.131", "0.006", "0.008", "581"],
          ["mdoc", "5", "0.006", "157,485", "0.112", "0.002", "0.003", "355"],
          ["SD-JWT VC", "20", "0.003", "360,433", "0.005", "0.002", "0.004", "732"],
          ["JSON-LD VC", "20", "0.118", "8,446", "0.300", "0.075", "0.110", "1,716"],
          ["JSON-LD VC (JCS)", "20", "0.011", "89,391", "0.006", "0.011", "0.011", "926"],
          ["mdoc", "20", "0.007", "142,878", "0.011", "0.005", "0.009", "1,300"],
          ["SD-JWT VC", "100", "0.008", "129,261", "0.007", "0.007", "0.010", "3,185"],
          ["JSON-LD VC †", "100", "0.277", "3,608", "0.061", "0.253", "0.419", "7,236"],
          ["JSON-LD VC (JCS)", "100", "0.039", "25,370", "0.007", "0.038", "0.042", "2,766"],
          ["mdoc", "100", "0.031", "32,487", "0.046", "0.030", "0.033", "6,417"],
          ["SD-JWT VC", "500", "0.034", "29,607", "0.031", "0.032", "0.036", "15,452"],
          ["JSON-LD VC †", "500", "1.238", "807", "0.146", "1.184", "1.446", "34,836"],
          ["JSON-LD VC (JCS)", "500", "0.184", "5,435", "0.048", "0.178", "0.192", "11,966"],
          ["mdoc", "500", "0.144", "6,952", "0.161", "0.141", "0.153", "32,262"],
        ],
        [1500, 700, 900, 1000, 800, 800, 800, 1000]
      ),
      emptyLine(),

      tableCaption("図4 属性数スケーリング（シリアライズ速度）"),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new ImageRun({
            data: fs.readFileSync(__dirname + "/chart_scaling.png"),
            transformation: { width: 480, height: 280 },
            type: "png",
          }),
        ],
      }),
      emptyLine(),

      bodyPara("JSON-LD VC（URDNA2015正規化）のシリアライズ時間は属性数に対して線形以上のスケーリングを示し、p50で5属性の0.039 msから500属性の1.184 msへと約30倍に増大した（属性数は100倍）。一方、SD-JWT VCはBase64URLエンコードのみのため属性数の影響が最小限であり、500属性でもp50: 0.032 msにとどまった（JSON-LD VCの約37分の1）。mdocはCBORバイナリエンコードにより500属性でp50: 0.141 msであった。JSON-LD VC（JCS）はJCSの字句的正規化により500属性でp50: 0.178 msとURDNA2015の約15%であった。"),

      bodyPara("ペイロードサイズについても、JSON-LD VC（URDNA2015正規化後のN-Quads）は500属性で34,836 bytesとSD-JWT VC（15,452 bytes）の約2.3倍であり、RDFトリプルの冗長性がサイズ効率に影響している。mdocは32,262 bytesとJSON-LD VCと同程度であるが、CBORバイナリエンコードのため可読性とトレードオフがある。"),

      // ── 5.7 SELECTIVE DISCLOSURE ──
      heading2("5.7 選択的開示性能"),

      bodyPara("全20属性のうち開示する属性数を1、3、5、10、20と変化させた場合の選択的開示（VP構築）処理速度を表12および図5に示す。計測はprocess.hrtime.bigint()（ナノ秒精度）・N=2,000×5回実行で行った。VP構築はマイクロ秒オーダーの処理であり、この水準の差を分解するにはナノ秒精度のタイマが必要である。"),

      tableCaption("表12 選択的開示性能比較（開示属性数別レイテンシ、N=2,000×5回実行の中央値）"),
      makeTable(
        ["フォーマット", "開示数", "平均(ms)", "p50(ms)", "p95(ms)", "σ(ms)", "方式"],
        [
          ["SD-JWT VC", "1/20", "0.007", "0.004", "0.008", "0.028", "SHA-256"],
          ["mdoc", "1/20", "0.013", "0.003", "0.011", "0.169", "CBOR"],
          ["JSON-LD VC", "1/20", "0.003", "0.001", "0.002", "0.043", "URDNA2015"],
          ["JSON-LD (JCS)", "1/20", "0.006", "0.003", "0.003", "0.069", "JCS"],
          ["SD-JWT VC", "3/20", "0.009", "0.004", "0.006", "0.147", "SHA-256"],
          ["mdoc", "3/20", "0.005", "0.003", "0.004", "0.042", "CBOR"],
          ["JSON-LD VC", "3/20", "0.003", "0.002", "0.002", "0.008", "URDNA2015"],
          ["JSON-LD (JCS)", "3/20", "0.007", "0.004", "0.004", "0.090", "JCS"],
          ["SD-JWT VC", "5/20", "0.010", "0.004", "0.006", "0.095", "SHA-256"],
          ["mdoc", "5/20", "0.004", "0.004", "0.004", "0.011", "CBOR"],
          ["JSON-LD VC", "5/20", "0.005", "0.003", "0.003", "0.066", "URDNA2015"],
          ["JSON-LD (JCS)", "5/20", "0.005", "0.004", "0.004", "0.021", "JCS"],
          ["SD-JWT VC", "10/20", "0.005", "0.004", "0.005", "0.006", "SHA-256"],
          ["mdoc", "10/20", "0.005", "0.005", "0.005", "0.010", "CBOR"],
          ["JSON-LD VC", "10/20", "0.005", "0.005", "0.005", "0.006", "URDNA2015"],
          ["JSON-LD (JCS)", "10/20", "0.006", "0.005", "0.006", "0.005", "JCS"],
          ["SD-JWT VC", "20/20", "0.006", "0.006", "0.006", "0.006", "SHA-256"],
          ["mdoc", "20/20", "0.008", "0.007", "0.009", "0.010", "CBOR"],
          ["JSON-LD VC", "20/20", "0.009", "0.008", "0.009", "0.007", "URDNA2015"],
          ["JSON-LD (JCS)", "20/20", "0.009", "0.008", "0.009", "0.005", "JCS"],
        ],
        [1400, 800, 1000, 1000, 1000, 900, 1200]
      ),
      emptyLine(),

      tableCaption("図5 選択的開示性能（開示属性数別）"),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new ImageRun({
            data: fs.readFileSync(__dirname + "/chart_sd.png"),
            transformation: { width: 480, height: 280 },
            type: "png",
          }),
        ],
      }),
      emptyLine(),

      bodyPara("計測の結果、いずれのフォーマットもVP構築処理はp50で1〜8マイクロ秒（0.001〜0.008 ms）のオーダーであり、署名検証（表4: p50 0.090〜0.178 ms）に比べて1〜2桁小さいことが確認された。傾向としては、JSON-LD VC・mdoc・JSON-LD VC (JCS)は開示属性数の増加に伴いレイテンシが単調に増大し（JSON-LD VC: p50で1/20の0.001 ms → 20/20の0.008 ms）、SD-JWT VCは開示数への依存が最も小さかった（p50: 0.004〜0.006 ms）。これは、SD-JWT VCの提示処理が開示対象のディスクロージャ連結のみで完結する一方、他方式では開示サブセットに対する再エンコード・再正規化が必要となるためである。いずれにせよ、選択的開示処理自体はどのフォーマットにおいても支配的なコストではない。"),

      // ── 5.8 CONTEXT LOADER ──
      heading2("5.8 JSON-LDコンテキストローダー比較"),

      bodyPara("JSON-LD VCの署名検証における静的ローダー（ローカルキャッシュ）とリモートローダー（HTTP取得）の性能・セキュリティ差を表13に示す。リモートローダーには50 msのネットワーク遅延をシミュレーションした。本評価はネットワーク遅延の影響という定性的な差（3桁の乖離）を示す探索的評価であり、N=5、ベンチマークツール（VC Comparison Tool）のブラウザモードでの計測値である（linux-benchによる性能計測とは独立）。"),

      tableCaption("表13 JSON-LDコンテキストローダー比較（N=5、探索的評価）"),
      makeTable(
        ["ローダー", "平均(ms)", "p95(ms)", "σ(ms)", "SSRFリスク"],
        [
          ["静的ローダー（制限あり）", "0.06", "0.20", "0.080", "安全"],
          ["リモートローダー（50ms遅延）", "51.54", "52.60", "0.809", "危険"],
        ],
        [3200, 1400, 1400, 1200, 1200]
      ),
      emptyLine(),

      bodyPara("リモートローダー使用時の検証レイテンシは51.54 msであり、静的ローダー（0.06 ms）の約859倍であった。これはネットワーク遅延がそのまま検証レイテンシに加算されるためである。さらに、リモートローダーは攻撃者が@contextに任意のURLを指定できるため、SSRF（Server-Side Request Forgery）リスクが存在する。本番環境では静的document loaderまたはcontext allowlistの使用が必須である。"),

      // ── 5.9 URDNA2015 CALL LIMIT ──
      heading2("5.9 URDNA2015 call limitによるDoS緩和"),

      bodyPara("URDNA2015正規化のcall limit設定有無によるDoS耐性の比較を表14に示す。循環構造を持つブランクノードグラフを入力として使用した。"),

      tableCaption("表14 URDNA2015 call limit有無の比較"),
      makeTable(
        ["グラフ", "タイムアウト", "計測時間(ms)", "状態"],
        [
          ["2ノード循環グラフ", "なし", "1.6", "完了"],
          ["2ノード循環グラフ", "あり", "0.6", "完了"],
          ["4ノード循環グラフ", "なし", "3.1", "完了"],
          ["4ノード循環グラフ", "あり", "0.7", "完了"],
          ["6ノード循環グラフ", "なし", "1.3", "完了"],
          ["6ノード循環グラフ", "あり", "1.2", "完了"],
          ["8ノード循環グラフ", "なし", "1.7", "完了"],
          ["8ノード循環グラフ", "あり", "1.7", "完了"],
        ],
        [2800, 1800, 1800, 1800]
      ),
      emptyLine(),

      bodyPara("2〜8ノードの小規模循環グラフでは、顕著なDoSは再現されなかった。call limitの有無による処理時間の差は小さく（0.6〜3.1 ms）、いずれも正常に完了した。これは小規模グラフではURDNA2015の最悪ケース計算量（RDFC-1.0仕様 [9] で文書化されている指数的増大）が顕在化しないためである。ただし、URDNA2015の既知の最悪計算量特性を踏まえると、より大規模なブランクノードグラフ（20ノード以上）に対してcall limitは防御的実装として必要である。本稿の実験は、その緩和策の実装可能性と小規模ケースでの挙動を確認したものである。"),

      // ── 5.10 ED25519 UNIFIED ──
      heading2("5.10 Ed25519統一アルゴリズムベンチマーク"),

      bodyPara("表4の主要ベンチマークではSD-JWT VC・JSON-LD VCにEd25519、mdocにECDSA P-256を使用しており、署名アルゴリズムの差が交絡因子となっている。この交絡を分離するため、全3フォーマットをEd25519で統一し、ペイロードも5属性に揃えた場合のベンチマーク結果を表15に示す。実装水準は表4のライブラリあり構成と同一（mdocのCOSE algのみ-8/EdDSAに変更）であり、process.hrtime.bigint()によりN=2,000×5回実行で計測した。"),

      tableCaption("表15 Ed25519統一ベンチマーク（全フォーマット同一アルゴリズム・同一属性数、N=2,000×5回実行の中央値）"),
      makeTable(
        ["フォーマット", "操作", "平均(ms)", "ops/sec", "σ(ms)", "p50(ms)", "p95(ms)"],
        [
          ["SD-JWT VC", "sign", "0.045", "22,363", "0.060", "0.040", "0.052"],
          ["SD-JWT VC", "verify", "0.121", "8,262", "0.030", "0.118", "0.130"],
          ["JSON-LD VC", "sign", "0.170", "5,872", "0.322", "0.108", "0.309"],
          ["JSON-LD VC", "verify", "0.199", "5,024", "0.134", "0.180", "0.207"],
          ["mdoc", "sign", "0.071", "14,128", "0.155", "0.053", "0.068"],
          ["mdoc", "verify", "0.116", "8,598", "0.005", "0.115", "0.124"],
        ],
        [1600, 1000, 1200, 1200, 1000, 1200, 1200]
      ),
      emptyLine(),

      bodyPara("Ed25519で統一した場合、署名ではSD-JWT VC（p50: 0.040 ms/op）が最速であり、mdoc（0.053 ms/op）、JSON-LD VC（0.108 ms/op）が続いた。検証ではSD-JWT VC（p50: 0.118 ms/op）とmdoc（p50: 0.115 ms/op）が測定変動の範囲内で同等となり、JSON-LD VCは0.180 ms/opと約1.5倍であった。注目すべきはmdocの検証であり、ECDSA P-256使用時（表4: p50 0.090 ms/op）と比較してEd25519使用時は0.115 ms/opと約1.3倍に増大した。すなわち、mdocのデフォルト構成における検証の高速性は、CBOR/COSE構造ではなくOpenSSLにおけるECDSA P-256検証実装の高速性に部分的に依存している。また署名では逆に、mdocのEd25519使用時（0.053 ms/op）はECDSA P-256使用時（0.077 ms/op）より高速であった。一方、JSON-LD VCの残余の性能差（対SD-JWT比約1.5倍）はURDNA2015正規化とJSON-LDプロセッシングに起因する検証パイプライン固有のオーバーヘッドであり、アルゴリズムを統一しても解消されないことが確認された。"),

      // ── 5.11 COMPLEX CREDENTIALS ──
      heading2("5.11 複雑クレデンシャルにおけるURDNA2015正規化"),

      bodyPara("主要ベンチマークで使用した単純なクレデンシャル（5クワッド、実質的なブランクノードなし）に対し、実運用スキーマを用いた複雑なクレデンシャルでのURDNA2015正規化コストを表16に示す。評価対象は、教育分野で広く使用される1EdTech OpenBadges v3.0（OB3）のAchievementCredential（criteria・alignment・result等のidを持たないノードを含む）、DCC（Digital Credentials Consortium）が発行する学位クレデンシャルを模したOB3プロファイルのサンプル、およびブランクノード数の影響を分離するための合成クレデンシャル（idなし子ノード10個・50個）である。いずれもJSON-LDコンテキストは静的埋め込みであり、ネットワークI/Oは計測に含まれない。"),

      tableCaption("表16 複雑クレデンシャルのURDNA2015正規化（jsonldライブラリ、5回実行の中央値 N=1,000 †OB3・DCC型・ブランクノード50はN=200）"),
      makeTable(
        ["クレデンシャル", "クワッド数", "ブランクノード数", "平均(ms)", "σ(ms)", "p50(ms)", "p95(ms)", "対単純比(p50)"],
        [
          ["単純（表4と同一）", "5", "1", "0.088", "0.220", "0.049", "0.125", "1.0x"],
          ["OpenBadges v3.0", "32", "4", "2.449", "2.853", "1.992", "4.019", "40.7x"],
          ["DCC型学位クレデンシャル", "21", "2", "1.731", "2.847", "1.089", "3.188", "22.2x"],
          ["合成（ブランクノード10）", "43", "10", "0.323", "0.579", "0.188", "1.742", "3.8x"],
          ["合成（ブランクノード50）†", "203", "50", "0.770", "0.124", "0.751", "0.775", "15.3x"],
        ],
        [2200, 1000, 1200, 900, 900, 900, 900, 1060]
      ),
      emptyLine(),

      tableCaption("図6 複雑クレデンシャルのURDNA2015正規化（p50）"),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new ImageRun({
            data: fs.readFileSync(__dirname + "/chart_complex.png"),
            transformation: { width: 480, height: 280 },
            type: "png",
          }),
        ],
      }),
      emptyLine(),

      bodyPara("OB3クレデンシャルの正規化はp50で1.992 msと、単純なクレデンシャル（0.049 ms）の約41倍に達した。これは署名検証全体（表4: p50 0.090〜0.178 ms）の10倍以上であり、実運用スキーマではURDNA2015正規化が検証パイプラインの支配的コストとなることを示す。DCC型クレデンシャルでも約22倍（p50: 1.089 ms）であった。増大の要因は2つある。第一に、OB3の大規模なJSON-LDコンテキスト（数百の用語定義）の展開処理であり、クワッド数（32）やブランクノード数（4）に比して処理時間が大きいのはこのためである。第二に、ブランクノードの正準ラベル付けであり、合成クレデンシャルの比較（10ノード: 0.188 ms、50ノード: 0.751 ms）から、ブランクノード数に対して超線形にコストが増大することが確認できる。また、OB3・DCC型では平均とp50の乖離およびσが大きく（OB3: 平均2.449 msに対しσ2.853）、複雑なコンテキスト処理はレイテンシの裾も長い。"),

      bodyPara("この結果は、5.1節の「単純なクレデンシャルでは正規化オーバーヘッドが小さい」という観察が実運用スキーマには一般化できないことを示している。教育クレデンシャル（OB3/DCC）のようにJSON-LD VC系フォーマットの採用が進む領域では、コンテキストの事前コンパイル・展開結果のキャッシュ・ブランクノード数の上限設定といった正規化コストの緩和策が実装上重要となる。一方、SD-JWT VCおよびmdocは正規化を必要としないため、スキーマの複雑さが検証コストに与える影響は限定的である。"),

      // ══════════════════════════════════════════════════════════
      // 6. DISCUSSION
      // ══════════════════════════════════════════════════════════
      heading1("6. 考察"),

      heading2("6.1 署名検証性能に関する考察"),

      bodyRuns([
        { text: "SD-JWT VCが署名で最速となる構造的要因は、JWTコンパクトシリアライゼーションの採用により署名対象データの前処理（正規化）が不要である点にある。署名p50: 0.038 ms/op、検証p50: 0.117 ms/opという結果は、EdDSA (Ed25519) の演算コストの低さと前処理レスな構造を反映している。なお、Ed25519統一ベンチマーク（表15）でもSD-JWT VCは署名が最速（p50: 0.040 ms/op）であり、署名についてはアルゴリズムに依存しない構造的優位が確認された（同一アルゴリズム条件の検証はmdocと同等）。一方、参考計測（表8）が示すとおり、" },
        { text: "jose", italics: true },
        { text: "ライブラリのフルJWTパイプライン（" },
        { text: "SignJWT", italics: true },
        { text: " / " },
        { text: "jwtVerify", italics: true },
        { text: "、クレーム検証を含む）を経由した場合は署名0.101 ms・検証0.170 ms（p50）となり、生の暗号演算の1.5〜2.7倍のライブラリオーバーヘッドが加わる。フォーマット構造の優位が実運用の性能に直結するかは、使用するライブラリスタックに依存する。" },
      ]),

      bodyPara("JSON-LD VCの署名処理内訳（表5）から、単純なクレデンシャルではURDNA2015正規化が内訳合計の約52%、Ed25519署名ステップが約45%（いずれもp50基準）と同オーダーであった。すなわち、本実験の主要ベンチマークで使用した単純なクレデンシャル（実質的なブランクノードなし）に限れば正規化のオーバーヘッドは署名演算と同程度にとどまる。ただし、この観察は複雑なクレデンシャルには一般化できない。実運用スキーマを用いた評価（5.11節、表16）では、OpenBadges v3.0クレデンシャルの正規化はp50で1.992 msと単純ケースの約41倍に達し、署名検証全体を1桁上回る支配的コストとなった。SHA-256ハッシュ計算（p50: 0.002 ms）はボトルネックではない。"),

      bodyPara("総合的に見ると、JSON-LD VCの検証レイテンシ（p50: 0.178 ms/op）はSD-JWT VC（p50: 0.117 ms/op）の約1.5倍である。特に注目すべきは、ライブラリなし実装ではJSON-LD VCの検証がp50: 0.120 ms/opとSD-JWT VC（0.117 ms/op）と同等の性能を示す点であり、性能差の大部分がjsonldライブラリのJSON-LDプロセッシングオーバーヘッドに起因することが明確になった。ただし、属性数スケーリング（表11）では500属性でJSON-LD VCのURDNA2015正規化がSD-JWT VCの約37倍に増大し、複雑クレデンシャル評価（表16）ではOB3スキーマで約41倍の正規化コストが観測されており、クレデンシャルの規模・構造に伴う性能劣化はフォーマット固有の課題である。"),

      bodyPara("mdocはCBORエンコード/デコード、COSE_Sign1構造の構築、および各データ要素ごとのSHA-256ダイジェスト計算が必要である。署名p50: 0.077 ms/op、検証p50: 0.090 ms/opという結果のうち、検証の速さはCBORのバイナリ効率とNode.js node:cryptoモジュールのECDSA P-256ネイティブ実装による高速性を反映している。特筆すべきは、mdocの検証レイテンシ（p50: 0.090 ms/op）がSD-JWT VC（p50: 0.117 ms/op）よりも約23%高速である点である。ただし、Ed25519統一ベンチマーク（表15）ではmdocの検証はSD-JWT VCと同等になり、この高速性はOpenSSLにおけるECDSA P-256検証実装の速度に部分的に起因することが確認された。この解釈は言語間比較とも整合する: Go標準ライブラリではEd25519検証（0.064 ms）がECDSA P-256検証（0.079 ms）より高速であり、SD-JWT VCとmdocの検証順位が逆転する（5.4節）。一方、署名についてはECDSA P-256がEd25519より遅く（0.077 vs 0.038 ms/op）、mdocの署名はSD-JWT VCの約2倍のレイテンシを示した。"),

      bodyPara("なお、本稿の性能比較では、SD-JWT VCおよびJSON-LD VCにはEd25519（EdDSA）、mdocにはECDSA P-256を使用しており、計測結果にはシリアライゼーション方式の差と署名アルゴリズムの差が混在している。表9のシリアライズ速度（暗号処理なし）の結果から、純粋なデータ変換処理はいずれのフォーマットでもp50で0.006 ms/op以下（URDNA2015正規化を除く）であり、表4の性能差の大部分は署名アルゴリズムと前処理（正規化の有無）に起因する。Ed25519統一ベンチマーク（表15）により、全フォーマットを同一署名アルゴリズム・同一属性数で比較した結果、署名はSD-JWT VCが最速、検証はSD-JWT VCとmdocが同等、JSON-LD VCが約1.5倍となり、mdocのデフォルト構成（ECDSA P-256）での検証の高速性はアルゴリズム選択に依存していることが確認された。詳細はThreats to Validity（8章）で詳述する。"),

      bodyPara("実用上の示唆として、モバイルデバイスや高頻度の検証が求められるユースケース（例：改札通過時のmDL提示）では、SD-JWT VCやmdocのパフォーマンス優位が重要な選定要因となる。一方、JSON-LD VCはセマンティック相互運用性を重視する場面で選択される傾向があり、パフォーマンスはトレードオフとして許容される場合がある。"),

      heading2("6.2 実装複雑性に関する考察"),

      bodyPara("SD-JWT VCのデシリアライズは10行程度で完結し、分岐はalg許可リスト・iss欠落・vct欠落の3箇所のみである。コード量が少ないことは、レビュー・監査のコストが低く、実装ミスに起因する脆弱性の混入リスクも低いことを意味する。"),

      bodyPara("JSON-LD VCは35行のコード、4つの非同期ステップ、循環的複雑度8と3フォーマット中で最も複雑である。特に、外部コンテキスト取得（2回のネットワーク呼び出し）とURDNA2015正規化が複雑性の主因である。@contextに指定されたURLからコンテキスト定義をHTTPで取得する必要があり、本ツールでは静的ローダーで代替しているが、本番環境ではネットワーク遅延・DNS障害・コンテキストサーバーのダウンが直接的な可用性リスクとなる。"),

      bodyPara("mdocは25行・非同柟2ステップ・循環的複雑度5と中間的な複雑性を示す。CBORデコードとCOSE_Sign1検証という明確に分離された2段階の処理であり、外部ネットワーク呼び出しが一切不要である点は運用上の大きな利点である。ただし、要素ごとのダイジェスト検証ループは要素数に比例するため、フィールド数が多いクレデンシャルでは相応の計算コストが発生する。"),

      bodyRunsFlat([
        { text: "開発者体験の観点からは、SD-JWT VCはnode:cryptoのEd25519 sign/verifyの1 API呼び出しで署名検証が完結するため学習コストが低い。JSON-LD VCはJSON-LDプロセッサ・RDF正規化・暗号ライブラリの3層の理解が必要であり、参入障壁が高い。mdocはCBOR/COSEという比較的ニッチな規格への知識が必要だが、処理フロー自体は直線的で理解しやすい。" },
      ], { indent: { firstLine: 480 } }),

      heading2("6.3 セキュリティに関する考察"),

      heading3("6.3.1 JSON-LD/RDFC検証パイプラインの攻撃面"),

      bodyPara("JSON-LD/RDFC系の検証パイプラインは、リモートコンテキスト解決やURDNA2015正規化に由来する追加の攻撃面を持つ。本稿の実験はデフォルト設定（緩和策なし）で実施しており、以下に示すリスクは適切な実装設定（静的document loader、context allowlist、正規化呼び出し制限等）により緩和可能である。重要なのは、これらがJSON-LDフォーマット固有の欠陥ではなく、検証パイプラインと運用設定に依存する攻撃面であるという点である。"),

      bodyRuns([
        { text: "ポイズングラフDoSについて、URDNA2015アルゴリズムはブランクノードの正準ラベル付けにおいて、最悪ケースで指数的な計算量を要する [9]。テストでは20個のブランクノードで構成されたポイズングラフの入力により、通常のクレデンシャル正規化と比較して処理時間が大幅に增大することが確認された。単純なクレデンシャルの正規化がp50: 0.049 msであったのに対し、悪意のない実運用スキーマ（OB3）でも1.992 ms（約41倍、表16）、ブランクノード50個の合成クレデンシャルで0.751 ms（約15倍）に達しており、敵対的に構成されたグラフではさらに大きな增大が見込まれる。実運用環境では、ブランクノード数やイテレーション回数に上限を設けるガードが必須である" },
        { text: "1)", superScript: true },
        { text: "。" },
      ]),

      bodyPara("コンテキストインジェクションについて、JSON-LDの@contextに攻撃者が用語定義を追加することで、issuerやcredentialSubjectといったフィールドの意味（IRI）を書き換えることが可能である。W3C VC Data Integrity仕様 [10] では@protectedキーワードによる用語保護を推奨しているが、本テストではこの保護なしのコンテキストに対して正規化が成功し、用語の上書きが可能であることが確認された。"),

      bodyPara("SSRFについて、JSON-LDプロセッサは@contextに指定されたURLに対してHTTPリクエストを送信する。攻撃者がクラウドメタデータエンドポイント（http://169.254.169.254/latest/meta-data/）や内部ネットワークのURLを@contextに含めることで、SSRF攻撃が成立する。対策として、Document Loaderに許可リスト（allowlist）を適用し、信頼できるコンテキストURLのみを許可する必要がある。本ツールではコンテキストを事前埋め込みすることで、ネットワーク取得自体を排除している。"),

      heading3("6.3.2 SD-JWT VCのセキュリティ"),

      bodyRunsFlat([
        { text: "SD-JWT VCに対するテストでは、alg:none攻撃とアルゴリズム混同攻撃の両方が" },
        { text: "jose", italics: true },
        { text: "ライブラリによって適切に拒否された。これはRFC 8725（JWT Best Current Practices）[5] に準拠した実装であることを示す。ただし、" },
        { text: "jose", italics: true },
        { text: "以外のJWT実装ではalg:noneを受理する既知の脆弱性が存在し" },
        { text: "2)", superScript: true },
        { text: "、ライブラリ選定時のセキュリティ実績が重要である。また、アルゴリズム混同攻撃の防御には、検証側でalgorithmsオプションを明示的に指定する必要がある。" },
      ], { indent: { firstLine: 480 } }),

      heading3("6.3.3 mdocのセキュリティ"),

      bodyPara("mdocは本稿で検証した2つの改ざん検出テスト（データ要素改ざん、COSEヘッダー改ざん）の両方で改ざんを正しく検出した。各データ要素は個別にSHA-256ダイジェストが計算され、MSO（Mobile Security Object）内のダイジェスト値と照合されるため、要素値の改ざんが検出される。COSE_Sign1のSig_Structureにはプロテクトヘッダーが含まれるため、ヘッダー改ざんは署名検証の失敗として検出される。RFC 9052 [6] の設計により、アルゴリズムダウングレード攻撃が構造的に防止されている。また、mdocは外部URLの参照メカニズムを持たないため、SSRFやコンテキストインジェクションのリスクは構造的に存在しない。ただし、本稿で検証した攻撃ベクトルは限定的であり、ISO/IEC 18013-5のオンライン提示（18013-7/OID4VP）におけるセッション暗号化、nonce管理、reader authenticationなどのプロトコルレベルのセキュリティは評価対象外である。"),

      heading2("6.4 フォーマット特性のトレードオフ構造"),

      bodyPara("3フォーマットの比較から、以下のトレードオフ構造が浮かび上がる。SD-JWT VCは署名速度最速級・実装最シンプル・ライブラリエコシステムが成熟しているが、セマンティック相互運用性を持たない。JSON-LD VCはVCDMのJSON-LD表現に基づく実装でありセマンティック相互運用性を提供するが、ライブラリあり条件での性能・実装複雑性・セキュリティの3軸で劣位にある（ただしライブラリなしでは署名・検証ともSD-JWT VCと同等の性能を示す）。属性数スケーリング（表11）ではJSON-LD VCのURDNA2015正規化コストが属性数に対して線形以上に増大することが確認され、大規模クレデンシャルでの使用には注意が必要である。mdocはISO/IEC 18013-5に準拠したモバイル身分証明書向けフォーマットであり、CBORバイナリの高効率なエンコードと堅牢なセキュリティモデルを兼備するが、汎用VCとしての適用範囲は限定的である。"),

      bodyPara("言語・実行環境別の比較（図1〜3）からも、本稿のライブラリあり実装条件ではJSON-LD VC withLibが最も遅いというトレードオフ構造が実行環境に依存しないことが示唆される。ただし、SD-JWT VCとmdocの検証の相対順位は言語の暗号実装に依存し、Node.js・Pythonではmdoc（ECDSA P-256）、GoではSD-JWT VC（Ed25519）が高速であった（5.4節）。選択的開示（表12、図5）では、JSON-LD VC・mdoc・JCSは開示属性数の増加に伴いレイテンシが増大する一方、SD-JWT VCは開示数への依存が最も小さく、いずれも数マイクロ秒のオーダーで支配的コストではないことが確認された。シリアライズ速度（表9）の結果から、エンコード/デコードの差異は暗号処理に比べて無視できる水準であり、フォーマット選定においてシリアライゼーション形式の違いは主要な判断要因とはならないことが確認された。一方、複雑クレデンシャル評価（表16）が示すとおり、JSON-LD VC系ではスキーマの複雑さ（コンテキスト規模・ブランクノード数）が正規化コストとして検証レイテンシに直接影響するため、採用スキーマの構造がフォーマット選定上の考慮事項となる。"),

      heading2("6.5 ユースケース別の推奨"),

      tableCaption("表10 ユースケース別の推奨フォーマット"),
      makeTable(
        ["ユースケース", "推奨", "主な理由"],
        [
          ["Webサービスでの認証・認可", "SD-JWT VC", "最高性能、JWTエコシステムの成熟度"],
          ["分散型IDエコシステム間連携", "JSON-LD VC", "セマンティック相互運用性が必須"],
          ["モバイル身分証明書 (mDL等)", "mdoc", "ISO準拠・オフライン検証可能"],
          ["教育・学修歴クレデンシャル (OpenBadges v3.0, CLR, DCC等)", "JSON-LD VC (OB3プロファイル)", "1EdTech標準・教育エコシステムとの互換性が必須。ただし正規化コスト（表16）への対策（コンテキストキャッシュ、ブランクノード上限）が前提"],
          ["高スループットな学修歴検証（採用スクリーニング等の一括検証）", "SD-JWT VC + OB3語彙", "OB3のクレームをSD-JWTペイロードに格納し、正規化レスで検証可能。セマンティック処理が不要な場合の代替"],
          ["高頻度・低レイテンシ検証", "SD-JWT / mdoc", "正規化オーバーヘッドなし"],
          ["セキュリティ最優先環境", "mdoc / SD-JWT", "外部依存なく攻撃面が小さい"],
        ],
        [2500, 2000, 4860]
      ),
      emptyLine(),

      bodyPara("教育分野の補足として、1EdTech OpenBadges v3.0 [19] およびComprehensive Learner Record（CLR）はVCDM準拠のJSON-LD VCとして定義されており、DCC [20] やJFF PlugfestなどのVC相互運用性の取り組みも同プロファイルを採用している。したがって教育クレデンシャルではJSON-LD VCが事実上の標準であるが、5.11節で示したとおりOB3スキーマの正規化コストは単純なクレデンシャルの約41倍に達するため、大量検証を行うVerifier（例：採用時の一括資格確認）ではコンテキストの静的埋め込み・正規化結果のキャッシュ等の実装対策、またはEnveloping Proof（JOSE/COSE）系プロファイルの検討が推奨される。"),

      // ══════════════════════════════════════════════════════════
      // 7. LIMITATIONS
      // ══════════════════════════════════════════════════════════
      heading1("7. 制約と今後の課題"),

      bodyPara("本研究にはいくつかの制約がある。第一に、計測環境はSMT無効化・未使用コアのオフライン化・コア固定を施した計測専用サーバであるが、クラウドVM上にあるためハイパーバイザ層の影響を完全には排除できない。本稿では独立5回実行の統計量中央値・外れ値の報告・p50主体の解釈によりこの影響を緩和している（実行間p50変動は大半で3%以内）。また、JITコンパイラの最適化やガベージコレクションの影響は依然として存在し、より厳密な計測には物理ベアメタルサーバやC/Rust等のシステム言語による計測も望ましい。"),

      bodyPara("第二に、ポイズングラフの規模20ノードでの計測は概念実証としては十分だが、実際のDoS攻撃では数百〜数千のブランクノードが使用される可能性がある。より大規模な入力での挙動評価が必要である。"),

      bodyPara("第三に、SSRFテストではリモートURLの存在を静的に分析しており、実際のHTTPリクエスト送信は行っていない。実環境での検証にはサンドボックス内でのネットワーク挙動確認が必要である。"),

      bodyPara("第四に、言語別比較（図1〜3）は同一サーバで実施したが、各言語のランタイム特性（Go: ネイティブバイナリ、Python: CPythonインタプリタ、TypeScript: V8 JIT）と暗号ライブラリ実装（OpenSSL系 vs Go標準ライブラリ等）が異なるため、言語間の絶対的な性能差の解釈には注意が必要である。本実験ではフォーマット間の相対的な性能順位と傾向の確認を主目的としている。"),

      bodyPara("第五に、複雑クレデンシャル評価（5.11節）はOpenBadges v3.0系の2スキーマと合成クレデンシャルに限定しており、mDL名前空間の多要素mdocやEUDIW（eIDAS 2.0）のPID/EAAスキーマなど、他の実運用スキーマへの拡張が今後の課題である。"),

      bodyPara("本稿では属性数スケーリング（5.6節）、選択的開示（5.7節）、コンテキストローダー比較（5.8節）、URDNA2015 call limit（5.9節）、Ed25519統一ベンチマーク（5.10節）、複雑クレデンシャルの正規化評価（5.11節）を追加的に評価した。今後の課題として、物理ベアメタルサーバでの追試、より大規模なブランクノードを含むポイズングラフ（20ノード以上）でのDoS耐性の定量化、ブラウザ/WebCrypto環境での計測、メモリ使用量の計測、および追加の言語・ランタイム環境（Rust、Java等）への拡張が挙げられる。"),

      // ══════════════════════════════════════════════════════════
      // 8. THREATS TO VALIDITY
      // ══════════════════════════════════════════════════════════
      heading1("8. Threats to Validity"),

      bodyPara("本稿の結果の一般化可能性に影響する妥当性への脅威について述べる。"),

      bodyPara("内的妥当性（Internal Validity）：ベンチマークはNode.js V8ランタイム上でprocess.hrtime.bigint()を用いて計測しており、JITコンパイラの最適化段階、GCポーズ、イベントループの介入が結果に影響する可能性がある。ウォームアップ50回・N=2,000イテレーション・独立5回実行の統計量中央値を報告し、外れ値（Tukey 1.5×IQR基準）は除去せず件数を報告した上で、代表値には外れ値の影響を受けにくいp50を用いているが、GCポーズの影響は完全には排除できない。また、計測はSMT無効化・コア固定を施した専用サーバで実施したが、クラウドVM上にあるためハイパーバイザ層の影響を完全には排除できず、ハードウェア依存性も残る（物理ベアメタルでの追試は今後の課題、7章）。"),

      bodyPara("構成妥当性（Construct Validity）：各フォーマットのベンチマークでは、SD-JWT VCおよびJSON-LD VCにEd25519、mdocにECDSA P-256を使用しており、計測結果には検証パイプライン（正規化・前処理）の差と署名アルゴリズムの差が交絡している。これは各エコシステムの代表的なアルゴリズム選択に基づくものであるが、フォーマット固有の性能差を厳密に評価するには、全フォーマットを同一署名アルゴリズムで揃えた比較が必要である。本稿ではEd25519統一ベンチマーク（表15）によりこの交絡を部分的に分離し、署名についてはSD-JWT VCが署名アルゴリズムに依存せず最速であることを確認した。一方、mdocはEd25519使用時に検証がECDSA P-256使用時の約1.3倍（p50: 0.115 vs 0.090 ms/op）となり、mdocの検証の高速性がアルゴリズム選択に部分的に依存することが判明した（5.4節の言語間比較とも整合する）。表9のシリアライズ速度（暗号処理なし）および属性数スケーリング（表11）も、フォーマット固有のオーバーヘッド分離に寄与する。"),

      bodyPara("外的妥当性（External Validity）：主要な署名検証ベンチマーク（表4, 表8）で使用したクレデンシャルは氏名・生年月日・住所等の少数フィールドから構成される単純な構造である。属性数スケーリングについては5.6節（表11）で5〜500属性のシリアライズ速度を、ネスト構造とブランクノードを含む複雑なスキーマについては5.11節（表16）でOpenBadges v3.0・DCC型・合成クレデンシャルの正規化速度をそれぞれ評価したが、対象スキーマは教育系OB3プロファイル中心であり、他分野の実運用スキーマへの一般化には追試を要する。また、計測はx86_64（AMD EPYC）サーバ上のNode.js・Go・Pythonで実施しており、言語間では相対的な性能順位と傾向の確認にとどまる。ブラウザ/WebCrypto環境やモバイル端末、他のCPUアーキテクチャでの結果は異なる可能性がある（実際、開発過程で用いたarm64仮想環境では絶対値が本サーバの2〜3倍高速であり、ハードウェアにより絶対値は大きく変動する）。"),

      bodyPara("セキュリティ評価の妥当性：JSON-LD VCに対するセキュリティテストはデフォルト設定（document loader制限なし、call limit未設定、context allowlist未適用）で実施しており、本番環境の推奨設定を適用した場合のリスク緩和効果は定量的に評価していない。SD-JWT VCおよびmdocに対するテストは限定的な攻撃ベクトル（alg:none、アルゴリズム混同、データ改ざん）のみを対象としており、包括的なセキュリティ監査ではない。"),

      bodyPara("実装複雑性の妥当性：LOC（コード行数）は実装スタイル、エラーハンドリングの有無、ライブラリ利用度に大きく依存する。循環的複雑度はデシリアライズ関数全体を対象としているが、関数の分割粒度により値が変動する。外部依存ライブラリ数はサプライチェーンリスクの代理指標ではあるが、ライブラリの成熟度、CVE履歴、transitive dependency数、メンテナンス状況は評価していない。したがって、実装複雑性の結果は「本稿の参照実装および評価メトリクスにおける」比較として解釈されるべきである。"),

      // ══════════════════════════════════════════════════════════
      // 9. CONCLUSION
      // ══════════════════════════════════════════════════════════
      heading1("9. 結論"),

      bodyPara("本稿は、SD-JWT VC・JSON-LD VC・mdocの3フォーマットについて、署名検証性能・実装複雑性・セキュリティの3軸で再現可能な比較評価を実施し、実装者・標準化関係者がフォーマット選定時に参照できる定量的データを提供した。"),

      bodyPara("署名検証性能においては、SMT無効化・コア固定を施した専用Linuxサーバでのナノ秒精度計測（N=2,000×5回実行、中央値ベース）の結果、署名速度ではSD-JWT VCが最速（p50: 0.038 ms/op）、mdoc（0.077 ms/op）、JSON-LD VCが0.101 ms/opであった。検証速度ではmdocがp50: 0.090 ms/opと最速であり、SD-JWT VC（0.117 ms/op）より約23%高速、JSON-LD VC（0.178 ms/op）はSD-JWT VCの約1.5倍であった。ライブラリなし実装ではJSON-LD VCの署名・検証がSD-JWT VCとほぼ同等であり、性能差の大部分がjsonldライブラリのオーバーヘッドに起因することが判明した。3言語（Node.js・Go・Python）を同一サーバで比較した結果、JSON-LD VC（ライブラリあり）が最も遅い傾向は言語に依存せず一貫する一方、SD-JWT VCとmdocの検証の相対順位は言語の暗号実装に依存することを実証した。属性数スケーリング評価では、JSON-LD VCのURDNA2015正規化が500属性でSD-JWT VCの約37倍と線形以上の増大を示した。さらに、実運用の教育スキーマを用いた複雑クレデンシャル評価では、OpenBadges v3.0クレデンシャルの正規化が単純なクレデンシャルの約41倍（p50: 1.992 ms）に達し、実運用スキーマではURDNA2015正規化が検証パイプラインの支配的コストとなることを示した。Ed25519統一ベンチマークにより、署名アルゴリズムの差と検証パイプラインの差を分離して評価した結果、署名はSD-JWT VCが同一アルゴリズム条件でも最速、検証はSD-JWT VCとmdocが同等となり、mdocのデフォルト構成における検証の高速性がECDSA P-256/COSE構成に部分的に依存することを確認した。本稿の参照実装および評価メトリクスにおいては、SD-JWT VCがコード行数10・循環的複雑度3と最も単純であり、JSON-LD VCは35行・複雑度8と最も複雑であった。"),

      bodyPara("セキュリティの観点では、JSON-LD/RDFC系の検証パイプラインはリモートコンテキスト解決やURDNA2015正規化に由来する追加の攻撃面を持ち、適切な緩和策（静的document loader、context allowlist、call limit等）を欠くデフォルト設定ではDoS・コンテキストインジェクション・SSRFのリスクが顕在化し得ることを確認した。これらはフォーマット固有の欠陥ではなく、検証パイプラインと運用設定に依存する攻撃面である。SD-JWT VCとmdocは、本稿で検証した攻撃ベクトルに対して標準的な検証設定で耐性を示した。"),

      bodyPara("フォーマット選定においては、対象ユースケースの要件（相互運用性・パフォーマンス・セキュリティ・規制準拠）を総合的に評価し、トレードオフを明示的に受容した上で判断することが重要である。本稿の評価フレームワークとベンチマークツールはオープンソースとして公開しており [14]、異なる環境・条件での再現実験に資することを期待する。"),

      // ══════════════════════════════════════════════════════════
      // APPENDIX
      // ══════════════════════════════════════════════════════════
      new Paragraph({ children: [new PageBreak()] }),
      heading1("付録A 実装コード"),

      bodyPara("本付録では、各フォーマットの署名生成・検証処理について、実際の計測に使用した実装コードを示す。リスト1・3・5・6は計測キット（linux-bench）のNode.jsエンジン（node/bench.mjs、JavaScript/ESM）からの抜粋であり、計測サーバ（表2）のNode.js v24.18.0上で実行したものである。各ベンチマークは、ウォームアップ後にprocess.hrtime.bigint()で各イテレーションを個別記録する共通のbench / benchAsyncヘルパー（4.3.1の擬似コード）を介して実行される。リスト2・4のデシリアライズ処理は、複雑性分析（4.3.2・表6）の対象とした参照実装（TypeScript）である。"),

      heading2("A.1 SD-JWT VCの署名・検証"),

      bodyRunsFlat([
        { text: "SD-JWT VCの署名・検証は、表3のとおりnode:cryptoのsign / verify呼び出しで完結する（ライブラリあり/なし共通。joseのフルJWTパイプラインは参考計測として別途実行）。リスト1に計測に使用した実装を、リスト2に複雑性分析用のデシリアライズ参照実装を示す。" },
      ], { indent: { firstLine: 480 } }),

      listingCaption("リスト1 SD-JWT VC ベンチマーク実装 (linux-bench/node/bench.mjs)"),
      ...codeBlock([
        "// linux-bench/node/bench.mjs — SD-JWT VC (node:crypto)",
        "async function runSdJwt() {",
        "  const { privateKey, publicKey } =",
        "    crypto.generateKeyPairSync('ed25519')",
        "  const header = b64url(Buffer.from(JSON.stringify(",
        "    { alg: 'EdDSA', crv: 'Ed25519' })))",
        "  const payload = b64url(Buffer.from(JSON.stringify({",
        "    iss: 'https://issuer.example.com',",
        "    vct: 'identity', sub: 'did:example:holder' })))",
        "  const sigInput = `${header}.${payload}`",
        "",
        "  // 署名: JWS Signing Input への Ed25519 署名 + トークン組み立て",
        "  bench('sdjwt/stdcrypto/sign', N, () => {",
        "    const s = crypto.sign(null, Buffer.from(sigInput), privateKey)",
        "    void `${sigInput}.${b64url(s)}`",
        "  })",
        "",
        "  // 検証: トークン分解 + Ed25519 検証",
        "  const token = `${sigInput}.` +",
        "    b64url(crypto.sign(null, Buffer.from(sigInput), privateKey))",
        "  bench('sdjwt/stdcrypto/verify', N, () => {",
        "    const p = token.split('.')",
        "    crypto.verify(null, Buffer.from(`${p[0]}.${p[1]}`),",
        "      publicKey, Buffer.from(p[2], 'base64url'))",
        "  })",
        "}",
      ]),

      listingCaption("リスト2 SD-JWT VC デシリアライズ処理（複雑性分析用の参照実装）"),
      ...codeBlock([
        "async function deserializeSdJwt(",
        "  token: string, publicKey: CryptoKey",
        ") {",
        "  const parts = token.split('.')",
        "  if (parts.length !== 3) throw new Error('Invalid JWT')",
        "",
        "  // alg 許可リスト検証",
        "  const header = JSON.parse(atob(parts[0]))",
        "  if (!['ES256','ES384','EdDSA','RS256'].includes(header.alg))",
        "    throw new Error('Unsupported algorithm')",
        "",
        "  // 署名検証 + クレーム取得（1 API呼び出し）",
        "  const { payload } = await jwtVerify(token, publicKey)",
        "",
        "  // 必須クレーム確認",
        "  if (!payload.iss) throw new Error('Missing issuer')",
        "  if (!payload.vct) throw new Error('Missing vct')",
        "  return payload",
        "}",
      ]),

      heading2("A.2 JSON-LD VCの署名・検証"),

      bodyPara("JSON-LD VCの署名処理は、URDNA2015正規化・SHA-256ハッシュ・Ed25519署名の3段階で構成される。リスト3に計測に使用した実装を示す。正規化にはjsonldライブラリ、ハッシュ・署名にはnode:cryptoを使用する。表5の内訳は、各ステップ（正規化のみ・ハッシュのみ・署名のみ）を同じbenchヘルパーで個別に計測して得たものである。"),

      listingCaption("リスト3 JSON-LD VC ベンチマーク実装 (linux-bench/node/bench.mjs)"),
      ...codeBlock([
        "// linux-bench/node/bench.mjs — JSON-LD VC (jsonld + node:crypto)",
        "async function runJsonLd() {",
        "  const jsonld = (await import('jsonld')).default",
        "  const { privateKey } = crypto.generateKeyPairSync('ed25519')",
        "  const publicKey = crypto.createPublicKey(privateKey)",
        "  const normalize = () => jsonld.normalize(VC_DOC, {",
        "    algorithm: 'URDNA2015',",
        "    format: 'application/n-quads', safe: false })",
        "",
        "  // 署名: URDNA2015正規化 -> SHA-256 -> Ed25519署名",
        "  await benchAsync('jsonld/jsonld-lib/sign', N, async () => {",
        "    const norm = await normalize()",
        "    crypto.sign(null,",
        "      crypto.createHash('sha256').update(norm).digest(),",
        "      privateKey)",
        "  })",
        "",
        "  // 検証: 再正規化 -> SHA-256 -> Ed25519検証",
        "  const sig0 = crypto.sign(null, crypto.createHash('sha256')",
        "    .update(await normalize()).digest(), privateKey)",
        "  await benchAsync('jsonld/jsonld-lib/verify', N, async () => {",
        "    const norm = await normalize()",
        "    crypto.verify(null,",
        "      crypto.createHash('sha256').update(norm).digest(),",
        "      publicKey, sig0)",
        "  })",
        "",
        "  // 正規化単体（表5・表9の正規化行に対応）",
        "  await benchAsync('jsonld/jsonld-lib/normalize-only', N,",
        "    async () => { await normalize() })",
        "}",
      ]),

      listingCaption("リスト4 JSON-LD VC デシリアライズ処理（複雑性分析用の参照実装）"),
      ...codeBlock([
        "async function deserializeJsonLdVc(",
        "  document: Record<string, unknown>,",
        "  signature: Uint8Array, publicKey: Uint8Array",
        ") {",
        "  const loader = makeStaticContextLoader()",
        "",
        "  // 1. @context 検証",
        "  const ctx = document['@context'] as string[]",
        "  if (!ctx.includes(VC_CONTEXT_URL))",
        "    throw new Error('Missing VC context')",
        "",
        "  // 2. proof フィールドを除去",
        "  const { proof, ...docWithoutProof } = document",
        "",
        "  // 3. JSON-LD エクスパンション（ネットワーク取得発生）",
        "  await jsonld.expand(docWithoutProof,",
        "    { documentLoader: loader, safe: false })",
        "",
        "  // 4. URDNA2015 RDF正規化",
        "  //    ブランクノード同定 = グラフ同型問題",
        "  const normalized = await jsonld.normalize(",
        "    docWithoutProof, {",
        "      algorithm: 'URDNA2015',",
        "      format: 'application/n-quads',",
        "      documentLoader: loader, safe: false",
        "    }) as string",
        "",
        "  // 5. SHA-256 ハッシュ",
        "  const hash = await sha256(normalized)",
        "",
        "  // 6. Ed25519 署名検証",
        "  const valid = await ed25519Verify(",
        "    signature, hash, publicKey)",
        "  if (!valid) throw new Error('Signature failed')",
        "",
        "  // 7. VCスキーマ検証",
        "  if (!document['credentialSubject'])",
        "    throw new Error('Missing credentialSubject')",
        "  return document",
        "}",
      ]),

      heading2("A.3 mdoc (ISO 18013-5) の署名・検証"),

      bodyPara("mdocの計測実装は、cbor-xによるCBORエンコード、データ要素ごとのSHA-256ダイジェストからのMSO構築、COSE_Sign1のSig_structureに対するECDSA P-256署名（COSEが用いるraw r||s形式、dsaEncoding: ieee-p1363）で構成される。リスト5に署名側、リスト6に検証側の計測実装を示す。デシリアライズ全体（要素ごとのダイジェスト照合を含む）の参照実装は複雑性分析の対象コード（A.5のリスト11）を参照されたい。"),

      listingCaption("リスト5 mdoc 署名側の計測実装 (linux-bench/node/bench.mjs)"),
      ...codeBlock([
        "// linux-bench/node/bench.mjs — mdoc (cbor-x + node:crypto)",
        "const { encode: cborEncode } = await import('cbor-x')",
        "const { privateKey, publicKey } =",
        "  crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })",
        "",
        "// IssuerSignedItem ごとの SHA-256 ダイジェストから MSO を構築し、",
        "// COSE_Sign1 の Sig_structure を生成",
        "const buildSigStruct = () => {",
        "  const digestMap = new Map()",
        "  let id = 0",
        "  for (const [k, v] of MDOC_FIELDS) {",
        "    const item = cborEncode({ digestID: id,",
        "      elementIdentifier: k, elementValue: v })",
        "    digestMap.set(id++, new Uint8Array(",
        "      crypto.createHash('sha256').update(item).digest()))",
        "  }",
        "  const protHdr = cborEncode(new Map([[1, -7]]))  // alg: ES256",
        "  const msoPayload = cborEncode({",
        "    docType: 'org.iso.18013.5.1.mDL',",
        "    valueDigests: digestMap })",
        "  return cborEncode(['Signature1', protHdr,",
        "    new Uint8Array(0), msoPayload])",
        "}",
        "",
        "// 署名: Sig_structure 構築 + ECDSA P-256（raw r||s）",
        "bench('mdoc/cbor-x/sign', N, () => {",
        "  crypto.sign('SHA256', buildSigStruct(),",
        "    { key: privateKey, dsaEncoding: 'ieee-p1363' })",
        "})",
      ]),

      listingCaption("リスト6 mdoc 検証側の計測実装 (linux-bench/node/bench.mjs)"),
      ...codeBlock([
        "// 検証: COSE_Sign1 署名の ECDSA P-256 検証",
        "const ss0 = buildSigStruct()",
        "const sig0 = crypto.sign('SHA256', ss0,",
        "  { key: privateKey, dsaEncoding: 'ieee-p1363' })",
        "",
        "bench('mdoc/cbor-x/verify', N, () => {",
        "  crypto.verify('SHA256', ss0,",
        "    { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig0)",
        "})",
      ]),

      heading2("A.4 セキュリティテストの実装例"),

      bodyPara("セキュリティテスト（4.3.4）は、ベンチマークツール（VC Comparison Tool）のTypeScript実装で実施した。代表的な実装として、ポイズングラフ生成（リスト7）およびmdocデータ改ざん検出テスト（リスト8）を示す。これらは攻撃の成否と挙動を確認する定性的評価であり、性能計測（linux-bench）とは独立している。"),

      listingCaption("リスト7 ポイズングラフ DoS テスト (normalizationSecurity.ts)"),
      ...codeBlock([
        "function buildPoisonGraph(depth: number) {",
        "  const nodes: Record<string, unknown>[] = []",
        "  for (let i = 0; i < depth; i++) {",
        "    nodes.push({",
        "      '@type': 'http://example.org/Node',",
        "      'http://example.org/link':",
        "        { '@id': `_:b${(i + 1) % depth}` }",
        "    })",
        "    nodes.push({",
        "      '@type': 'http://example.org/Node',",
        "      'http://example.org/link':",
        "        { '@id': `_:b${i}` }",
        "    })",
        "  }",
        "  return { '@graph': nodes }",
        "}",
        "",
        "async function poisonGraphTest() {",
        "  // Baseline: simple credential normalization",
        "  const t0 = performance.now()",
        "  await jsonld.normalize(normalDoc, normalizeOpts)",
        "  const normalMs = performance.now() - t0",
        "",
        "  // Poison: 20-node cyclic blank node graph",
        "  const poisonDoc = buildPoisonGraph(20)",
        "  const t1 = performance.now()",
        "  try {",
        "    await jsonld.normalize(poisonDoc, normalizeOpts)",
        "  } catch {}",
        "  const poisonMs = performance.now() - t1",
        "",
        "  return { normalMs, poisonMs,",
        "    ratio: poisonMs / Math.max(normalMs, 0.1) }",
        "}",
      ]),

      listingCaption("リスト8 mdoc データ要素改ざん検出テスト (normalizationSecurity.ts)"),
      ...codeBlock([
        "async function mdocCborMalleabilityTest() {",
        "  const { privateKey, publicKey } =",
        "    await generateMdocKeyPair()",
        "  const mdocBytes = await issueMdoc(",
        "    MDOC_FIELDS, privateKey)",
        "",
        "  // Tamper: modify element value",
        "  //         without updating digest",
        "  const doc = decode(mdocBytes)",
        "  const items = doc.issuerSigned",
        "    .nameSpaces['org.iso.18013.5.1']",
        "  const originalItem = decode(items[0])",
        "  const tamperedItem =",
        "    { ...originalItem, elementValue: 'ATTACKER' }",
        "  items[0] = encode(tamperedItem)",
        "  const tamperedMdoc = encode(doc)",
        "",
        "  // Verify: should detect digest mismatch",
        "  const valid = await verifyMdoc(",
        "    tamperedMdoc, publicKey).catch(() => false)",
        "  return { caught: !valid }",
        "}",
      ]),

      heading2("A.5 複雑性分析の対象コード（アノテーション付き）"),

      bodyPara("5.2節の複雑性メトリクス（表6）の対象としたデシリアライズ参照実装を示す。コメント中の分岐・非同期・ネットワークの注記が表6の各メトリクスに対応する。"),

      listingCaption("リスト9 SD-JWT VC デシリアライズ — 複雑性アノテーション付き"),
      ...codeBlock([
        "// SD-JWT VC deserialization (~10 LOC)",
        "// 外部依存: jose (1)",
        "// ネットワーク呼び出し: 0",
        "",
        "async function deserializeSdJwt(",
        "  token: string, publicKey: CryptoKey",
        ") {",
        "  // --- 前処理: JWTコンパクト表現を分割 ---",
        "  const parts = token.split('.')",
        "  if (parts.length !== 3)           // ★分岐1",
        "    throw new Error('Invalid JWT format')",
        "",
        "  // --- ヘッダー検証 ---",
        "  const header = JSON.parse(",
        "    atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')))",
        "  if (!['ES256','ES384','EdDSA','RS256']",
        "       .includes(header.alg))       // ★分岐2",
        "    throw new Error('Unsupported algorithm')",
        "",
        "  // --- 署名検証（唯一の非同期ステップ）---",
        "  const { payload } =",
        "    await jwtVerify(token, publicKey)  // ★async 1",
        "",
        "  // --- 必須クレーム確認 ---",
        "  if (!payload.iss)                 // ★分岐3a",
        "    throw new Error('Missing issuer')",
        "  if (!payload.vct)                 // ★分岐3b",
        "    throw new Error('Missing vct claim')",
        "  return payload",
        "}",
      ]),

      listingCaption("リスト10 JSON-LD VC デシリアライズ — 複雑性アノテーション付き"),
      ...codeBlock([
        "// JSON-LD VC deserialization (~35 LOC)",
        "// 外部依存: jsonld, DocumentLoader, sha256,",
        "//           ed25519 (4)",
        "// ネットワーク呼び出し: 2",
        "",
        "async function deserializeJsonLdVc(",
        "  document: Record<string, unknown>,",
        "  signature: Uint8Array,",
        "  publicKey: Uint8Array",
        ") {",
        "  // --- Document Loader 構築 ---",
        "  // ★SSRF RISK: 本番では許可リスト必須",
        "  const loader = makeStaticContextLoader()",
        "",
        "  // --- 1. @context 検証 ---",
        "  const ctx = document['@context'] as string[]",
        "  if (!ctx ||                       // ★分岐1",
        "      !ctx.includes(VC_CONTEXT_URL))// ★分岐2",
        "    throw new Error('Missing VC context')",
        "",
        "  // --- 2. proof フィールド分離 ---",
        "  const { proof: _proof,",
        "    ...documentWithoutProof } = document",
        "",
        "  // --- 3. JSON-LD エクスパンション ---",
        "  // ★NETWORK 1: コンテキストURL取得",
        "  await jsonld.expand(             // ★async 1",
        "    documentWithoutProof,",
        "    { documentLoader: loader,",
        "      safe: false })",
        "",
        "  // --- 4. URDNA2015 RDF 正規化 ---",
        "  // ★DoS RISK: ブランクノード同定 =",
        "  //   グラフ同型問題 → 最悪で指数時間",
        "  // ★NETWORK 2: 追加コンテキスト取得",
        "  const normalized =",
        "    await jsonld.normalize(         // ★async 2",
        "      documentWithoutProof, {",
        "        algorithm: 'URDNA2015',",
        "        format: 'application/n-quads',",
        "        documentLoader: loader,",
        "        safe: false,",
        "      }) as string",
        "",
        "  if (!normalized)                  // ★分岐3",
        "    throw new Error('Empty normalization')",
        "",
        "  // --- 5. SHA-256 ハッシュ ---",
        "  const hash =",
        "    await sha256(normalized)        // ★async 3",
        "",
        "  // --- 6. Ed25519 署名検証 ---",
        "  const valid = await ed25519Verify(// ★async 4",
        "    signature, hash, publicKey)",
        "  if (!valid)                       // ★分岐4",
        "    throw new Error('Signature failed')",
        "",
        "  // --- 7. VCスキーマ検証 ---",
        "  if (!document.type)               // ★分岐5",
        "    throw new Error('Missing type')",
        "  if (!document.issuer)             // ★分岐6",
        "    throw new Error('Missing issuer')",
        "  if (!document.credentialSubject)  // ★分岐7",
        "    throw new Error('Missing subject')",
        "  if (!document.issuanceDate)       // ★分岐8",
        "    throw new Error('Missing issuanceDate')",
        "",
        "  return document",
        "}",
      ]),

      listingCaption("リスト11 mdoc デシリアライズ — 複雑性アノテーション付き"),
      ...codeBlock([
        "// mdoc deserialization (~25 LOC)",
        "// 外部依存: cbor-x, WebCrypto (2)",
        "// ネットワーク呼び出し: 0",
        "",
        "export async function verifyMdoc(",
        "  mdocBytes: Uint8Array,",
        "  publicKey: CryptoKey",
        "): Promise<boolean> {",
        "  // --- 1. CBOR デコード ---",
        "  const doc = decode(mdocBytes)",
        "  if (!doc?.issuerSigned)           // ★分岐1",
        "    throw new Error('Invalid mdoc')",
        "  const { issuerAuth, nameSpaces }",
        "    = doc.issuerSigned",
        "  const [protectedHeader, ,",
        "    msoPayload, signature] = issuerAuth",
        "",
        "  // --- 2. COSE アルゴリズム検証 ---",
        "  const alg = decode(protectedHeader).get(1)",
        "  if (alg !== -7)                   // ★分岐2",
        "    throw new Error('Unexpected alg')",
        "",
        "  // --- 3. COSE_Sign1 署名検証 ---",
        "  const sigStructure = buildSigStructure(",
        "    protectedHeader, msoPayload)",
        "  const valid =",
        "    await crypto.subtle.verify(     // ★async 1",
        "      { name: 'ECDSA', hash: 'SHA-256' },",
        "      publicKey, signature, sigStructure)",
        "  if (!valid)                       // ★分岐3",
        "    return false",
        "",
        "  // --- 4. MSO デコード + ダイジェスト検証 ---",
        "  const mso = decode(msoPayload)",
        "  const storedDigests =",
        "    mso.valueDigests['org.iso.18013.5.1']",
        "  const items =",
        "    nameSpaces['org.iso.18013.5.1']",
        "",
        "  for (let i = 0; i < items.length; i++) {",
        "    const computed = new Uint8Array(",
        "      await crypto.subtle.digest(   // ★async 2",
        "        'SHA-256', items[i]))",
        "    const expected = storedDigests[i]",
        "    if (expected.length !==          // ★分岐4",
        "        computed.length) return false",
        "    for (let j = 0; j < computed.length; j++)",
        "      if (computed[j] !==           // ★分岐5",
        "          expected[j]) return false",
        "  }",
        "  return true",
        "}",
      ]),


      // ══════════════════════════════════════════════════════════
      // REFERENCES
      // ══════════════════════════════════════════════════════════
      new Paragraph({ children: [new PageBreak()] }),
      heading1("参考文献"),
      ...references.map(ref =>
        new Paragraph({
          spacing: { after: 80, line: 300 },
          indent: { left: 480, hanging: 480 },
          children: [new TextRun({ text: ref, font: "Times New Roman", size: 20 })],
        })
      ),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(__dirname + "/VC_Format_Comparison_Paper.docx", buffer);
  console.log("Done: VC_Format_Comparison_Paper.docx");
});
