// Regression tests: drives the real index.html in jsdom and checks LAI 2023 Figure 1 logic.
// Usage: cd tests && npm install && npm test
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function run(vals) {
  const errs = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.addEventListener('error', e => errs.push(e.message));
      w.HTMLFormElement.prototype.requestSubmit = function () { this.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true })); };
    } });
  const d = dom.window.document, f = d.getElementById('form');
  for (const [k, v] of Object.entries(vals)) f.elements[k].value = v;
  f.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
  const out = d.getElementById('output');
  return { tier: (out.querySelector('.tier') || {}).textContent, text: out.textContent.replace(/\s+/g, ' '), errs };
}

// Fully documented low-risk baseline (select values: 1=No/Female, 2=Yes/Male)
const base = { age: 30, sex: 2, sbp: 118, dbp: 76, bp: 1, statin: 1, tobacco: 1, smoke: 1, dm: 1, tod: 1, tc: 190, hdl: 50, ldl: 110, ascvd: 1,
  plaque: 1, fh: 1, recurrent: 1, catc: 1, family: 1, ckd: 1, met: 1, liver: 1, heavy: 1, apo: 90, lpa: 10, cac: 0, mod: 1, qr: 15, end: 85 };

const cases = [
  ['Low baseline', {}, { tier: 'Low' }],
  ['2 major factors -> Moderate', { age: 50, bp: 2 }, { tier: 'Moderate' }],
  ['LDL 165 -> High', { ldl: 165, tc: 215 }, { tier: 'High' }],
  ['Diabetes + TOD -> Very high', { dm: 2, tod: 2 }, { tier: 'Very high' }],
  ['LDL 195 -> Very high', { ldl: 195, tc: 250 }, { tier: 'Very high' }],
  ['Homozygous FH -> Extreme A', { fh: 3 }, { tier: 'Extreme A' }],
  ['CAC 300 -> Extreme A', { cac: 300 }, { tier: 'Extreme A' }],
  ['CAC 150 -> Very high', { cac: 150 }, { tier: 'Very high' }],
  ['Recurrent ACS -> Extreme B', { ascvd: 2, recurrent: 2 }, { tier: 'Extreme B' }],
  ['BP 181/90 -> High (extreme single factor)', { sbp: 181, dbp: 90 }, { tier: 'High' }],
  ['BP exactly 180/110 is NOT extreme', { sbp: 180, dbp: 110 }, { notTier: 'High' }],
  ['ApoB 131 -> High', { apo: 131 }, { tier: 'High' }],
  ['ApoB exactly 130 is NOT a feature', { apo: 130 }, { notTier: 'High' }],
  ['CAC 50, percentile 76 -> Very high', { cac: 50, pct: 76 }, { tier: 'Very high' }],
  ['CAC 50, percentile 60 -> High', { cac: 50, pct: 60 }, { tier: 'High' }],
  ['CAC 50, percentile exactly 75 -> flagged', { cac: 50, pct: 75 }, { text: 'exactly 75' }],
  ['Conflict: TOD without diabetes', { dm: 1, tod: 2 }, { text: 'Check inputs' }],
  ['Conflict: diastolic >= systolic', { sbp: 100, dbp: 100 }, { text: 'Check inputs' }],
];

let fail = 0;
for (const [name, over, exp] of cases) {
  const r = run({ ...base, ...over });
  let ok = r.errs.length === 0;
  if (exp.tier) ok = ok && r.tier === exp.tier;
  if (exp.notTier) ok = ok && r.tier !== exp.notTier;
  if (exp.text) ok = ok && r.text.includes(exp.text);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ` -> got ${r.tier || r.text.slice(0, 80)} ${r.errs}`));
  if (!ok) fail++;
}
console.log(fail ? `\n${fail} failed` : '\nAll passed');
process.exit(fail ? 1 : 0);
