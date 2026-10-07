const sharp = require('sharp');
const fs = require('fs');

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Bar chart (signature/verification speed) ──
function createBarChartSVG(cfg) {
  const W = 720, H = 420;
  const ml = 80, mr = 30, mt = 55, mb = 70;
  const cw = W - ml - mr, ch = H - mt - mb;
  const allVals = cfg.data.flatMap(d => [d.sign, d.verify]);
  const maxVal = Math.max(...allVals) * 1.25;
  const groupW = cw / cfg.data.length, barW = groupW * 0.28, barGap = 6;
  const sC = '#333333', vC = '#aaaaaa';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="font-family:'Helvetica Neue',Arial,sans-serif">`;
  s += `<rect width="${W}" height="${H}" fill="white"/>`;
  s += `<text x="${W/2}" y="32" text-anchor="middle" font-size="15" font-weight="bold" fill="#333">${esc(cfg.title)}</text>`;
  s += `<text x="18" y="${mt+ch/2}" text-anchor="middle" transform="rotate(-90,18,${mt+ch/2})" font-size="12" fill="#555">${esc(cfg.unit)}</text>`;
  for (let i = 0; i <= 5; i++) {
    const val = (maxVal/5)*i, y = mt+ch-(val/maxVal)*ch;
    s += `<line x1="${ml}" y1="${y}" x2="${ml+cw}" y2="${y}" stroke="#e0e0e0" stroke-width="0.8"/>`;
    s += `<text x="${ml-8}" y="${y+4}" text-anchor="end" font-size="10" fill="#666">${val.toFixed(3)}</text>`;
  }
  cfg.data.forEach((d,i) => {
    const cx = ml + i*groupW + groupW/2;
    const x1 = cx-barW-barGap/2, x2 = cx+barGap/2;
    const sh = (d.sign/maxVal)*ch, vh = (d.verify/maxVal)*ch;
    s += `<rect x="${x1}" y="${mt+ch-sh}" width="${barW}" height="${sh}" fill="${sC}" rx="2"/>`;
    s += `<rect x="${x2}" y="${mt+ch-vh}" width="${barW}" height="${vh}" fill="${vC}" rx="2"/>`;
    s += `<text x="${x1+barW/2}" y="${mt+ch-sh-5}" text-anchor="middle" font-size="9.5" fill="#333" font-weight="600">${d.sign.toFixed(3)}</text>`;
    s += `<text x="${x2+barW/2}" y="${mt+ch-vh-5}" text-anchor="middle" font-size="9.5" fill="#333" font-weight="600">${d.verify.toFixed(3)}</text>`;
    s += `<text x="${cx}" y="${mt+ch+22}" text-anchor="middle" font-size="12" fill="#333">${esc(d.label)}</text>`;
  });
  s += `<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt+ch}" stroke="#333" stroke-width="1.2"/>`;
  s += `<line x1="${ml}" y1="${mt+ch}" x2="${ml+cw}" y2="${mt+ch}" stroke="#333" stroke-width="1.2"/>`;
  const lx = W-180;
  s += `<rect x="${lx}" y="${mt-12}" width="14" height="14" fill="${sC}" rx="2"/>`;
  s += `<text x="${lx+19}" y="${mt-1}" font-size="11" fill="#333">Sign</text>`;
  s += `<rect x="${lx+100}" y="${mt-12}" width="14" height="14" fill="${vC}" rx="2"/>`;
  s += `<text x="${lx+119}" y="${mt-1}" font-size="11" fill="#333">Verify</text>`;
  if (cfg.note) s += `<text x="${W/2}" y="${H-12}" text-anchor="middle" font-size="10" fill="#888" font-style="italic">${esc(cfg.note)}</text>`;
  s += `</svg>`;
  return s;
}

// ── Line chart (scaling / selective disclosure) ──
function createLineChartSVG(cfg) {
  const W = 720, H = 420;
  const ml = 80, mr = 30, mt = 55, mb = 70;
  const cw = W - ml - mr, ch = H - mt - mb;
  const nP = cfg.xLabels.length;
  const allVals = cfg.series.flatMap(s => s.data);
  const maxVal = Math.max(...allVals) * 1.18 || 0.001;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="font-family:'Helvetica Neue',Arial,sans-serif">`;
  s += `<rect width="${W}" height="${H}" fill="white"/>`;
  s += `<text x="${W/2}" y="32" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">${esc(cfg.title)}</text>`;
  s += `<text x="18" y="${mt+ch/2}" text-anchor="middle" transform="rotate(-90,18,${mt+ch/2})" font-size="12" fill="#555">${esc(cfg.unit)}</text>`;
  for (let i = 0; i <= 5; i++) {
    const val = (maxVal/5)*i, y = mt+ch-(val/maxVal)*ch;
    s += `<line x1="${ml}" y1="${y}" x2="${ml+cw}" y2="${y}" stroke="#e0e0e0" stroke-width="0.8"/>`;
    s += `<text x="${ml-8}" y="${y+4}" text-anchor="end" font-size="10" fill="#666">${val.toFixed(3)}</text>`;
  }
  const xStep = cw/(nP-1);
  const xPos = cfg.xLabels.map((_,i) => ml+i*xStep);
  cfg.xLabels.forEach((label,i) => {
    s += `<text x="${xPos[i]}" y="${mt+ch+22}" text-anchor="middle" font-size="11" fill="#333">${esc(String(label))}</text>`;
  });
  // x-axis label
  if (cfg.xLabel) s += `<text x="${ml+cw/2}" y="${mt+ch+45}" text-anchor="middle" font-size="12" fill="#555">${esc(cfg.xLabel)}</text>`;
  cfg.series.forEach(ser => {
    const pts = ser.data.map((val,i) => `${xPos[i]},${mt+ch-(val/maxVal)*ch}`);
    const dash = ser.dash ? ` stroke-dasharray="${ser.dash}"` : '';
    s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${ser.color}" stroke-width="2.5"${dash}/>`;
    ser.data.forEach((val,i) => {
      const x = xPos[i], y = mt+ch-(val/maxVal)*ch;
      s += `<circle cx="${x}" cy="${y}" r="4" fill="${ser.color}"/>`;
      // value label at last point only (or all if few points)
      if (cfg.allLabels || i === nP-1) {
        s += `<text x="${x}" y="${y-8}" text-anchor="middle" font-size="9" fill="#333" font-weight="600">${val.toFixed(3)}</text>`;
      }
    });
  });
  s += `<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt+ch}" stroke="#333" stroke-width="1.2"/>`;
  s += `<line x1="${ml}" y1="${mt+ch}" x2="${ml+cw}" y2="${mt+ch}" stroke="#333" stroke-width="1.2"/>`;
  // legend
  const cols = Math.min(cfg.series.length, 4);
  const lw = cols * 130;
  const lx0 = W/2 - lw/2;
  cfg.series.forEach((ser,i) => {
    const row = Math.floor(i/cols), col = i%cols;
    const x = lx0 + col*130, y = mt - 14 + row*18;
    const ldash = ser.dash ? ` stroke-dasharray="${ser.dash}"` : '';
    s += `<line x1="${x}" y1="${y+6}" x2="${x+18}" y2="${y+6}" stroke="${ser.color}" stroke-width="2.5"${ldash}/>`;
    s += `<circle cx="${x+9}" cy="${y+6}" r="3" fill="${ser.color}"/>`;
    s += `<text x="${x+22}" y="${y+10}" font-size="10" fill="#333">${esc(ser.label)}</text>`;
  });
  if (cfg.note) s += `<text x="${W/2}" y="${H-8}" text-anchor="middle" font-size="10" fill="#888" font-style="italic">${esc(cfg.note)}</text>`;
  s += `</svg>`;
  return s;
}

// ── Single-series bar chart (categorical) ──
function createSingleBarChartSVG(cfg) {
  const W = 720, H = 420;
  const ml = 80, mr = 30, mt = 55, mb = 70;
  const cw = W - ml - mr, ch = H - mt - mb;
  const maxVal = Math.max(...cfg.data.map(d => d.value)) * 1.18;
  const groupW = cw / cfg.data.length, barW = groupW * 0.5;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="font-family:'Helvetica Neue',Arial,sans-serif">`;
  s += `<rect width="${W}" height="${H}" fill="white"/>`;
  s += `<text x="${W/2}" y="32" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">${esc(cfg.title)}</text>`;
  s += `<text x="18" y="${mt+ch/2}" text-anchor="middle" transform="rotate(-90,18,${mt+ch/2})" font-size="12" fill="#555">${esc(cfg.unit)}</text>`;
  for (let i = 0; i <= 5; i++) {
    const val = (maxVal/5)*i, y = mt+ch-(val/maxVal)*ch;
    s += `<line x1="${ml}" y1="${y}" x2="${ml+cw}" y2="${y}" stroke="#e0e0e0" stroke-width="0.8"/>`;
    s += `<text x="${ml-8}" y="${y+4}" text-anchor="end" font-size="10" fill="#666">${val.toFixed(3)}</text>`;
  }
  cfg.data.forEach((d,i) => {
    const cx = ml + i*groupW + groupW/2;
    const h = (d.value/maxVal)*ch;
    s += `<rect x="${cx-barW/2}" y="${mt+ch-h}" width="${barW}" height="${h}" fill="#666666" rx="2"/>`;
    s += `<text x="${cx}" y="${mt+ch-h-6}" text-anchor="middle" font-size="10" fill="#333" font-weight="600">${d.value.toFixed(3)}</text>`;
    s += `<text x="${cx}" y="${mt+ch+22}" text-anchor="middle" font-size="11" fill="#333">${esc(d.label)}</text>`;
  });
  s += `<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt+ch}" stroke="#333" stroke-width="1.2"/>`;
  s += `<line x1="${ml}" y1="${mt+ch}" x2="${ml+cw}" y2="${mt+ch}" stroke="#333" stroke-width="1.2"/>`;
  if (cfg.xLabel) s += `<text x="${ml+cw/2}" y="${mt+ch+45}" text-anchor="middle" font-size="12" fill="#555">${esc(cfg.xLabel)}</text>`;
  if (cfg.note) s += `<text x="${W/2}" y="${H-8}" text-anchor="middle" font-size="10" fill="#888" font-style="italic">${esc(cfg.note)}</text>`;
  s += `</svg>`;
  return s;
}

// ── Chart definitions ──
const tasks = [
  // Fig 1–3: bar charts
  { type:'bar', file:'chart_ts_en.png', cfg:{
    title:'Fig.1 Sign/Verify Speed — Node.js (With Library, hrtime, p50)', unit:'ms/op',
    data:[
      {label:'SD-JWT VC', sign:0.038, verify:0.117},
      {label:'W3C VCDM', sign:0.101, verify:0.178},
      {label:'mdoc', sign:0.077, verify:0.090},
    ],
    note:'AMD EPYC 7763 (SMT off, pinned core); medians across N=2,000 × 5 runs',
  }},
  { type:'bar', file:'chart_python_en.png', cfg:{
    title:'Fig.2 Sign/Verify Speed — Python (With Library, perf_counter_ns, p50)', unit:'ms/op',
    data:[
      {label:'SD-JWT VC', sign:0.036, verify:0.117},
      {label:'W3C VCDM', sign:0.253, verify:0.340},
      {label:'mdoc', sign:0.059, verify:0.074},
    ],
    note:'Same server as Fig.1; Python 3.12; medians across N=2,000 × 5 runs',
  }},
  { type:'bar', file:'chart_go_en.png', cfg:{
    title:'Fig.3 Sign/Verify Speed — Go (With Library, p50)', unit:'ms/op',
    data:[
      {label:'SD-JWT VC', sign:0.028, verify:0.064},
      {label:'W3C VCDM', sign:0.178, verify:0.216},
      {label:'mdoc', sign:0.036, verify:0.079},
    ],
    note:'Same server as Fig.1; Go 1.22; medians across N=2,000 × 5 runs',
  }},
  // Fig 4: attribute scaling (line)
  { type:'line', file:'chart_scaling_en.png', cfg:{
    title:'Fig.4 Attribute Count Scaling (Serialization Speed, p50)', unit:'ms/op',
    xLabels:['5','20','100','500'], xLabel:'Number of Attributes',
    allLabels: true,
    series:[
      {label:'SD-JWT VC', color:'#000000', data:[0.002,0.002,0.007,0.032]},
      {label:'W3C VCDM', color:'#000000', dash:'7,4', data:[0.039,0.075,0.253,1.184]},
      {label:'W3C VCDM (JCS)', color:'#888888', data:[0.006,0.011,0.038,0.178]},
      {label:'mdoc', color:'#888888', dash:'3,3', data:[0.002,0.005,0.030,0.141]},
    ],
    note:'Medians across N=2,000 (N=400 for W3C VCDM at 100+) × 5 runs, no crypto',
  }},
  // Fig 5: selective disclosure (line)
  { type:'line', file:'chart_sd_en.png', cfg:{
    title:'Fig.5 Selective Disclosure Performance (by Disclosed Attributes, p50)', unit:'ms/op',
    xLabels:['1/20','3/20','5/20','10/20','20/20'], xLabel:'Disclosed / Total Attributes',
    allLabels: true,
    series:[
      {label:'SD-JWT VC', color:'#000000', data:[0.004,0.004,0.004,0.004,0.006]},
      {label:'mdoc', color:'#888888', dash:'3,3', data:[0.003,0.003,0.004,0.005,0.007]},
      {label:'W3C VCDM', color:'#000000', dash:'7,4', data:[0.001,0.002,0.003,0.005,0.008]},
      {label:'W3C VCDM (JCS)', color:'#888888', data:[0.003,0.004,0.004,0.005,0.008]},
    ],
    note:'Medians across N=2,000 × 5 runs, hrtime precision',
  }},
  // Fig 6: complex credential normalization
  { type:'singlebar', file:'chart_complex_en.png', cfg:{
    title:'Fig.6 URDNA2015 Canonicalization of Complex Credentials (p50)', unit:'ms/op',
    xLabel:'Credential',
    data:[
      {label:'Simple (5 quads)', value:0.049},
      {label:'Synthetic BN10', value:0.188},
      {label:'Synthetic BN50', value:0.751},
      {label:'DCC-style', value:1.089},
      {label:'OB3', value:1.992},
    ],
    note:'Medians across N=1,000 (N=200 for OB3/DCC/BN50) × 5 runs; BN = blank nodes',
  }},
];

async function main() {
  for (const t of tasks) {
    const svg = t.type === 'bar' ? createBarChartSVG(t.cfg) : t.type === 'singlebar' ? createSingleBarChartSVG(t.cfg) : createLineChartSVG(t.cfg);
    const png = await sharp(Buffer.from(svg), {density:200}).png().toBuffer();
    fs.writeFileSync(t.file, png);
    console.log(`${t.file}: ${png.length} bytes`);
  }
  console.log('All 5 charts generated.');
}

main().catch(e => { console.error(e); process.exit(1); });
