// Comprehensive regression test suite across ASCVD (PCE, PREVENT, ACC Lifetime),
// QRISK3-2017 (+ Lifetime), and LAI 2023 Consensus IV calculation engines.
const assert = require('assert');
const { PREVENT_COEFFS } = require('../js/prevent-coeffs.js');
const R = require('../js/risk-engines.js');

const base = {
  age: 45,
  sex: 'male',
  ethnicity: 2, // Indian
  pceRace: 'auto',
  heightCm: 172,
  weightKg: 74,
  bmiDirect: null,
  sbp: 120,
  dbp: 76,
  bpTx: false,
  statin: false,
  tc: 185,
  hdl: 48,
  ldl: 112,
  smokeCat: 1,
  smokelessTobacco: false,
  heavySmokingOver1Pack: false,
  dmStatus: 'none',
  dmTod: false,
  ckdStage: 'none',
  ascvd: false,
  egfr: 95,
  hba1c: null,
  uacr: null,
  sdi: null,
  sbpSd: null,
  townsend: null,
  qrFhCvd: false,
  qrAF: false,
  qrMigraine: false,
  qrRA: false,
  qrSLE: false,
  qrSMI: false,
  qrAtypicalAntipsy: false,
  qrSteroids: false,
  qrED: false,
  qrLifetime: 18,
  qrEndAge: 85,
  plaque: false,
  fh: 'no',
  recurrent: false,
  catC: false,
  cac: 0,
  cacPct: null,
  laiFamily: false,
  apoB: 88,
  lpa: 12,
  metSyndrome: false,
  nafldFibrosis: false,
  fbg: 92,
  waistCm: 84,
  hsCRP: 0.8,
  triglycerides: 110,
  tgFasting: true,
  laiInflammatory: false,
  laiFemaleSpecific: false,
  laiHighPRS: false,
  laiAirPollution: false,
  laiHIV: false,
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
    passed++;
  } catch (err) {
    console.log('FAIL ' + name + ' -> ' + err.message);
    failed++;
  }
}

// 1. ASCVD: Goff et al. 2013 PCE Exact Benchmarks
test('PCE White Female benchmark (2.1%)', () => {
  const r = R.evaluateAllProtocols({ ...base, age: 55, sex: 'female', ethnicity: 1, tc: 213, hdl: 50, sbp: 120 }, PREVENT_COEFFS);
  assert.strictEqual(r.ascvd.pce.percent, 2.1);
});
test('PCE African American Female benchmark (3.0%)', () => {
  const r = R.evaluateAllProtocols({ ...base, age: 55, sex: 'female', ethnicity: 7, tc: 213, hdl: 50, sbp: 120 }, PREVENT_COEFFS);
  assert.strictEqual(r.ascvd.pce.percent, 3.0);
});
test('PCE White Male benchmark (5.4%)', () => {
  const r = R.evaluateAllProtocols({ ...base, age: 55, sex: 'male', ethnicity: 1, tc: 213, hdl: 50, sbp: 120 }, PREVENT_COEFFS);
  assert.strictEqual(r.ascvd.pce.percent, 5.4);
});
test('PCE African American Male benchmark (6.1%)', () => {
  const r = R.evaluateAllProtocols({ ...base, age: 55, sex: 'male', ethnicity: 7, tc: 213, hdl: 50, sbp: 120 }, PREVENT_COEFFS);
  assert.strictEqual(r.ascvd.pce.percent, 6.1);
});

// 2. ASCVD: AHA PREVENT 2024 Base & Enhanced Models
test('PREVENT 2024 Base 10-yr & 30-yr calculation (50F)', () => {
  const r = R.evaluateAllProtocols(
    { ...base, age: 50, sex: 'female', tc: 200, hdl: 45, sbp: 160, heightCm: null, weightKg: null, bmiDirect: 35, egfr: 90 },
    PREVENT_COEFFS
  );
  assert.strictEqual(r.ascvd.prevent.eligible10, true);
  assert.strictEqual(r.ascvd.prevent.eligible30, true);
  assert.strictEqual(r.ascvd.prevent.model, 'base');
  assert.strictEqual(r.ascvd.prevent.r10.total_cvd, 4.8);
  assert.strictEqual(r.ascvd.prevent.r10.ascvd, 3.2);
  assert.strictEqual(r.ascvd.prevent.r30.ascvd, 18.1);
});
test('PREVENT Enhanced Full model auto-activates with HbA1c + UACR', () => {
  const r = R.evaluateAllProtocols({ ...base, age: 52, dmStatus: 't2', hba1c: 7.8, uacr: 60 }, PREVENT_COEFFS);
  assert.strictEqual(r.ascvd.prevent.model, 'full');
  assert.ok(r.ascvd.prevent.r10.ascvd > 0);
});
test('ACC Legacy Lifetime suppresses when LDL >= 190', () => {
  const r = R.evaluateAllProtocols({ ...base, ldl: 192, tc: 255 }, PREVENT_COEFFS);
  assert.strictEqual(r.ascvd.accLifetime.eligible, false);
});
test('CKD-EPI 2021 computes eGFR accurately (55M Cr 1.0 -> 89)', () => {
  assert.strictEqual(R.calcCKDEPI2021(1.0, 55, 'male'), 89);
});

// 3. QRISK3-2017 Protocol
test('QRISK3-2017 Indian ethnicity yields higher 10-yr risk than White baseline', () => {
  const ind = R.evaluateAllProtocols({ ...base, age: 55, ethnicity: 2, sbp: 135, tc: 220, hdl: 44 }, PREVENT_COEFFS).qrisk3;
  const wht = R.evaluateAllProtocols({ ...base, age: 55, ethnicity: 1, sbp: 135, tc: 220, hdl: 44 }, PREVENT_COEFFS).qrisk3;
  assert.strictEqual(ind.eligible, true);
  assert.ok(ind.percent > wht.percent, `Expected Indian (${ind.percent}) > White (${wht.percent})`);
  assert.ok(ind.healthyPercent > 0 && ind.relativeRisk >= 1);
});
test('QRISK3-2017 comorbidities (AF, SLE, Steroids, T1DM, ED) elevate risk', () => {
  const clean = R.evaluateAllProtocols({ ...base, age: 50 }, PREVENT_COEFFS).qrisk3.percent;
  const complex = R.evaluateAllProtocols(
    { ...base, age: 50, dmStatus: 't1', qrAF: true, qrSLE: true, qrSteroids: true, qrED: true, ckdStage: '3b' },
    PREVENT_COEFFS
  ).qrisk3.percent;
  assert.ok(complex > clean * 3, `Expected complex (${complex}%) >> clean (${clean}%)`);
});
test('Established ASCVD suppresses primary prevention PCE, PREVENT, and QRISK3', () => {
  const r = R.evaluateAllProtocols({ ...base, ascvd: true }, PREVENT_COEFFS);
  assert.strictEqual(r.ascvd.pce.eligible, false);
  assert.strictEqual(r.ascvd.prevent.eligible10, false);
  assert.strictEqual(r.qrisk3.eligible, false);
  assert.strictEqual(r.lai.tier, 'Very high risk');
});

// 4. LAI 2023 Consensus IV Protocol
test('LAI Low risk baseline with QRISK3-lifetime <30%', () => {
  const r = R.evaluateAllProtocols({ ...base, age: 35, qrLifetime: 18, qrEndAge: 85 }, PREVENT_COEFFS);
  assert.strictEqual(r.lai.tier, 'Low risk');
  assert.strictEqual(r.lai.targets.ldl, '<100 mg/dL');
});
test('LAI Low risk reclassified to Moderate risk by QRISK3-lifetime >30%', () => {
  const r = R.evaluateAllProtocols({ ...base, age: 35, qrLifetime: 34, qrEndAge: 85 }, PREVENT_COEFFS);
  assert.strictEqual(r.lai.tier, 'Moderate risk');
});
test('LAI Low risk reclassified to Moderate risk by Risk Modifier (waist >90 cm)', () => {
  const r = R.evaluateAllProtocols({ ...base, age: 35, waistCm: 94 }, PREVENT_COEFFS);
  assert.strictEqual(r.lai.tier, 'Moderate risk');
});
test('LAI 2 major factors -> Moderate; + modifier -> High', () => {
  const mod = R.evaluateAllProtocols({ ...base, age: 50, bpTx: true }, PREVENT_COEFFS);
  assert.strictEqual(mod.lai.tier, 'Moderate risk');
  const high = R.evaluateAllProtocols({ ...base, age: 50, bpTx: true, hsCRP: 3.2 }, PREVENT_COEFFS);
  assert.strictEqual(high.lai.tier, 'High risk');
});
test('LAI Table 1/2 CACS 75th-percentile auto-lookup (50M ref=22: CACS 10->High, CACS 30->Very high)', () => {
  const rLow = R.evaluateAllProtocols({ ...base, age: 50, cac: 10, cacPct: null }, PREVENT_COEFFS);
  assert.strictEqual(rLow.lai.tier, 'High risk');
  const rHigh = R.evaluateAllProtocols({ ...base, age: 50, cac: 30, cacPct: null }, PREVENT_COEFFS);
  assert.strictEqual(rHigh.lai.tier, 'Very high risk');
});
test('LAI CACS >=300 -> Extreme Category A', () => {
  const r = R.evaluateAllProtocols({ ...base, cac: 320 }, PREVENT_COEFFS);
  assert.strictEqual(r.lai.tier, 'Extreme risk — Category A');
});
test('LAI ASCVD + Recurrent ACS -> Extreme Category B (LDL target <=30)', () => {
  const r = R.evaluateAllProtocols({ ...base, ascvd: true, recurrent: true }, PREVENT_COEFFS);
  assert.strictEqual(r.lai.tier, 'Extreme risk — Category B');
  assert.strictEqual(r.lai.targets.ldl, '≤30 mg/dL');
});
test('LAI Recurrent ASCVD despite LDL ~30 -> Extreme Category C', () => {
  const r = R.evaluateAllProtocols({ ...base, ascvd: true, catC: true }, PREVENT_COEFFS);
  assert.strictEqual(r.lai.tier, 'Extreme risk — Category C');
  assert.strictEqual(r.lai.targets.ldl, '10–15 mg/dL');
});
test('Validation catches DBP >= SBP conflict and flags severe BP >180/120', () => {
  const c = R.evaluateAllProtocols({ ...base, sbp: 100, dbp: 105 }, PREVENT_COEFFS);
  assert.strictEqual(c.status, 'conflict');
  const sev = R.evaluateAllProtocols({ ...base, sbp: 192, dbp: 100 }, PREVENT_COEFFS);
  assert.strictEqual(sev.severeBP, true);
});

console.log(`\nSummary: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
