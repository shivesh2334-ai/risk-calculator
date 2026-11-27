/**
 * Multi-Protocol Cardiovascular Risk Calculation Engines
 *
 * Protocols implemented:
 * 1. ASCVD Protocol:
 *    - ACC/AHA 2013 Pooled Cohort Equations (10-year ASCVD; Goff et al., Circulation 2014)
 *    - AHA 2024 PREVENT Equations (10-year & 30-year ASCVD, Total CVD, HF, CHD, Stroke; Khan et al., Circulation 2024)
 *    - ACC/AHA Legacy Lifetime ASCVD Risk (Lloyd-Jones / Berry et al. risk-factor strata)
 * 2. QRISK3 Protocol:
 *    - QRISK3-2017 10-year CVD algorithm (Hippisley-Cox et al., BMJ 2017;357:j2099, open-source LGPL equations)
 *    - QRISK3-Lifetime CVD reference integration (official qrisk.org/lifetime/ entry)
 * 3. LAI 2023 Protocol:
 *    - Lipid Association of India Consensus Statement IV (Puri et al., J Clin Lipidol 2024;18:e351-e373)
 *    - Figures 1-5, Tables 1-3 (including MESA/CARDIA CACS 75th-percentile reference lookup & lipid targets)
 *
 * Runs cleanly in both browser (window.RiskEngines) and Node.js (module.exports).
 */
(function (root) {
  'use strict';

  const CHOL_TO_MMOL = 0.02586;

  function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /**
   * 2021 CKD-EPI Creatinine Equation (race-free) for eGFR (mL/min/1.73m^2)
   * @param {number} scr - Serum creatinine in mg/dL
   * @param {number} age - Age in years
   * @param {'female'|'male'} sex
   */
  function calcCKDEPI2021(scr, age, sex) {
    if (!isNum(scr) || scr <= 0 || !isNum(age) || age < 18 || (sex !== 'female' && sex !== 'male')) {
      return null;
    }
    const isFemale = sex === 'female';
    const kappa = isFemale ? 0.7 : 0.9;
    const alpha = isFemale ? -0.241 : -0.302;
    const ratio = scr / kappa;
    const egfr =
      142 *
      Math.pow(Math.min(ratio, 1), alpha) *
      Math.pow(Math.max(ratio, 1), -1.2) *
      Math.pow(0.9938, age) *
      (isFemale ? 1.012 : 1.0);
    return Math.round(egfr);
  }

  /**
   * Derived clinical metrics shared across protocols
   */
  function computeDerived(p) {
    let bmi = isNum(p.bmiDirect) ? p.bmiDirect : null;
    let bmiSource = bmi !== null ? 'direct' : null;
    if (isNum(p.heightCm) && p.heightCm > 0 && isNum(p.weightKg) && p.weightKg > 0) {
      const hm = p.heightCm / 100;
      bmi = p.weightKg / (hm * hm);
      bmiSource = 'calculated';
    }
    const nonHdl = isNum(p.tc) && isNum(p.hdl) ? p.tc - p.hdl : null;
    const tcHdlRatio = isNum(p.tc) && isNum(p.hdl) && p.hdl > 0 ? p.tc / p.hdl : null;
    const cacs75Ref = getLAI75thPercentileCACS(p.age, p.sex);
    return {
      bmi: bmi !== null ? Math.round(bmi * 10) / 10 : null,
      bmiRaw: bmi,
      bmiSource,
      nonHdl: nonHdl !== null ? Math.round(nonHdl * 10) / 10 : null,
      tcHdlRatio: tcHdlRatio !== null ? Math.round(tcHdlRatio * 100) / 100 : null,
      cacs75Ref,
    };
  }

  /**
   * LAI Consensus IV Tables 1 & 2 (Page e356):
   * 75th percentile reference CACS values for White men & women extrapolated for Indians.
   * Table 2 (Javaid et al., JACC 2022): ages 30-45
   * Table 1 (MESA, McClelland et al., Circulation 2006): ages 45-84
   */
  function getLAI75thPercentileCACS(age, sex) {
    if (!isNum(age) || (sex !== 'male' && sex !== 'female')) return null;
    const a = Math.floor(age);
    if (a < 30 || a > 84) return null;
    if (a <= 45) {
      if (sex === 'female') return { threshold: 0, source: 'LAI Table 2 (<=45 yrs, extrapolated for Indians)' };
      if (a <= 42) return { threshold: 0, source: 'LAI Table 2 (<=45 yrs, extrapolated for Indians)' };
      if (a === 43) return { threshold: 1, source: 'LAI Table 2 (age 43, extrapolated for Indians)' };
      if (a === 44) return { threshold: 3, source: 'LAI Table 2 (age 44, extrapolated for Indians)' };
      return { threshold: 5, source: 'LAI Table 2 (age 45, extrapolated for Indians)' };
    }
    if (a <= 54) {
      return { threshold: sex === 'male' ? 22 : 0, source: 'LAI Table 1 (MESA 45-54 yrs, extrapolated for Indians)' };
    }
    if (a <= 64) {
      return { threshold: sex === 'male' ? 155 : 16, source: 'LAI Table 1 (MESA 55-64 yrs, extrapolated for Indians)' };
    }
    if (a <= 74) {
      return { threshold: sex === 'male' ? 540 : 119, source: 'LAI Table 1 (MESA 65-74 yrs, extrapolated for Indians)' };
    }
    return { threshold: sex === 'male' ? 1200 : 370, source: 'LAI Table 1 (MESA 75-84 yrs, extrapolated for Indians)' };
  }

  // ============================================================================
  // 1. ASCVD PROTOCOL ENGINES (PCE 2013, AHA PREVENT 2024, ACC LIFETIME)
  // ============================================================================

  /**
   * 1A. ACC/AHA 2013 Pooled Cohort Equations (10-Year Hard ASCVD Risk)
   * Goff DC Jr et al. Circulation. 2014;129:S49-S73.
   */
  function calcPCE10Year(p) {
    const missing = [];
    if (!isNum(p.age)) missing.push('Age');
    if (p.sex !== 'female' && p.sex !== 'male') missing.push('Sex');
    if (!isNum(p.tc)) missing.push('Total cholesterol');
    if (!isNum(p.hdl)) missing.push('HDL-C');
    if (!isNum(p.sbp)) missing.push('Systolic BP');
    if (p.bpTx === null || p.bpTx === undefined) missing.push('Antihypertensive treatment');
    if (p.dmStatus === null || p.dmStatus === undefined) missing.push('Diabetes status');
    if (p.smokeCat === null || p.smokeCat === undefined) missing.push('Smoking status');
    if (p.ascvd === null || p.ascvd === undefined) missing.push('Clinical ASCVD status');

    if (p.ascvd === true) {
      return {
        eligible: false,
        reason: 'Not applicable in established clinical ASCVD (secondary prevention applies).',
        missing: [],
      };
    }
    if (missing.length) {
      return {
        eligible: false,
        reason: 'Missing required parameters: ' + missing.join(', ') + '.',
        missing,
      };
    }

    const notes = [];
    if (p.age < 40 || p.age > 79) {
      return {
        eligible: false,
        reason: `PCE 10-year ASCVD is validated for ages 40–79 years (entered age: ${p.age}).`,
        missing: [],
      };
    }
    if (p.tc < 130 || p.tc > 320) notes.push(`Total cholesterol (${p.tc} mg/dL) is outside the PCE validation range (130–320 mg/dL).`);
    if (p.hdl < 20 || p.hdl > 100) notes.push(`HDL-C (${p.hdl} mg/dL) is outside the PCE validation range (20–100 mg/dL).`);
    if (p.sbp < 90 || p.sbp > 200) notes.push(`Systolic BP (${p.sbp} mmHg) is outside the PCE validation range (90–200 mmHg).`);

    // Map ethnicity to PCE race stratum (Black Caribbean / Black African -> African American; others -> White/Other)
    const isAA = p.pceRace === 'aa' || (p.pceRace === 'auto' && (p.ethnicity === 6 || p.ethnicity === 7));
    const raceLabel = isAA ? 'African American equation' : 'White / Other equation';
    if (!isAA && (p.ethnicity === 2 || p.ethnicity === 3 || p.ethnicity === 4 || p.ethnicity === 5)) {
      notes.push('South Asian ancestry was not represented in PCE derivation cohorts; PCE systematically underestimates ASCVD risk in Indians (LAI Consensus IV).');
    }
    if (p.statin === true) {
      notes.push('Patient is currently on statin therapy; PCE was derived primarily in statin-naive primary prevention cohorts.');
    }

    const lnAge = Math.log(p.age);
    const lnTC = Math.log(p.tc);
    const lnHDL = Math.log(p.hdl);
    const lnSBP = Math.log(p.sbp);
    const smoker = p.currentSmoker ? 1 : 0;
    const dm = p.hasDiabetes ? 1 : 0;
    const bpTx = p.bpTx ? 1 : 0;

    let sum = 0;
    let mean = 0;
    let s10 = 0;

    if (p.sex === 'female' && !isAA) {
      sum =
        -29.799 * lnAge +
        4.884 * lnAge * lnAge +
        13.54 * lnTC -
        3.114 * lnAge * lnTC -
        13.578 * lnHDL +
        3.149 * lnAge * lnHDL +
        (bpTx ? 2.019 : 1.957) * lnSBP +
        (smoker ? 7.574 - 1.665 * lnAge : 0) +
        (dm ? 0.661 : 0);
      mean = -29.1817;
      s10 = 0.9665;
    } else if (p.sex === 'female' && isAA) {
      sum =
        17.114 * lnAge +
        0.94 * lnTC -
        18.92 * lnHDL +
        4.475 * lnAge * lnHDL +
        (bpTx ? 29.291 * lnSBP - 6.432 * lnAge * lnSBP : 27.82 * lnSBP - 6.087 * lnAge * lnSBP) +
        (smoker ? 0.691 : 0) +
        (dm ? 0.874 : 0);
      mean = 86.6081;
      s10 = 0.9533;
    } else if (p.sex === 'male' && !isAA) {
      sum =
        12.344 * lnAge +
        11.853 * lnTC -
        2.664 * lnAge * lnTC -
        7.99 * lnHDL +
        1.769 * lnAge * lnHDL +
        (bpTx ? 1.797 : 1.764) * lnSBP +
        (smoker ? 7.837 - 1.795 * lnAge : 0) +
        (dm ? 0.658 : 0);
      mean = 61.1816;
      s10 = 0.9144;
    } else {
      sum =
        2.469 * lnAge +
        0.302 * lnTC -
        0.307 * lnHDL +
        (bpTx ? 1.916 : 1.809) * lnSBP +
        (smoker ? 0.549 : 0) +
        (dm ? 0.645 : 0);
      mean = 19.5425;
      s10 = 0.8954;
    }

    const rawRisk = 1 - Math.pow(s10, Math.exp(sum - mean));
    const percent = Math.max(0, Math.min(99.9, round1(rawRisk * 100)));

    let category = 'Low risk (<5%)';
    let tone = 'low';
    if (percent >= 20) {
      category = 'High risk (>=20%)';
      tone = 'very-high';
    } else if (percent >= 7.5) {
      category = 'Intermediate risk (7.5–19.9%)';
      tone = 'high';
    } else if (percent >= 5) {
      category = 'Borderline risk (5.0–7.4%)';
      tone = 'moderate';
    }

    return {
      eligible: true,
      percent,
      rawRisk,
      category,
      tone,
      raceLabel,
      notes,
      missing: [],
    };
  }

  /**
   * 1B. AHA 2024 PREVENT Equations (10-Year & 30-Year)
   * Khan SS et al. Circulation. 2024;149(6):430-449.
   */
  function calcPREVENT(p, derived, coeffs) {
    if (!coeffs) {
      return { eligible10: false, eligible30: false, reason: 'PREVENT coefficient table unavailable.', missing: [] };
    }
    if (p.ascvd === true) {
      return {
        eligible10: false,
        eligible30: false,
        reason: 'Not applicable in established clinical ASCVD (primary prevention model).',
        missing: [],
      };
    }

    const missing = [];
    if (!isNum(p.age)) missing.push('Age');
    if (p.sex !== 'female' && p.sex !== 'male') missing.push('Sex');
    if (!isNum(p.tc)) missing.push('Total cholesterol');
    if (!isNum(p.hdl)) missing.push('HDL-C');
    if (!isNum(p.sbp)) missing.push('Systolic BP');
    if (p.bpTx === null || p.bpTx === undefined) missing.push('Antihypertensive treatment');
    if (p.statin === null || p.statin === undefined) missing.push('Statin therapy');
    if (p.dmStatus === null || p.dmStatus === undefined) missing.push('Diabetes status');
    if (p.smokeCat === null || p.smokeCat === undefined) missing.push('Smoking status');
    if (!isNum(p.egfr)) missing.push('eGFR');
    if (!isNum(derived.bmiRaw)) missing.push('BMI (Height & Weight)');

    if (missing.length) {
      return {
        eligible10: false,
        eligible30: false,
        reason: 'Missing required PREVENT parameters: ' + missing.join(', ') + '.',
        missing,
      };
    }

    if (p.age < 30 || p.age > 79) {
      return {
        eligible10: false,
        eligible30: false,
        reason: `AHA PREVENT is validated for ages 30–79 years (entered age: ${p.age}).`,
        missing: [],
      };
    }

    const notes = [];
    if (p.tc < 130 || p.tc > 320) notes.push(`Total cholesterol (${p.tc} mg/dL) is outside PREVENT validation range (130–320 mg/dL).`);
    if (p.hdl < 20 || p.hdl > 100) notes.push(`HDL-C (${p.hdl} mg/dL) is outside PREVENT validation range (20–100 mg/dL).`);
    if (p.sbp < 90 || p.sbp > 200) notes.push(`Systolic BP (${p.sbp} mmHg) is outside PREVENT validation range (90–200 mmHg).`);
    if (derived.bmiRaw < 18.5 || derived.bmiRaw >= 40) notes.push(`BMI (${derived.bmi} kg/m²) is outside PREVENT validation range (18.5–39.9 kg/m²).`);
    if (p.egfr < 15 || p.egfr > 140) notes.push(`eGFR (${p.egfr} mL/min/1.73m²) is outside PREVENT validation range (15–140).`);
    if (isNum(p.ldl) && p.ldl >= 190) notes.push('LDL-C ≥190 mg/dL independently indicates high-intensity statin / FH evaluation regardless of PREVENT score.');
    if (p.plaque === true || (isNum(p.cac) && p.cac > 0)) notes.push('Subclinical atherosclerosis is documented; PREVENT is primarily validated in patients without known clinical or subclinical ASCVD.');

    const hasUacr = isNum(p.uacr) && p.uacr > 0;
    const hasHba1c = isNum(p.hba1c) && p.hba1c > 0;
    const hasSdi = isNum(p.sdi) && p.sdi >= 1 && p.sdi <= 10;

    // Auto-select the best matching AHA PREVENT equation model
    let model = 'base';
    let modelLabel = 'PREVENT Base Model';
    const optCount = (hasUacr ? 1 : 0) + (hasHba1c ? 1 : 0) + (hasSdi ? 1 : 0);
    if (optCount >= 2) {
      model = 'full';
      modelLabel = 'PREVENT Enhanced Full Model (UACR / HbA1c / SDI)';
    } else if (hasUacr) {
      model = 'uacr';
      modelLabel = 'PREVENT Enhanced Model (+ UACR)';
    } else if (hasHba1c) {
      model = 'hba1c';
      modelLabel = 'PREVENT Enhanced Model (+ HbA1c)';
    } else if (hasSdi) {
      model = 'sdi';
      modelLabel = 'PREVENT Enhanced Model (+ SDI)';
    }

    const dm = p.hasDiabetes ? 1 : 0;
    const smoking = p.currentSmoker ? 1 : 0;
    const bp_tx = p.bpTx ? 1 : 0;
    const statin = p.statin ? 1 : 0;

    const age = (p.age - 55) / 10;
    const non_hdl_c = (p.tc - p.hdl) * CHOL_TO_MMOL - 3.5;
    const hdl_c = (p.hdl * CHOL_TO_MMOL - 1.3) / 0.3;
    const sbp_gte_110 = (Math.max(p.sbp, 110) - 130) / 20;
    const bmi = derived.bmiRaw;
    const egfr = p.egfr;

    const terms = {
      age,
      age_squared: age * age,
      non_hdl_c,
      hdl_c,
      sbp_lt_110: (Math.min(p.sbp, 110) - 110) / 20,
      sbp_gte_110,
      dm,
      smoking,
      bmi_lt_30: (Math.min(bmi, 30) - 25) / 5,
      bmi_gte_30: (Math.max(bmi, 30) - 30) / 5,
      egfr_lt_60: (Math.min(egfr, 60) - 60) / -15,
      egfr_gte_60: (Math.max(egfr, 60) - 90) / -15,
      bp_tx,
      statin,
      bp_tx_sbp_gte_110: bp_tx * sbp_gte_110,
      statin_non_hdl_c: statin * non_hdl_c,
      age_non_hdl_c: age * non_hdl_c,
      age_hdl_c: age * hdl_c,
      age_sbp_gte_110: age * sbp_gte_110,
      age_dm: age * dm,
      age_smoking: age * smoking,
      age_bmi_gte_30: age * ((Math.max(bmi, 30) - 30) / 5),
      age_egfr_lt_60: age * ((Math.min(egfr, 60) - 60) / -15),
      sdi_4_to_6: hasSdi && p.sdi >= 4 && p.sdi <= 6 ? 1 : 0,
      sdi_7_to_10: hasSdi && p.sdi >= 7 && p.sdi <= 10 ? 1 : 0,
      missing_sdi: hasSdi ? 0 : 1,
      ln_uacr: hasUacr ? Math.log(p.uacr) : 0,
      missing_uacr: hasUacr ? 0 : 1,
      hba1c_dm: hasHba1c && dm === 1 ? p.hba1c - 5.3 : 0,
      hba1c_no_dm: hasHba1c && dm === 0 ? p.hba1c - 5.3 : 0,
      missing_hba1c: hasHba1c ? 0 : 1,
      constant: 1,
    };

    const outcomes = ['total_cvd', 'ascvd', 'heart_failure', 'chd', 'stroke'];
    function evalTable(tableKey) {
      const table = coeffs[tableKey];
      const out = {};
      for (const oc of outcomes) {
        const col = table.cols[p.sex + '_' + oc];
        let lp = 0;
        for (let i = 0; i < table.terms.length; i++) {
          lp += col[i] * terms[table.terms[i]];
        }
        const prob = Math.exp(lp) / (1 + Math.exp(lp));
        out[oc] = round1(prob * 100);
      }
      return out;
    }

    const r10 = evalTable(model + '_10yr');
    const eligible30 = p.age >= 30 && p.age <= 59;
    const r30 = eligible30 ? evalTable(model + '_30yr') : null;

    if (!eligible30) {
      notes.push('30-year PREVENT estimates are validated for ages 30–59 years (not shown for age ≥60).');
    }

    let category10 = 'Low (<5%)';
    if (r10.ascvd >= 20) category10 = 'High (>=20%)';
    else if (r10.ascvd >= 7.5) category10 = 'Intermediate (7.5–19.9%)';
    else if (r10.ascvd >= 5) category10 = 'Borderline (5.0–7.4%)';

    return {
      eligible10: true,
      eligible30,
      model,
      modelLabel,
      r10,
      r30,
      category10,
      notes,
      missing: [],
    };
  }

  /**
   * 1C. ACC/AHA Legacy Lifetime ASCVD Risk (Lloyd-Jones / Berry et al.)
   * Valid for ages 20-59, no clinical ASCVD, LDL-C < 190 mg/dL.
   */
  function calcACCLifetime(p) {
    if (p.ascvd === true) {
      return { eligible: false, reason: 'Not applicable in established clinical ASCVD.' };
    }
    const missing = [];
    if (!isNum(p.age)) missing.push('Age');
    if (p.sex !== 'female' && p.sex !== 'male') missing.push('Sex');
    if (!isNum(p.tc)) missing.push('Total cholesterol');
    if (!isNum(p.sbp)) missing.push('Systolic BP');
    if (!isNum(p.dbp)) missing.push('Diastolic BP');
    if (p.bpTx === null || p.bpTx === undefined) missing.push('Antihypertensive treatment');
    if (p.statin === null || p.statin === undefined) missing.push('Cholesterol-lowering treatment');
    if (p.dmStatus === null || p.dmStatus === undefined) missing.push('Diabetes');
    if (p.smokeCat === null || p.smokeCat === undefined) missing.push('Smoking');
    if (!isNum(p.ldl)) missing.push('LDL-C');

    if (missing.length) {
      return { eligible: false, reason: 'Missing required parameters: ' + missing.join(', ') + '.' };
    }
    if (p.age < 20 || p.age > 59) {
      return { eligible: false, reason: `ACC Legacy Lifetime ASCVD applies to ages 20–59 years (entered age: ${p.age}).` };
    }
    if (p.ldl >= 190) {
      return { eligible: false, reason: 'Suppressed when LDL-C ≥190 mg/dL (independently indicates high-intensity statin / FH evaluation).' };
    }

    const majorCount = [
      p.tc >= 240 || p.statin === true,
      p.sbp >= 160 || p.dbp >= 100 || p.bpTx === true,
      p.hasDiabetes === true,
      p.currentSmoker === true,
    ].filter(Boolean).length;

    const stratum =
      majorCount >= 2
        ? 4
        : majorCount === 1
        ? 3
        : p.tc >= 200 || p.sbp >= 140 || p.dbp >= 90
        ? 2
        : p.tc >= 180 || p.sbp >= 120 || p.dbp >= 80
        ? 1
        : 0;

    const labels = [
      'All risk factors optimal',
      'At least one non-optimal risk factor',
      'At least one elevated risk factor',
      'One major risk factor',
      'Two or more major risk factors',
    ];
    const estimates = p.sex === 'male' ? [5, 36, 46, 50, 69] : [8, 27, 39, 39, 50];

    return {
      eligible: true,
      percent: estimates[stratum],
      stratum,
      label: labels[stratum],
    };
  }

  // ============================================================================
  // 2. QRISK3-2017 PROTOCOL ENGINE (Hippisley-Cox et al., BMJ 2017;357:j2099)
  // ============================================================================

  const QRISK3_ETHNICITY_LABELS = {
    1: 'White or not stated',
    2: 'Indian',
    3: 'Pakistani',
    4: 'Bangladeshi',
    5: 'Other Asian',
    6: 'Black Caribbean',
    7: 'Black African',
    8: 'Chinese',
    9: 'Other ethnic group',
  };

  function computeQRISK3Raw(sex, v) {
    // Exact open-source ClinRisk QRISK3-2017 equations (matches YanLiUK/QRISK3 & ClinRisk C source)
    const ethIdx = (v.ethnicity >= 1 && v.ethnicity <= 9 ? v.ethnicity : 1) - 1;
    const smokeIdx = (v.smokeCat >= 1 && v.smokeCat <= 5 ? v.smokeCat : 1) - 1;
    const smoke_cat = smokeIdx + 1;

    if (sex === 'female') {
      const survivor10 = 0.988876402378082;
      const Iethrisk = [
        0,
        0.28040314332995425,
        0.56298994142075398,
        0.29590000851116516,
        0.072785379877982545,
        -0.17072135508857317,
        -0.39371043314874971,
        -0.32632495283530272,
        -0.17127056883241784,
      ];
      const Ismoke = [
        0,
        0.13386833786546262,
        0.56200858012438537,
        0.66749593377502547,
        0.84948177644830847,
      ];

      const dage = v.age / 10;
      let age_1 = Math.pow(dage, -2);
      let age_2 = dage;
      const dbmi = v.bmi / 10;
      let bmi_1 = Math.pow(dbmi, -2);
      let bmi_2 = Math.pow(dbmi, -2) * Math.log(dbmi);

      // Centering continuous variables
      age_1 -= 0.053274843841791;
      age_2 -= 4.332503318786621;
      bmi_1 -= 0.154946178197861;
      bmi_2 -= 0.144462317228317;
      const rati = v.rati - 3.47632646560669;
      const sbp = v.sbp - 123.13001251220703;
      const sbps5 = v.sbps5 - 9.002537727355957;
      const town = v.town - 0.392308831214905;

      let a = 0;
      a += Iethrisk[ethIdx];
      a += Ismoke[smokeIdx];

      // Continuous main effects
      a += age_1 * -8.1388109247726188;
      a += age_2 * 0.79733376689699098;
      a += bmi_1 * 0.29236092275460052;
      a += bmi_2 * -4.1513300213837665;
      a += rati * 0.15338035820802554;
      a += sbp * 0.013131488407103424;
      a += sbps5 * 0.0078894541014586095;
      a += town * 0.077223790588590108;

      // Boolean main effects
      a += v.b_AF * 1.5923354969269663;
      a += v.b_atypicalantipsy * 0.25237642070115557;
      a += v.b_corticosteroids * 0.59520725304601851;
      a += v.b_migraine * 0.301267260870345;
      a += v.b_ra * 0.21364803435181942;
      a += v.b_renal * 0.65194569493845833;
      a += v.b_semi * 0.12555308058820178;
      a += v.b_sle * 0.75880938654267693;
      a += v.b_treatedhyp * 0.50931593683423004;
      a += v.b_type1 * 1.7267977510537347;
      a += v.b_type2 * 1.0688773244615468;
      a += v.fh_cvd * 0.45445319020896213;

      // Interaction terms with age_1
      if (smoke_cat === 2) a += age_1 * -4.7057161785851891;
      if (smoke_cat === 3) a += age_1 * -2.7430383403573337;
      if (smoke_cat === 4) a += age_1 * -0.86608088829392182;
      if (smoke_cat === 5) a += age_1 * 0.90241562369710648;
      a += age_1 * v.b_AF * 19.938034889546561;
      a += age_1 * v.b_corticosteroids * -0.98408045235936281;
      a += age_1 * v.b_migraine * 1.7634979587872999;
      a += age_1 * v.b_renal * -3.5874047731694114;
      a += age_1 * v.b_sle * 19.690303738638292;
      a += age_1 * v.b_treatedhyp * 11.872809733921812;
      a += age_1 * v.b_type1 * -1.2444332714320747;
      a += age_1 * v.b_type2 * 6.8652342000009599;
      a += age_1 * bmi_1 * 23.802623412141742;
      a += age_1 * bmi_2 * -71.184947692087007;
      a += age_1 * v.fh_cvd * 0.99467807940435127;
      a += age_1 * sbp * 0.034131842338615485;
      a += age_1 * town * -1.0301180802035639;

      // Interaction terms with age_2
      if (smoke_cat === 2) a += age_2 * -0.075589244643193026;
      if (smoke_cat === 3) a += age_2 * -0.11951192874867074;
      if (smoke_cat === 4) a += age_2 * -0.10366306397571923;
      if (smoke_cat === 5) a += age_2 * -0.13991853591718389;
      a += age_2 * v.b_AF * -0.076182651011162505;
      a += age_2 * v.b_corticosteroids * -0.12005364946742472;
      a += age_2 * v.b_migraine * -0.065586917898699859;
      a += age_2 * v.b_renal * -0.22688873086442507;
      a += age_2 * v.b_sle * 0.077347949679016273;
      a += age_2 * v.b_treatedhyp * 0.00096857823588174436;
      a += age_2 * v.b_type1 * -0.28724064624488949;
      a += age_2 * v.b_type2 * -0.097112252590695489;
      a += age_2 * bmi_1 * 0.52369958933664429;
      a += age_2 * bmi_2 * 0.045744190122323759;
      a += age_2 * v.fh_cvd * -0.076885051698423038;
      a += age_2 * sbp * -0.0015082501423272358;
      a += age_2 * town * -0.031593414674962329;

      return 100.0 * (1 - Math.pow(survivor10, Math.exp(a)));
    } else {
      // Male
      const survivor10 = 0.977268040180206;
      const Iethrisk = [
        0,
        0.27719248760308279,
        0.47446360714931268,
        0.52961729919689371,
        0.035100159186299017,
        -0.35807899669327919,
        -0.4005648523216514,
        -0.41522792889830173,
        -0.26321348134749967,
      ];
      const Ismoke = [
        0,
        0.19128222863388983,
        0.55241588192645552,
        0.63835053027506072,
        0.78983819881858019,
      ];

      const dage = v.age / 10;
      let age_1 = Math.pow(dage, -1);
      let age_2 = Math.pow(dage, 3);
      const dbmi = v.bmi / 10;
      let bmi_1 = Math.pow(dbmi, -2);
      let bmi_2 = Math.pow(dbmi, -2) * Math.log(dbmi);

      // Centering continuous variables
      age_1 -= 0.234766781330109;
      age_2 -= 77.284080505371094;
      bmi_1 -= 0.149176135659218;
      bmi_2 -= 0.141913309693336;
      const rati = v.rati - 4.300998687744141;
      const sbp = v.sbp - 128.57157897949219;
      const sbps5 = v.sbps5 - 8.756621360778809;
      const town = v.town - 0.52630490064621;

      let a = 0;
      a += Iethrisk[ethIdx];
      a += Ismoke[smokeIdx];

      // Continuous main effects
      a += age_1 * -17.839781666005575;
      a += age_2 * 0.0022964880605765492;
      a += bmi_1 * 2.4562776660536358;
      a += bmi_2 * -8.3011122314711354;
      a += rati * 0.17340196856327111;
      a += sbp * 0.012910126542553305;
      a += sbps5 * 0.010251914291290456;
      a += town * 0.033268201277287295;

      // Boolean main effects
      a += v.b_AF * 0.88209236928054657;
      a += v.b_atypicalantipsy * 0.13046879855173513;
      a += v.b_corticosteroids * 0.45485399750445543;
      a += v.b_impotence2 * 0.22251859086705383;
      a += v.b_migraine * 0.25584178074159913;
      a += v.b_ra * 0.20970658013956567;
      a += v.b_renal * 0.71853261288274384;
      a += v.b_semi * 0.12133039882047164;
      a += v.b_sle * 0.4401572174457522;
      a += v.b_treatedhyp * 0.51659871082695474;
      a += v.b_type1 * 1.2343425521675175;
      a += v.b_type2 * 0.85942071430932221;
      a += v.fh_cvd * 0.54055469009390156;

      // Interaction terms with age_1
      if (smoke_cat === 2) a += age_1 * -0.21011133933516346;
      if (smoke_cat === 3) a += age_1 * 0.75268676447503191;
      if (smoke_cat === 4) a += age_1 * 0.99315887556405791;
      if (smoke_cat === 5) a += age_1 * 2.1331163414389076;
      a += age_1 * v.b_AF * 3.4896675530623207;
      a += age_1 * v.b_corticosteroids * 1.1708133653489108;
      a += age_1 * v.b_impotence2 * -1.506400985745431;
      a += age_1 * v.b_migraine * 2.3491159871402441;
      a += age_1 * v.b_renal * -0.50656716327223694;
      a += age_1 * v.b_treatedhyp * 6.5114581098532671;
      a += age_1 * v.b_type1 * 5.3379864878006531;
      a += age_1 * v.b_type2 * 3.6461817406221311;
      a += age_1 * bmi_1 * 31.004952956033886;
      a += age_1 * bmi_2 * -111.29157184391643;
      a += age_1 * v.fh_cvd * 2.7808628508531887;
      a += age_1 * sbp * 0.018858524469865853;
      a += age_1 * town * -0.1007554870063731;

      // Interaction terms with age_2
      if (smoke_cat === 2) a += age_2 * -0.00049854870275326121;
      if (smoke_cat === 3) a += age_2 * -0.00079875633317385414;
      if (smoke_cat === 4) a += age_2 * -0.00083706184266251296;
      if (smoke_cat === 5) a += age_2 * -0.00078400319155637289;
      a += age_2 * v.b_AF * -0.00034995608340636049;
      a += age_2 * v.b_corticosteroids * -0.0002496045095297166;
      a += age_2 * v.b_impotence2 * -0.0011058218441227373;
      a += age_2 * v.b_migraine * 0.00019896446041478631;
      a += age_2 * v.b_renal * -0.0018325930166498813;
      a += age_2 * v.b_treatedhyp * 0.00063838053104165013;
      a += age_2 * v.b_type1 * 0.0006409780808752897;
      a += age_2 * v.b_type2 * -0.00024695695588868315;
      a += age_2 * bmi_1 * 0.0050380102356322029;
      a += age_2 * bmi_2 * -0.013074483002524319;
      a += age_2 * v.fh_cvd * -0.00024791809907396037;
      a += age_2 * sbp * -0.00001271874191588457;
      a += age_2 * town * -0.000093299642323272888;

      return 100.0 * (1 - Math.pow(survivor10, Math.exp(a)));
    }
  }

  function calcQRISK3_2017(p, derived) {
    const lifetimeEligible = p.ascvd === false && isNum(p.age) && p.age >= 25 && p.age <= 84 && isNum(p.qrLifetime) && isNum(p.qrEndAge) && p.qrEndAge > p.age;
    const lifetime = lifetimeEligible
      ? { percent: round1(p.qrLifetime), endAge: p.qrEndAge }
      : null;

    if (p.ascvd === true) {
      return {
        eligible: false,
        reason: 'QRISK3 is designed for primary prevention and is not applicable in established clinical ASCVD.',
        lifetime,
        missing: [],
      };
    }

    const missing = [];
    if (!isNum(p.age)) missing.push('Age');
    if (p.sex !== 'female' && p.sex !== 'male') missing.push('Sex');
    if (!isNum(p.sbp)) missing.push('Systolic BP');
    if (!isNum(derived.tcHdlRatio)) missing.push('Total cholesterol & HDL-C');
    if (!isNum(derived.bmiRaw)) missing.push('Height & Weight (BMI)');
    if (p.smokeCat === null || p.smokeCat === undefined) missing.push('Smoking category');
    if (p.dmStatus === null || p.dmStatus === undefined) missing.push('Diabetes status');
    if (p.bpTx === null || p.bpTx === undefined) missing.push('Antihypertensive treatment');

    if (missing.length) {
      return {
        eligible: false,
        reason: 'Missing required QRISK3 parameters: ' + missing.join(', ') + '.',
        lifetime,
        missing,
      };
    }

    if (p.age < 25 || p.age > 84) {
      return {
        eligible: false,
        reason: `QRISK3-2017 is validated for ages 25–84 years (entered age: ${p.age}).`,
        lifetime,
        missing: [],
      };
    }

    const notes = [];
    const imputations = [];

    let bmiUsed = derived.bmiRaw;
    if (bmiUsed < 20 || bmiUsed > 40) {
      notes.push(`BMI (${derived.bmi} kg/m²) is outside typical QRISK3 clinical bounds (20–40 kg/m²); clamped internally to [15, 50] for stability.`);
      bmiUsed = Math.max(15, Math.min(50, bmiUsed));
    }

    let ratiUsed = derived.tcHdlRatio;
    if (ratiUsed < 1 || ratiUsed > 11) {
      notes.push(`TC/HDL-C ratio (${derived.tcHdlRatio}) is outside QRISK3 bounds (1–11); clamped for calculation.`);
      ratiUsed = Math.max(1, Math.min(11, ratiUsed));
    }

    const defaultSbpSd = p.sex === 'female' ? 9.002537727355957 : 8.756621360778809;
    let sbps5Used = p.sbpSd;
    if (!isNum(sbps5Used)) {
      sbps5Used = defaultSbpSd;
      imputations.push(`SBP variability (SD) not entered — cohort mean (${round1(defaultSbpSd)} mmHg) applied.`);
    }

    let townUsed = p.townsend;
    if (!isNum(townUsed)) {
      townUsed = 0;
      imputations.push('Townsend deprivation score not entered — UK average (0.0) applied.');
    }

    const b_renal = p.ckdStage === '3a' || p.ckdStage === '3b' || p.ckdStage === '4' || p.ckdStage === '5' ? 1 : 0;
    const b_type1 = p.dmStatus === 't1' ? 1 : 0;
    const b_type2 = p.dmStatus === 't2' ? 1 : 0;

    const qInput = {
      age: p.age,
      ethnicity: p.ethnicity || 2, // default Indian if unselected
      smokeCat: p.smokeCat,
      bmi: bmiUsed,
      rati: ratiUsed,
      sbp: p.sbp,
      sbps5: sbps5Used,
      town: townUsed,
      b_AF: p.qrAF ? 1 : 0,
      b_atypicalantipsy: p.qrAtypicalAntipsy ? 1 : 0,
      b_corticosteroids: p.qrSteroids ? 1 : 0,
      b_impotence2: p.sex === 'male' && p.qrED ? 1 : 0,
      b_migraine: p.qrMigraine ? 1 : 0,
      b_ra: p.qrRA ? 1 : 0,
      b_renal,
      b_semi: p.qrSMI ? 1 : 0,
      b_sle: p.qrSLE ? 1 : 0,
      b_treatedhyp: p.bpTx ? 1 : 0,
      b_type1,
      b_type2,
      fh_cvd: p.qrFhCvd ? 1 : 0,
    };

    const rawScore = computeQRISK3Raw(p.sex, qInput);
    const percent = Math.max(0, Math.min(99.9, round1(rawScore)));

    // Healthy person comparison (same age, sex, ethnicity; non-smoker, SBP 125, TC/HDL 4.0, BMI 25, no comorbidities)
    const healthyRaw = computeQRISK3Raw(p.sex, {
      age: p.age,
      ethnicity: qInput.ethnicity,
      smokeCat: 1,
      bmi: 25,
      rati: 4.0,
      sbp: 125,
      sbps5: defaultSbpSd,
      town: 0,
      b_AF: 0,
      b_atypicalantipsy: 0,
      b_corticosteroids: 0,
      b_impotence2: 0,
      b_migraine: 0,
      b_ra: 0,
      b_renal: 0,
      b_semi: 0,
      b_sle: 0,
      b_treatedhyp: 0,
      b_type1: 0,
      b_type2: 0,
      fh_cvd: 0,
    });
    const healthyPercent = Math.max(0.1, round1(healthyRaw));
    const relativeRisk = healthyRaw > 0 ? Math.round((rawScore / healthyRaw) * 10) / 10 : null;

    const activeFactors = [];
    if (qInput.ethnicity >= 2 && qInput.ethnicity <= 5) {
      activeFactors.push(`Ethnicity: ${QRISK3_ETHNICITY_LABELS[qInput.ethnicity]}`);
    }
    if (qInput.smokeCat === 2) activeFactors.push('Ex-smoker');
    if (qInput.smokeCat === 3) activeFactors.push('Light smoker (<10/day)');
    if (qInput.smokeCat === 4) activeFactors.push('Moderate smoker (10–19/day)');
    if (qInput.smokeCat === 5) activeFactors.push('Heavy smoker (≥20/day)');
    if (b_type1) activeFactors.push('Type 1 diabetes');
    if (b_type2) activeFactors.push('Type 2 diabetes');
    if (qInput.b_treatedhyp) activeFactors.push('Treated hypertension');
    if (qInput.fh_cvd) activeFactors.push('1st-degree relative with angina/MI <60 yrs');
    if (b_renal) activeFactors.push(`CKD stage ${p.ckdStage}`);
    if (qInput.b_AF) activeFactors.push('Atrial fibrillation');
    if (qInput.b_migraine) activeFactors.push('Migraine');
    if (qInput.b_ra) activeFactors.push('Rheumatoid arthritis');
    if (qInput.b_sle) activeFactors.push('Systemic lupus erythematosus (SLE)');
    if (qInput.b_semi) activeFactors.push('Severe mental illness');
    if (qInput.b_atypicalantipsy) activeFactors.push('Atypical antipsychotic therapy');
    if (qInput.b_corticosteroids) activeFactors.push('Regular oral corticosteroids');
    if (qInput.b_impotence2) activeFactors.push('Erectile dysfunction');

    if (p.statin === true) {
      notes.push('QRISK3 was derived in statin-naive UK primary care patients; interpret cautiously when already on lipid-lowering therapy.');
    }
    notes.push('UK-derived QResearch model; selecting Indian ethnicity adjusts for UK South Asian hazard but does not establish domestic calibration in India.');

    let category = 'Low (<10% NICE threshold)';
    let tone = 'low';
    if (percent >= 20) {
      category = 'High (≥20%)';
      tone = 'very-high';
    } else if (percent >= 10) {
      category = 'Elevated (≥10% NICE statin threshold)';
      tone = 'high';
    }

    return {
      eligible: true,
      percent,
      rawScore,
      healthyPercent,
      relativeRisk,
      category,
      tone,
      ethnicityLabel: QRISK3_ETHNICITY_LABELS[qInput.ethnicity] || 'Indian',
      activeFactors,
      imputations,
      notes,
      lifetime,
      missing: [],
    };
  }

  // ============================================================================
  // 3. LAI 2023 CONSENSUS IV PROTOCOL ENGINE (Puri et al., J Clin Lipidol 2024)
  // ============================================================================

  const LAI_TARGETS = {
    'Low risk': {
      ldl: '<100 mg/dL',
      ldlNum: 100,
      nonHdl: '<130 mg/dL',
      apoB: '<90 mg/dL',
      tone: 'low',
      intensityNote: 'Lifestyle interventions first; consider low/moderate-intensity statin if LDL-C remains ≥100 mg/dL after lifestyle modification (Figure 4).',
    },
    'Moderate risk': {
      ldl: '<100 mg/dL (optional <70)',
      ldlNum: 100,
      nonHdl: '<130 mg/dL (optional <100)',
      apoB: '<90 mg/dL',
      tone: 'moderate',
      intensityNote: 'Lifestyle interventions + moderate- or high-intensity statin if LDL-C ≥100 mg/dL; escalate to HIS ± ezetimibe if not at goal (Figure 4).',
    },
    'High risk': {
      ldl: '<70 mg/dL',
      ldlNum: 70,
      nonHdl: '<100 mg/dL',
      apoB: '<80 mg/dL',
      tone: 'high',
      intensityNote: 'Initiate statin therapy immediately; choose intensity based on required % LDL-C lowering and reassess at 4 & 8 weeks (Figure 4).',
    },
    'Very high risk': {
      ldl: '<50 mg/dL',
      ldlNum: 50,
      nonHdl: '<80 mg/dL',
      apoB: '<65 mg/dL',
      tone: 'very-high',
      intensityNote: 'Initiate high-intensity statin ± ezetimibe immediately to reach LDL-C <50 mg/dL; add bempedoic acid / PCSK9i if needed (Figure 4).',
    },
    'Extreme risk — Category A': {
      ldl: '<50 mg/dL (optional ≤30)',
      ldlNum: 50,
      nonHdl: '<80 mg/dL (optional ≤60)',
      apoB: '<65 mg/dL',
      tone: 'extreme',
      intensityNote: 'High-intensity statin + ezetimibe upfront; consider bempedoic acid or PCSK9i to achieve LDL-C <50 mg/dL (optional ≤30 mg/dL).',
    },
    'Extreme risk — Category B': {
      ldl: '≤30 mg/dL',
      ldlNum: 30,
      nonHdl: '≤60 mg/dL',
      apoB: '<50 mg/dL',
      tone: 'extreme',
      intensityNote: 'Aggressive combination lipid-lowering (high-intensity statin + ezetimibe ± bempedoic acid / PCSK9i) to reach LDL-C ≤30 mg/dL.',
    },
    'Extreme risk — Category C': {
      ldl: '10–15 mg/dL',
      ldlNum: 15,
      nonHdl: '40–45 mg/dL',
      apoB: 'Individualized',
      tone: 'extreme',
      intensityNote: 'Specialist multifaceted review (Figure 3): verify adherence at LDL-C ~30 mg/dL, optimize non-lipid therapies (SGLT2i/GLP-1RA, icosapent ethyl if elevated TG, colchicine 0.5 mg/d if hsCRP >2 mg/L, DAPT or aspirin + low-dose rivaroxaban), then consider LDL-C 10–15 mg/dL with shared decision-making.',
    },
    'Review needed': {
      ldl: 'Confirm missing parameters',
      ldlNum: null,
      nonHdl: 'Confirm missing parameters',
      apoB: 'Confirm missing parameters',
      tone: 'neutral',
      intensityNote: 'Complete the missing core clinical or lipid parameters to assign a definitive LAI 2023 Consensus IV risk group.',
    },
  };

  function calcLAI2023(p, derived) {
    const nonHdl = derived.nonHdl;
    const knownDisease = p.ascvd === true || p.plaque === true;
    const lowCAC = isNum(p.cac) && p.cac > 0 && p.cac < 100;

    // 1. Major ASCVD Risk Factors (Figure 1, Column 1)
    const majorFactors = [];
    if (isNum(p.age) && p.sex) {
      if ((p.sex === 'male' && p.age >= 45) || (p.sex === 'female' && p.age >= 55)) {
        majorFactors.push(p.sex === 'male' ? 'Age ≥45 years (male)' : 'Age ≥55 years (female)');
      }
    }
    if (p.currentSmoker || p.smokelessTobacco === true || p.heavySmokingOver1Pack === true) {
      majorFactors.push('Current smoking or tobacco use (incl. smokeless/cultural)');
    }
    if (p.bpTx === true || (isNum(p.sbp) && p.sbp >= 140) || (isNum(p.dbp) && p.dbp >= 90)) {
      majorFactors.push('High blood pressure (≥140/90 mmHg or on antihypertensive therapy)');
    }
    if (isNum(p.hdl) && p.sex) {
      if ((p.sex === 'male' && p.hdl < 40) || (p.sex === 'female' && p.hdl < 50)) {
        majorFactors.push(p.sex === 'male' ? 'Low HDL-C (<40 mg/dL)' : 'Low HDL-C (<50 mg/dL)');
      }
    }

    // CACS 1-99 percentile resolution (manual percentile OR automatic LAI Table 1 & 2 lookup)
    let cacsBand = null; // 'high' (<75th), 'very-high' (>=75th or >75th), 'borderline-75', 'unresolved'
    let cacsNote = null;
    if (lowCAC) {
      if (isNum(p.cacPct)) {
        if (p.cacPct > 75) {
          cacsBand = 'very-high';
          cacsNote = `CACS ${p.cac} at ${p.cacPct}th percentile (>75th percentile — Very high risk)`;
        } else if (p.cacPct < 75) {
          cacsBand = 'high';
          cacsNote = `CACS ${p.cac} at ${p.cacPct}th percentile (<75th percentile — High-risk feature)`;
        } else {
          // Figure 2 explicitly writes >=75th percentile -> Very high risk; Figure 1 writes >75th
          cacsBand = 'borderline-75';
          cacsNote = `CACS ${p.cac} at exactly 75th percentile (Figure 2 assigns Very high risk for ≥75th; Figure 1 prints >75th — review clinically)`;
        }
      } else if (derived.cacs75Ref !== null) {
        if (p.cac > derived.cacs75Ref.threshold) {
          cacsBand = 'very-high';
          cacsNote = `CACS ${p.cac} exceeds ${derived.cacs75Ref.source} 75th-percentile threshold (${derived.cacs75Ref.threshold}) → >75th percentile`;
        } else if (p.cac < derived.cacs75Ref.threshold) {
          cacsBand = 'high';
          cacsNote = `CACS ${p.cac} is below ${derived.cacs75Ref.source} 75th-percentile threshold (${derived.cacs75Ref.threshold}) → <75th percentile`;
        } else {
          cacsBand = 'borderline-75';
          cacsNote = `CACS ${p.cac} equals ${derived.cacs75Ref.source} 75th-percentile threshold (${derived.cacs75Ref.threshold}) → review Figure 1 (>75th) vs Figure 2 (≥75th)`;
        }
      } else {
        cacsBand = 'unresolved';
      }
    }

    // 2. High-Risk Features (Figure 1, Column 2)
    const highRiskFeatures = [];
    if (p.laiFamily === true) highRiskFeatures.push('Family history of premature ASCVD (M <55 / F <65 or pre-menopause)');
    if (p.ckdStage === '3b' || p.ckdStage === '4') highRiskFeatures.push(`CKD stage ${p.ckdStage}`);
    if (isNum(p.apoB) && p.apoB > 130) highRiskFeatures.push(`Apolipoprotein B >130 mg/dL (${p.apoB} mg/dL)`);
    if (p.heavySmokingOver1Pack === true || (isNum(p.sbp) && p.sbp > 180) || (isNum(p.dbp) && p.dbp > 110)) {
      highRiskFeatures.push('Extreme single risk factor (smoking >1 pack/day or BP >180/110 mmHg)');
    }
    if (isNum(p.lpa) && p.lpa >= 50) highRiskFeatures.push(`Lipoprotein(a) ≥50 mg/dL (${p.lpa} mg/dL)`);
    if (p.metSyndrome === true) highRiskFeatures.push('Metabolic syndrome');
    if (p.nafldFibrosis === true) highRiskFeatures.push('NAFLD / MASLD with fibrosis grade 2 or 3');
    if (cacsBand === 'high') highRiskFeatures.push(`CACS 1–99 and <75th percentile (CACS ${p.cac})`);

    // 3. Risk Modifiers (Figure 1, Column 3 — all 10 explicit modifiers)
    const riskModifiers = [];
    if (isNum(p.lpa) && p.lpa >= 20 && p.lpa < 50) {
      riskModifiers.push(`Lipoprotein(a) 20–49 mg/dL (${p.lpa} mg/dL)`);
    }
    if (isNum(p.fbg) && p.fbg >= 100 && p.fbg <= 125 && !p.hasDiabetes) {
      riskModifiers.push(`Impaired fasting glucose (${p.fbg} mg/dL; confirm by repeat test)`);
    }
    if (isNum(p.waistCm) && p.sex) {
      if ((p.sex === 'male' && p.waistCm > 90) || (p.sex === 'female' && p.waistCm > 80)) {
        riskModifiers.push(`Increased waist circumference (${p.waistCm} cm; threshold >${p.sex === 'male' ? 90 : 80} cm)`);
      }
    }
    if (isNum(p.hsCRP) && p.hsCRP > 2) {
      riskModifiers.push(`hsCRP >2 mg/L (${p.hsCRP} mg/L; confirm on 2 occasions ≥2 weeks apart)`);
    }
    if (isNum(p.triglycerides)) {
      const tgThreshold = p.tgFasting ? 150 : 175;
      if (p.triglycerides > tgThreshold) {
        riskModifiers.push(`Elevated ${p.tgFasting ? 'fasting' : 'non-fasting'} triglycerides (${p.triglycerides} mg/dL > ${tgThreshold})`);
      }
    }
    if (p.qrRA === true || p.laiInflammatory === true) {
      riskModifiers.push('Chronic inflammatory disorder (RA, psoriasis, or spondyloarthropathy)');
    }
    if (p.sex === 'female' && p.laiFemaleSpecific === true) {
      riskModifiers.push('Female-specific enhancer (premature menopause, pre-eclampsia, GDM, or PCOS)');
    }
    if (p.laiHighPRS === true) riskModifiers.push('High polygenic risk score');
    if (p.laiAirPollution === true) riskModifiers.push('Chronic high air pollution exposure (PM₂.₅)');
    if (p.laiHIV === true) riskModifiers.push('HIV infection');

    const hasModifier = riskModifiers.length > 0;
    const lifetimeEligible = p.ascvd === false && isNum(p.age) && p.age >= 25 && p.age <= 84 && isNum(p.qrLifetime) && isNum(p.qrEndAge) && p.qrEndAge > p.age;
    const qrLife = lifetimeEligible ? p.qrLifetime : null;

    // 4. Risk Tier Criteria Evaluation (Figure 1 & Figure 2)
    const veryHighReasons = [];
    if (p.hasDiabetes && (p.dmTod === true || majorFactors.length >= 2)) {
      veryHighReasons.push('Diabetes with target-organ damage or ≥2 major ASCVD risk factors');
    }
    if ((isNum(p.cac) && p.cac >= 100 && p.cac < 300) || cacsBand === 'very-high' || cacsBand === 'borderline-75') {
      veryHighReasons.push(
        isNum(p.cac) && p.cac >= 100
          ? `CACS 100–299 (${p.cac} Agatston)`
          : cacsBand === 'borderline-75'
          ? `CACS 1–99 at 75th percentile (Figure 2 ≥75th band)`
          : `CACS 1–99 and >75th percentile (CACS ${p.cac})`
      );
    }
    if (highRiskFeatures.length >= 2) {
      veryHighReasons.push(`≥2 high-risk features (${highRiskFeatures.length} documented)`);
    }
    if (p.fh === 'het' || (isNum(p.ldl) && p.ldl >= 190)) {
      veryHighReasons.push(p.fh === 'het' ? 'Heterozygous familial hypercholesterolaemia (FH)' : `LDL-C ≥190 mg/dL (${p.ldl} mg/dL)`);
    }

    const highReasons = [...highRiskFeatures];
    if (majorFactors.length >= 3) highReasons.push(`≥3 major ASCVD risk factors (${majorFactors.length})`);
    if (isNum(p.ldl) && p.ldl >= 160 && p.ldl < 190) highReasons.push(`LDL-C 160–189 mg/dL (${p.ldl} mg/dL)`);
    if (isNum(nonHdl) && nonHdl >= 190 && nonHdl < 220) highReasons.push(`Non-HDL-C 190–219 mg/dL (${nonHdl} mg/dL)`);
    if (p.hasDiabetes && majorFactors.length < 2 && p.dmTod !== true) {
      highReasons.push('Diabetes with 0–1 major ASCVD risk factor and no target-organ damage');
    }
    if (majorFactors.length === 2 && hasModifier) {
      highReasons.push('2 major ASCVD risk factors + ≥1 risk modifier');
    }

    const moderateReasons = [];
    if (majorFactors.length === 2) moderateReasons.push('2 major ASCVD risk factors');
    if (isNum(p.ldl) && p.ldl >= 130 && p.ldl < 160) moderateReasons.push(`LDL-C 130–159 mg/dL (${p.ldl} mg/dL)`);
    if (isNum(nonHdl) && nonHdl >= 160 && nonHdl < 190) moderateReasons.push(`Non-HDL-C 160–189 mg/dL (${nonHdl} mg/dL)`);
    const inLowLipidBand = isNum(p.ldl) && p.ldl < 130 && isNum(nonHdl) && nonHdl < 160;
    if (majorFactors.length <= 1 && inLowLipidBand && hasModifier) {
      moderateReasons.push('Low-risk clinical profile reclassified by ≥1 risk modifier');
    }
    if (majorFactors.length <= 1 && inLowLipidBand && qrLife !== null && qrLife > 30) {
      moderateReasons.push(`Low-risk clinical profile reclassified by QRISK3-lifetime CVD >30% (${qrLife}%)`);
    }

    const extremeCReasons = [];
    if (knownDisease && p.catC === true) {
      extremeCReasons.push('Recurrent ASCVD event despite achieving LDL-C around 30 mg/dL (Extreme Category C)');
    }

    const extremeBReasons = [];
    if (knownDisease) {
      if (veryHighReasons.length) extremeBReasons.push(...veryHighReasons.map((r) => `ASCVD + ${r}`));
      if (p.recurrent === true) extremeBReasons.push('ASCVD with recurrent ACS or polyvascular disease');
      if (p.fh === 'hom') extremeBReasons.push('ASCVD with homozygous FH');
    }

    const extremeAReasons = [];
    if (isNum(p.cac) && p.cac >= 300) extremeAReasons.push(`CACS ≥300 (${p.cac} Agatston)`);
    if (p.fh === 'hom' && !knownDisease) extremeAReasons.push('Homozygous familial hypercholesterolaemia (FH)');
    if (knownDisease && highReasons.length) extremeAReasons.push(...highReasons.map((r) => `ASCVD + ${r}`));

    const veryHighAll = [...veryHighReasons];
    if (knownDisease) {
      veryHighAll.push(p.ascvd === true ? 'Established clinical ASCVD' : 'Subclinical arterial plaque (carotid/femoral/coronary) or ABI <0.9');
    }

    // Core completeness for assigning Low risk
    const coreMissing = [];
    if (!isNum(p.age)) coreMissing.push('Age');
    if (!p.sex) coreMissing.push('Sex');
    if (!isNum(p.sbp) || !isNum(p.dbp)) coreMissing.push('Blood pressure');
    if (p.bpTx === null || p.bpTx === undefined) coreMissing.push('Antihypertensive treatment');
    if (p.smokeCat === null || p.smokeCat === undefined) coreMissing.push('Smoking status');
    if (p.dmStatus === null || p.dmStatus === undefined) coreMissing.push('Diabetes status');
    if (!isNum(p.tc) || !isNum(p.hdl) || !isNum(p.ldl)) coreMissing.push('Lipid panel (TC, HDL-C, LDL-C)');
    if (p.ascvd === null || p.ascvd === undefined) coreMissing.push('Clinical ASCVD status');

    const lowReasons = [];
    if (coreMissing.length === 0 && !knownDisease && majorFactors.length <= 1 && inLowLipidBand && !hasModifier && (qrLife === null || qrLife < 30)) {
      lowReasons.push(`0–1 major risk factor (${majorFactors.length}), LDL-C <130 mg/dL, Non-HDL-C <160 mg/dL, no high-risk features or modifiers`);
      if (qrLife !== null) {
        lowReasons.push(`QRISK3-lifetime CVD <30% (${qrLife}% to age ${p.qrEndAge})`);
      }
    }

    const hierarchy = [
      ['Extreme risk — Category C', extremeCReasons],
      ['Extreme risk — Category B', extremeBReasons],
      ['Extreme risk — Category A', extremeAReasons],
      ['Very high risk', veryHighAll],
      ['High risk', highReasons],
      ['Moderate risk', moderateReasons],
      ['Low risk', lowReasons],
    ];

    const matched = hierarchy.find((row) => row[1].length > 0);
    const tier = matched ? matched[0] : 'Review needed';
    const reasons = matched ? matched[1] : [];

    // Clinical review flags & advisories
    const flags = [];
    if (coreMissing.length) {
      flags.push('Core clinical profile incomplete: confirm ' + coreMissing.join(', ') + '.');
    }
    if (p.statin === true) {
      flags.push('Currently on lipid-lowering therapy — interpret lipid thresholds against pretreatment values if available.');
    }
    if (p.ckdStage === '5') {
      flags.push('CKD Stage 5 documented — LAI Consensus IV explicitly lists CKD Stage 3b/4 as a high-risk feature; manage Stage 5/dialysis dyslipidemia per nephrology-lipid guidance.');
    }
    if (cacsBand === 'unresolved') {
      flags.push('CACS 1–99 requires age (30–84), sex, or a reported CACS percentile to distinguish High vs Very high risk.');
    }
    if (cacsBand === 'borderline-75') {
      flags.push('CACS lies exactly on the 75th percentile (Figure 1 prints >75th; Figure 2 prints ≥75th). Assigned Very high risk per Figure 2 — clinician adjudication advised.');
    }
    if (qrLife === 30) {
      flags.push('QRISK3-lifetime is exactly 30% (boundary between Figure 1 <30% and >30%); clinician adjudication advised.');
    }
    if (tier === 'Low risk' && qrLife === null) {
      flags.push('QRISK3-lifetime CVD not entered — confirm lifetime risk is <30% on official qrisk.org/lifetime/ before finalizing Low risk.');
    }
    if (isNum(nonHdl) && nonHdl >= 220 && !(isNum(p.ldl) && p.ldl >= 190)) {
      flags.push(`Non-HDL-C ≥220 mg/dL (${nonHdl} mg/dL) without LDL-C ≥190 mg/dL falls above printed Figure 1 bands — assess for hypertriglyceridemia/remnant cholesterol.`);
    }
    if (p.catC === true) {
      flags.push('Extreme Category C requires specialist review of recurrent events, achieved LDL-C (~30 mg/dL), and non-lipid residual risk management (Figure 3).');
    }
    if (p.ascvd === true) {
      flags.push('Established clinical ASCVD — manage on the secondary-prevention pathway.');
    }

    const targets = LAI_TARGETS[tier];
    let ldlReductionPct = null;
    let statinStep = null;
    if (isNum(p.ldl) && isNum(targets.ldlNum) && p.ldl > 0) {
      if (p.ldl <= targets.ldlNum) {
        ldlReductionPct = 0;
        statinStep = 'Current LDL-C is at or below the primary LAI target; maintain regimen and verify Non-HDL-C and ApoB goals.';
      } else {
        ldlReductionPct = Math.ceil(((p.ldl - targets.ldlNum) / p.ldl) * 100);
        if (ldlReductionPct <= 30) {
          statinStep = `Requires ~${ldlReductionPct}% LDL-C reduction → Moderate-intensity statin (MIS) typically achieves ~30% lowering (Figure 4).`;
        } else if (ldlReductionPct <= 50) {
          statinStep = `Requires ~${ldlReductionPct}% LDL-C reduction → High-intensity statin (HIS) typically achieves ~50% lowering (Figure 4).`;
        } else if (ldlReductionPct <= 65) {
          statinStep = `Requires ~${ldlReductionPct}% LDL-C reduction → High-intensity statin + ezetimibe typically achieves ~65% lowering (Figure 4).`;
        } else {
          statinStep = `Requires ~${ldlReductionPct}% LDL-C reduction → High-intensity statin + ezetimibe, with early consideration of bempedoic acid (~20% additional) or PCSK9 inhibitor (>20% additional) (Figure 4).`;
        }
      }
    }

    // Hypertriglyceridemia guidance (Figure 5)
    let tgGuidance = null;
    if (isNum(p.triglycerides) && p.triglycerides >= 150) {
      if (p.triglycerides >= 1000) {
        tgGuidance = 'TG ≥1000 mg/dL: Markedly elevated pancreatitis risk — initiate fibrate + omega-3 fatty acids + strict low-fat diet/secondary cause workup immediately (Figure 5).';
      } else if (p.triglycerides >= 500) {
        tgGuidance = 'TG 500–999 mg/dL: Elevated pancreatitis & ASCVD risk — add fibrate + omega-3 fatty acids alongside lifestyle & statin ± ezetimibe (Figure 5).';
      } else if (p.triglycerides >= 200) {
        tgGuidance = 'TG 200–499 mg/dL: Achieve LDL-C target with statin ± ezetimibe first; if TG or Non-HDL-C remains elevated, consider icosapent ethyl or fibrate (Figure 5).';
      } else {
        tgGuidance = 'TG 150–199 mg/dL: Emphasize lifestyle interventions and achieve primary LDL-C & Non-HDL-C targets (Figure 5).';
      }
    }

    const provisional =
      tier !== 'Review needed' &&
      (coreMissing.length > 0 || (tier === 'Low risk' && qrLife === null) || cacsBand === 'unresolved' || p.statin === true);

    return {
      tier,
      tone: targets.tone,
      provisional,
      reasons,
      majorFactors,
      highRiskFeatures,
      riskModifiers,
      cacsNote,
      targets,
      ldlReductionPct,
      statinStep,
      tgGuidance,
      flags,
    };
  }

  // ============================================================================
  // 4. INPUT VALIDATION & MASTER ORCHESTRATOR
  // ============================================================================

  function validateInputs(p) {
    const conflicts = [];
    if (!p.hasDiabetes && p.dmTod === true) {
      conflicts.push('Diabetes with target-organ damage requires Diabetes (Type 1 or Type 2) to be selected.');
    }
    if (p.ascvd !== true && (p.recurrent === true || p.catC === true)) {
      conflicts.push('Recurrent ACS / polyvascular disease or Category C requires Established Clinical ASCVD to be Yes.');
    }
    if (p.heavySmokingOver1Pack === true && p.smokeCat !== null && p.smokeCat !== undefined && p.smokeCat <= 2) {
      conflicts.push('Regular smoking >1 pack/day conflicts with Non-smoker or Ex-smoker status.');
    }
    if (isNum(p.cacPct) && !(isNum(p.cac) && p.cac > 0 && p.cac < 100)) {
      conflicts.push('Enter a CACS percentile only when CACS is between 1 and 99 Agatston.');
    }
    if (isNum(p.qrLifetime) && (!isNum(p.qrEndAge) || !isNum(p.age) || p.qrEndAge <= p.age)) {
      conflicts.push('QRISK3-lifetime requires an end age strictly greater than the patient’s current age.');
    }
    if (isNum(p.sbp) && isNum(p.dbp) && p.dbp >= p.sbp) {
      conflicts.push('Systolic blood pressure must be strictly greater than diastolic blood pressure.');
    }
    if (isNum(p.tc) && isNum(p.hdl)) {
      if (p.hdl >= p.tc) {
        conflicts.push('HDL-C must be lower than Total Cholesterol (confirm values are in mg/dL).');
      } else if (isNum(p.ldl) && p.ldl > p.tc - p.hdl + 5) {
        conflicts.push('LDL-C exceeds Total Cholesterol minus HDL-C (Non-HDL-C); confirm lipid values in mg/dL.');
      }
    }
    return conflicts;
  }

  function evaluateAllProtocols(rawInput, preventCoeffs) {
    // Normalize derived booleans
    const p = Object.assign({}, rawInput);
    p.hasDiabetes = p.dmStatus === 't1' || p.dmStatus === 't2';
    p.currentSmoker = p.smokeCat === 3 || p.smokeCat === 4 || p.smokeCat === 5;
    if (p.smokeCat === 5 && p.heavySmokingOver1Pack === null) {
      // Heavy smoker (>=20/day) does not automatically mean >1 pack/day (>20), keep explicit unless set
    }

    const conflicts = validateInputs(p);
    if (conflicts.length) {
      return { status: 'conflict', conflicts };
    }

    const severeBP = (isNum(p.sbp) && p.sbp > 180) || (isNum(p.dbp) && p.dbp > 120);
    const derived = computeDerived(p);
    const pce = calcPCE10Year(p);
    const prevent = calcPREVENT(p, derived, preventCoeffs || root.PREVENT_COEFFS);
    const accLifetime = calcACCLifetime(p);
    const qrisk3 = calcQRISK3_2017(p, derived);
    const lai = calcLAI2023(p, derived);

    return {
      status: 'ok',
      severeBP,
      derived,
      ascvd: { pce, prevent, accLifetime },
      qrisk3,
      lai,
    };
  }

  const api = {
    calcCKDEPI2021,
    computeDerived,
    getLAI75thPercentileCACS,
    calcPCE10Year,
    calcPREVENT,
    calcACCLifetime,
    calcQRISK3_2017,
    calcLAI2023,
    validateInputs,
    evaluateAllProtocols,
    QRISK3_ETHNICITY_LABELS,
    LAI_TARGETS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.RiskEngines = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
