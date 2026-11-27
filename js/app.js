/**
 * UI Controller for India Multi-Protocol Cardiovascular Risk Calculator
 * Connects all shared, ASCVD, QRISK3, and LAI 2023 parameters to window.RiskEngines
 * and renders structured per-protocol risk assessments + SVG comparison chart.
 */
(function () {
  'use strict';

  const form = document.getElementById('risk-form');
  const resultsEl = document.getElementById('results-stage');
  const liveBmiEl = document.getElementById('live-bmi');
  const liveNonHdlEl = document.getElementById('live-nonhdl');
  const liveRatioEl = document.getElementById('live-ratio');
  const liveCacs75El = document.getElementById('live-cacs75');
  const calcEgfrBtn = document.getElementById('calc-egfr-btn');
  const egfrHelperNote = document.getElementById('egfr-helper-note');

  let activeResultTab = 'all';
  let lastEvaluation = null;
  let lastInput = null;

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function numVal(name) {
    const el = form.elements[name];
    if (!el || el.value === '' || el.value === null) return null;
    const n = Number(el.value);
    return Number.isFinite(n) ? n : null;
  }

  function strVal(name) {
    const el = form.elements[name];
    if (!el || el.value === '') return null;
    return el.value;
  }

  function triBool(name) {
    const v = strVal(name);
    if (v === 'yes') return true;
    if (v === 'no') return false;
    return null;
  }

  function checkBool(name) {
    const el = form.elements[name];
    return !!(el && el.checked);
  }

  function collectFormValues() {
    const ethStr = strVal('ethnicity');
    const smokeStr = strVal('smokeCat');
    return {
      // Shared Core
      age: numVal('age'),
      sex: strVal('sex'),
      ethnicity: ethStr ? Number(ethStr) : 2,
      pceRace: strVal('pceRace') || 'auto',
      heightCm: numVal('heightCm'),
      weightKg: numVal('weightKg'),
      bmiDirect: numVal('bmiDirect'),
      sbp: numVal('sbp'),
      dbp: numVal('dbp'),
      bpTx: triBool('bpTx'),
      statin: triBool('statin'),
      tc: numVal('tc'),
      hdl: numVal('hdl'),
      ldl: numVal('ldl'),
      smokeCat: smokeStr ? Number(smokeStr) : null,
      smokelessTobacco: triBool('smokelessTobacco'),
      heavySmokingOver1Pack: triBool('heavySmokingOver1Pack'),
      dmStatus: strVal('dmStatus'),
      dmTod: triBool('dmTod'),
      ckdStage: strVal('ckdStage') || 'none',
      ascvd: triBool('ascvd'),

      // ASCVD / PREVENT specific
      egfr: numVal('egfr'),
      hba1c: numVal('hba1c'),
      uacr: numVal('uacr'),
      sdi: numVal('sdi'),

      // QRISK3 specific
      sbpSd: numVal('sbpSd'),
      townsend: numVal('townsend'),
      qrFhCvd: checkBool('qrFhCvd'),
      qrAF: checkBool('qrAF'),
      qrMigraine: checkBool('qrMigraine'),
      qrRA: checkBool('qrRA'),
      qrSLE: checkBool('qrSLE'),
      qrSMI: checkBool('qrSMI'),
      qrAtypicalAntipsy: checkBool('qrAtypicalAntipsy'),
      qrSteroids: checkBool('qrSteroids'),
      qrED: checkBool('qrED'),
      qrLifetime: numVal('qrLifetime'),
      qrEndAge: numVal('qrEndAge'),

      // LAI 2023 specific
      plaque: triBool('plaque'),
      fh: strVal('fh') || 'unknown',
      recurrent: triBool('recurrent'),
      catC: triBool('catC'),
      cac: numVal('cac'),
      cacPct: numVal('cacPct'),
      laiFamily: triBool('laiFamily'),
      apoB: numVal('apoB'),
      lpa: numVal('lpa'),
      metSyndrome: triBool('metSyndrome'),
      nafldFibrosis: triBool('nafldFibrosis'),
      fbg: numVal('fbg'),
      waistCm: numVal('waistCm'),
      hsCRP: numVal('hsCRP'),
      triglycerides: numVal('triglycerides'),
      tgFasting: strVal('tgState') !== 'nonfasting',
      laiInflammatory: checkBool('laiInflammatory'),
      laiFemaleSpecific: checkBool('laiFemaleSpecific'),
      laiHighPRS: checkBool('laiHighPRS'),
      laiAirPollution: checkBool('laiAirPollution'),
      laiHIV: checkBool('laiHIV'),
    };
  }

  function updateDerivedReadouts() {
    const p = collectFormValues();
    const d = window.RiskEngines.computeDerived(p);

    liveBmiEl.textContent = d.bmi !== null ? `${d.bmi.toFixed(1)} kg/m²` : '—';
    liveNonHdlEl.textContent = d.nonHdl !== null ? `${d.nonHdl.toFixed(0)} mg/dL` : '—';
    liveRatioEl.textContent = d.tcHdlRatio !== null ? `${d.tcHdlRatio.toFixed(2)}` : '—';
    liveCacs75El.textContent =
      d.cacs75Ref !== null ? `${d.cacs75Ref.threshold} Agatston` : '—';

    // Update sex-specific field notes cleanly
    const edWrap = document.getElementById('field-qr-ed');
    const femWrap = document.getElementById('field-lai-female');
    if (edWrap) {
      const edDisabled = p.sex === 'female';
      edWrap.classList.toggle('is-muted-field', edDisabled);
      form.elements.qrED.disabled = edDisabled;
      if (edDisabled) form.elements.qrED.checked = false;
    }
    if (femWrap) {
      const femDisabled = p.sex === 'male';
      femWrap.classList.toggle('is-muted-field', femDisabled);
      form.elements.laiFemaleSpecific.disabled = femDisabled;
      if (femDisabled) form.elements.laiFemaleSpecific.checked = false;
    }

    // Auto-highlight PCE race mapping note
    const pceNoteEl = document.getElementById('pce-race-auto-note');
    if (pceNoteEl) {
      const isAA = p.pceRace === 'aa' || (p.pceRace === 'auto' && (p.ethnicity === 6 || p.ethnicity === 7));
      pceNoteEl.textContent = isAA
        ? 'Active PCE stratum: African American equation'
        : 'Active PCE stratum: White / Other equation (note: underestimates South Asian risk)';
    }
  }

  function buildComparisonSVG(res) {
    const bars = [];
    if (res.ascvd.pce.eligible) {
      bars.push({ label: 'ASCVD · PCE 10-Yr', val: res.ascvd.pce.percent, color: '#0A5C57' });
    }
    if (res.ascvd.prevent.eligible10) {
      bars.push({ label: 'ASCVD · PREVENT 10-Yr', val: res.ascvd.prevent.r10.ascvd, color: '#0F766E' });
      bars.push({ label: 'Total CVD · PREVENT 10-Yr', val: res.ascvd.prevent.r10.total_cvd, color: '#155E75' });
    }
    if (res.ascvd.prevent.eligible30 && res.ascvd.prevent.r30) {
      bars.push({ label: 'ASCVD · PREVENT 30-Yr', val: res.ascvd.prevent.r30.ascvd, color: '#0369A1' });
    }
    if (res.ascvd.accLifetime.eligible) {
      bars.push({ label: 'ASCVD · ACC Lifetime', val: res.ascvd.accLifetime.percent, color: '#475569' });
    }
    if (res.qrisk3.eligible) {
      bars.push({ label: 'QRISK3-2017 · 10-Yr CVD', val: res.qrisk3.percent, color: '#B45309' });
      bars.push({ label: 'QRISK3 · Healthy Baseline', val: res.qrisk3.healthyPercent, color: '#94A3B8' });
    }
    if (res.qrisk3.lifetime) {
      bars.push({
        label: `QRISK3-Lifetime (to ${res.qrisk3.lifetime.endAge}y)`,
        val: res.qrisk3.lifetime.percent,
        color: '#9A3412',
      });
    }

    if (!bars.length) {
      return '<p class="muted-text">No primary-prevention percentage estimates apply to this clinical profile (for example, established clinical ASCVD or missing numeric inputs).</p>';
    }

    const maxVal = Math.max(35, ...bars.map((b) => b.val));
    const scaleMax = maxVal <= 40 ? 40 : maxVal <= 60 ? 60 : maxVal <= 80 ? 80 : 100;
    const rowH = 30;
    const labelW = 196;
    const rightPad = 56;
    const chartW = 540;
    const barMaxW = chartW - labelW - rightPad;
    const topPad = 20;
    const svgH = topPad + bars.length * rowH + 22;

    const thresholds = [7.5, 10, 20, 30].filter((t) => t <= scaleMax);
    let gridLines = '';
    for (const t of thresholds) {
      const x = labelW + (t / scaleMax) * barMaxW;
      gridLines += `<line x1="${x.toFixed(1)}" y1="${topPad - 6}" x2="${x.toFixed(1)}" y2="${svgH - 20}" stroke="#CBD5E1" stroke-dasharray="3 3" stroke-width="1" />`;
      gridLines += `<text x="${x.toFixed(1)}" y="${svgH - 6}" text-anchor="middle" fill="#64748B" font-size="10" font-family="IBM Plex Mono, monospace">${t}%</text>`;
    }

    let rowsSvg = '';
    bars.forEach((b, idx) => {
      const y = topPad + idx * rowH;
      const w = Math.max(2, (b.val / scaleMax) * barMaxW);
      rowsSvg += `
        <text x="${labelW - 10}" y="${y + 15}" text-anchor="end" fill="#1E293B" font-size="11.5" font-weight="500" font-family="Plus Jakarta Sans, sans-serif">${esc(b.label)}</text>
        <rect x="${labelW}" y="${y + 4}" width="${barMaxW}" height="14" rx="2" fill="#F1F5F9" />
        <rect x="${labelW}" y="${y + 4}" width="${w.toFixed(1)}" height="14" rx="2" fill="${b.color}" />
        <text x="${(labelW + barMaxW + 8).toFixed(1)}" y="${y + 15}" fill="#0F172A" font-size="11.5" font-weight="600" font-family="IBM Plex Mono, monospace">${b.val.toFixed(1)}%</text>
      `;
    });

    return `
      <div class="chart-wrap">
        <svg viewBox="0 0 ${chartW} ${svgH}" role="img" aria-label="Comparison of calculated cardiovascular risk percentages across protocols" class="risk-chart-svg">
          <line x1="${labelW}" y1="${topPad - 6}" x2="${labelW}" y2="${svgH - 20}" stroke="#94A3B8" stroke-width="1" />
          ${gridLines}
          ${rowsSvg}
        </svg>
        <div class="chart-caption">Reference lines: 7.5% (ACC/AHA PCE intermediate), 10% (NICE QRISK3 statin threshold), 20% (high 10-year risk), 30% (LAI QRISK3-lifetime threshold).</div>
      </div>
    `;
  }

  function renderLAISection(res, p) {
    const lai = res.lai;
    const d = res.derived;
    const toneClass = `tone-${lai.tone}`;
    return `
      <article class="protocol-card" data-protocol="lai">
        <div class="protocol-header">
          <div>
            <div class="protocol-kicker">Protocol 1 · India Consensus Stratification</div>
            <h3>LAI 2023 Consensus IV Risk Assessment</h3>
          </div>
          <div class="protocol-headline ${toneClass}">
            <div class="headline-value">${esc(lai.tier)}</div>
            <div class="headline-sub">${lai.provisional ? 'Provisional · confirm pending inputs' : 'Consensus category'}</div>
          </div>
        </div>

        <div class="target-grid">
          <div class="target-cell">
            <div class="target-label">Primary LDL-C target</div>
            <div class="target-val mono">${esc(lai.targets.ldl)}</div>
          </div>
          <div class="target-cell">
            <div class="target-label">Co-primary Non-HDL-C</div>
            <div class="target-val mono">${esc(lai.targets.nonHdl)}</div>
          </div>
          <div class="target-cell">
            <div class="target-label">Secondary ApoB target</div>
            <div class="target-val mono">${esc(lai.targets.apoB)}</div>
          </div>
        </div>

        ${lai.statinStep ? `<p class="clinical-guidance"><strong>Figure 4 Lipid-Lowering Intensity:</strong> ${esc(lai.statinStep)}</p>` : `<p class="clinical-guidance"><strong>Management Approach:</strong> ${esc(lai.targets.intensityNote)}</p>`}
        ${lai.tgGuidance ? `<p class="clinical-guidance"><strong>Figure 5 Hypertriglyceridemia Guidance:</strong> ${esc(lai.tgGuidance)}</p>` : ''}

        ${lai.reasons.length ? `
          <div class="detail-block">
            <div class="detail-title">Triggering Criteria</div>
            <ul class="clean-list">${lai.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          </div>` : ''}

        <div class="factor-columns">
          <div class="detail-block">
            <div class="detail-title">Major ASCVD Factors (${lai.majorFactors.length}/4)</div>
            <p class="detail-body">${lai.majorFactors.length ? esc(lai.majorFactors.join(' · ')) : 'None documented'}</p>
          </div>
          <div class="detail-block">
            <div class="detail-title">High-Risk Features (${lai.highRiskFeatures.length})</div>
            <p class="detail-body">${lai.highRiskFeatures.length ? esc(lai.highRiskFeatures.join(' · ')) : 'None documented'}</p>
          </div>
          <div class="detail-block">
            <div class="detail-title">Risk Modifiers (${lai.riskModifiers.length}/10)</div>
            <p class="detail-body">${lai.riskModifiers.length ? esc(lai.riskModifiers.join(' · ')) : 'None documented'}</p>
          </div>
          <div class="detail-block">
            <div class="detail-title">Lipid & Imaging Summary</div>
            <p class="detail-body mono-inline">
              Non-HDL-C: ${d.nonHdl !== null ? d.nonHdl + ' mg/dL' : 'Unavailable'} ·
              CACS: ${p.cac !== null ? p.cac + ' Agatston' : 'Untested'}${d.cacs75Ref ? ` (75th-pct ref: ${d.cacs75Ref.threshold})` : ''}
            </p>
            ${lai.cacsNote ? `<p class="muted-note">${esc(lai.cacsNote)}</p>` : ''}
          </div>
        </div>

        ${lai.flags.length ? `
          <div class="advisory-box">
            <div class="advisory-title">Clinical Review Notes (LAI)</div>
            <ul class="clean-list">${lai.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          </div>` : ''}
      </article>
    `;
  }

  function renderASCVDSection(res) {
    const { pce, prevent, accLifetime } = res.ascvd;
    return `
      <article class="protocol-card" data-protocol="ascvd">
        <div class="protocol-header">
          <div>
            <div class="protocol-kicker">Protocol 2 · ACC / AHA Equations</div>
            <h3>ASCVD Protocol Estimates</h3>
          </div>
          <div class="protocol-headline ${pce.eligible ? 'tone-' + pce.tone : 'tone-neutral'}">
            <div class="headline-value mono">${pce.eligible ? pce.percent.toFixed(1) + '%' : prevent.eligible10 ? prevent.r10.ascvd.toFixed(1) + '%' : 'N/A'}</div>
            <div class="headline-sub">${pce.eligible ? '10-Yr PCE ASCVD' : prevent.eligible10 ? '10-Yr PREVENT ASCVD' : 'Not eligible'}</div>
          </div>
        </div>

        <div class="submodel-block">
          <div class="submodel-head">
            <div>
              <strong>A. 2013 ACC/AHA Pooled Cohort Equations (10-Year Hard ASCVD)</strong>
              <div class="muted-note">${pce.eligible ? esc(pce.raceLabel) + ' · ' + esc(pce.category) : 'Goff et al., Circulation 2014 · Ages 40–79'}</div>
            </div>
            <div class="submodel-metric mono">${pce.eligible ? pce.percent.toFixed(1) + '%' : 'Unavailable'}</div>
          </div>
          ${!pce.eligible ? `<p class="muted-note">${esc(pce.reason)}</p>` : ''}
          ${pce.eligible && pce.notes.length ? `<ul class="note-list">${pce.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        </div>

        <div class="submodel-block">
          <div class="submodel-head">
            <div>
              <strong>B. 2024 AHA PREVENT Equations (Race-Free CKM Model)</strong>
              <div class="muted-note">${prevent.eligible10 ? esc(prevent.modelLabel) + ' · 10-Yr Category: ' + esc(prevent.category10) : 'Khan et al., Circulation 2024 · Ages 30–79 (10-yr) & 30–59 (30-yr)'}</div>
            </div>
            <div class="submodel-metric mono">${prevent.eligible10 ? prevent.r10.ascvd.toFixed(1) + '%' : 'Unavailable'}</div>
          </div>
          ${!prevent.eligible10 ? `<p class="muted-note">${esc(prevent.reason)}</p>` : `
            <table class="data-table">
              <thead>
                <tr>
                  <th>AHA PREVENT Outcome</th>
                  <th class="num">10-Year Risk</th>
                  <th class="num">30-Year Risk</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>ASCVD</strong> (CHD + Stroke)</td>
                  <td class="num mono"><strong>${prevent.r10.ascvd.toFixed(1)}%</strong></td>
                  <td class="num mono">${prevent.eligible30 ? '<strong>' + prevent.r30.ascvd.toFixed(1) + '%</strong>' : 'Age 30–59 only'}</td>
                </tr>
                <tr>
                  <td>Total CVD (ASCVD + Heart Failure)</td>
                  <td class="num mono">${prevent.r10.total_cvd.toFixed(1)}%</td>
                  <td class="num mono">${prevent.eligible30 ? prevent.r30.total_cvd.toFixed(1) + '%' : '—'}</td>
                </tr>
                <tr>
                  <td>Heart Failure (HF)</td>
                  <td class="num mono">${prevent.r10.heart_failure.toFixed(1)}%</td>
                  <td class="num mono">${prevent.eligible30 ? prevent.r30.heart_failure.toFixed(1) + '%' : '—'}</td>
                </tr>
                <tr>
                  <td>Coronary Heart Disease (CHD)</td>
                  <td class="num mono">${prevent.r10.chd.toFixed(1)}%</td>
                  <td class="num mono">${prevent.eligible30 ? prevent.r30.chd.toFixed(1) + '%' : '—'}</td>
                </tr>
                <tr>
                  <td>Stroke</td>
                  <td class="num mono">${prevent.r10.stroke.toFixed(1)}%</td>
                  <td class="num mono">${prevent.eligible30 ? prevent.r30.stroke.toFixed(1) + '%' : '—'}</td>
                </tr>
              </tbody>
            </table>
            ${prevent.notes.length ? `<ul class="note-list">${prevent.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          `}
        </div>

        <div class="submodel-block">
          <div class="submodel-head">
            <div>
              <strong>C. ACC/AHA Legacy Lifetime ASCVD Risk</strong>
              <div class="muted-note">${accLifetime.eligible ? esc(accLifetime.label) + ' (US age-50 risk-factor stratum)' : 'Lloyd-Jones / Berry et al. · Ages 20–59, LDL-C <190 mg/dL'}</div>
            </div>
            <div class="submodel-metric mono">${accLifetime.eligible ? accLifetime.percent + '%' : 'Unavailable'}</div>
          </div>
          ${!accLifetime.eligible ? `<p class="muted-note">${esc(accLifetime.reason)}</p>` : ''}
        </div>
      </article>
    `;
  }

  function renderQRISK3Section(res) {
    const q = res.qrisk3;
    return `
      <article class="protocol-card" data-protocol="qrisk3">
        <div class="protocol-header">
          <div>
            <div class="protocol-kicker">Protocol 3 · QResearch UK 22-Variable Model</div>
            <h3>QRISK3 Protocol Estimates</h3>
          </div>
          <div class="protocol-headline ${q.eligible ? 'tone-' + q.tone : 'tone-neutral'}">
            <div class="headline-value mono">${q.eligible ? q.percent.toFixed(1) + '%' : 'N/A'}</div>
            <div class="headline-sub">${q.eligible ? '10-Yr QRISK3-2017 CVD' : 'Not eligible'}</div>
          </div>
        </div>

        ${!q.eligible ? `<p class="muted-note">${esc(q.reason)}</p>` : `
          <div class="target-grid">
            <div class="target-cell">
              <div class="target-label">QRISK3 10-Year Risk</div>
              <div class="target-val mono">${q.percent.toFixed(1)}%</div>
              <div class="muted-note">${esc(q.category)}</div>
            </div>
            <div class="target-cell">
              <div class="target-label">Healthy Person Baseline</div>
              <div class="target-val mono">${q.healthyPercent.toFixed(1)}%</div>
              <div class="muted-note">Same age, sex, ${esc(q.ethnicityLabel)}</div>
            </div>
            <div class="target-cell">
              <div class="target-label">Relative Risk</div>
              <div class="target-val mono">${q.relativeRisk !== null ? q.relativeRisk.toFixed(1) + '×' : '—'}</div>
              <div class="muted-note">Ratio vs healthy peer</div>
            </div>
          </div>

          <div class="detail-block">
            <div class="detail-title">Active QRISK3 Risk Contributors</div>
            <p class="detail-body">${q.activeFactors.length ? esc(q.activeFactors.join(' · ')) : 'Baseline profile (no elevated QRISK3 comorbidities or smoking documented)'}</p>
          </div>

          ${q.imputations.length ? `
            <div class="detail-block">
              <div class="detail-title">Imputed Optional UK Fields</div>
              <ul class="note-list">${q.imputations.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
            </div>` : ''}

          ${q.notes.length ? `<ul class="note-list">${q.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        `}

        <div class="submodel-block">
          <div class="submodel-head">
            <div>
              <strong>QRISK3-Lifetime CVD Reference (LAI Figure 1 Layer)</strong>
              <div class="muted-note">
                ${q.lifetime
                  ? `Official entered estimate to age ${q.lifetime.endAge}${q.lifetime.percent > 30 ? ' (>30% reclassifies LAI Low risk → Moderate risk)' : q.lifetime.percent < 30 ? ' (<30% supports LAI Low risk band)' : ' (exactly 30% — clinical review)'}`
                  : 'Enter from official <a href="https://qrisk.org/lifetime/" target="_blank" rel="noopener noreferrer">qrisk.org/lifetime/</a> to evaluate LAI Figure 1 lifetime threshold (<30% vs >30%).'}
              </div>
            </div>
            <div class="submodel-metric mono">${q.lifetime ? q.lifetime.percent.toFixed(1) + '%' : 'Not entered'}</div>
          </div>
        </div>
      </article>
    `;
  }

  function renderResults(res, p) {
    lastEvaluation = res;
    lastInput = p;

    if (res.status === 'conflict') {
      resultsEl.innerHTML = `
        <section class="alert-panel alert-danger">
          <h2>Input Conflict — Resolve Before Calculating</h2>
          <ul class="clean-list">${res.conflicts.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        </section>
      `;
      return;
    }

    const severeBpBanner = res.severeBP
      ? `<section class="alert-panel alert-danger">
          <h2>Urgent: Severe Blood Pressure Elevation (${p.sbp}/${p.dbp} mmHg)</h2>
          <p>Assess promptly for acute target-organ injury. If concerning acute symptoms or signs are present, follow the local emergency pathway immediately. Otherwise, repeat blood pressure promptly and arrange urgent clinical review before relying on outpatient risk scores.</p>
        </section>`
      : '';

    const summaryHtml = `
      <section class="summary-strip" aria-label="Calculated Risk Summary Across Protocols">
        <div class="summary-cell">
          <div class="summary-label">LAI 2023 Consensus IV</div>
          <div class="summary-value tone-${res.lai.tone}">${esc(res.lai.tier)}</div>
          <div class="summary-meta mono">LDL target: ${esc(res.lai.targets.ldl)}</div>
        </div>
        <div class="summary-cell">
          <div class="summary-label">ASCVD Protocol</div>
          <div class="summary-value mono">${res.ascvd.pce.eligible ? res.ascvd.pce.percent.toFixed(1) + '%' : res.ascvd.prevent.eligible10 ? res.ascvd.prevent.r10.ascvd.toFixed(1) + '%' : 'N/A'}</div>
          <div class="summary-meta mono">
            PCE 10y: ${res.ascvd.pce.eligible ? res.ascvd.pce.percent.toFixed(1) + '%' : '—'} ·
            PREVENT 10y/30y: ${res.ascvd.prevent.eligible10 ? res.ascvd.prevent.r10.ascvd.toFixed(1) + '%' : '—'}/${res.ascvd.prevent.eligible30 ? res.ascvd.prevent.r30.ascvd.toFixed(1) + '%' : '—'} ·
            Life: ${res.ascvd.accLifetime.eligible ? res.ascvd.accLifetime.percent + '%' : '—'}
          </div>
        </div>
        <div class="summary-cell">
          <div class="summary-label">QRISK3 Protocol</div>
          <div class="summary-value mono">${res.qrisk3.eligible ? res.qrisk3.percent.toFixed(1) + '%' : 'N/A'}</div>
          <div class="summary-meta mono">
            10y CVD${res.qrisk3.eligible ? ' (Peer: ' + res.qrisk3.healthyPercent.toFixed(1) + '%)' : ''} ·
            Lifetime: ${res.qrisk3.lifetime ? res.qrisk3.lifetime.percent.toFixed(1) + '%' : '—'}
          </div>
        </div>
      </section>
    `;

    const tabsHtml = `
      <div class="results-toolbar">
        <div class="segmented-tabs" role="tablist" aria-label="Filter protocol results">
          <button type="button" role="tab" class="seg-btn ${activeResultTab === 'all' ? 'is-active' : ''}" data-tab="all">All Protocols</button>
          <button type="button" role="tab" class="seg-btn ${activeResultTab === 'lai' ? 'is-active' : ''}" data-tab="lai">LAI 2023</button>
          <button type="button" role="tab" class="seg-btn ${activeResultTab === 'ascvd' ? 'is-active' : ''}" data-tab="ascvd">ASCVD</button>
          <button type="button" role="tab" class="seg-btn ${activeResultTab === 'qrisk3' ? 'is-active' : ''}" data-tab="qrisk3">QRISK3</button>
        </div>
        <button type="button" class="btn-ghost" id="print-report-btn">Print Report</button>
      </div>
    `;

    const chartHtml =
      activeResultTab === 'all'
        ? `<section class="chart-card"><div class="detail-title">Cross-Protocol Risk Horizon Comparison</div>${buildComparisonSVG(res)}</section>`
        : '';

    const sectionsHtml =
      (activeResultTab === 'all' || activeResultTab === 'lai' ? renderLAISection(res, p) : '') +
      (activeResultTab === 'all' || activeResultTab === 'ascvd' ? renderASCVDSection(res) : '') +
      (activeResultTab === 'all' || activeResultTab === 'qrisk3' ? renderQRISK3Section(res) : '');

    resultsEl.innerHTML = severeBpBanner + summaryHtml + tabsHtml + chartHtml + sectionsHtml;

    resultsEl.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeResultTab = btn.dataset.tab;
        renderResults(lastEvaluation, lastInput);
      });
    });

    const printBtn = document.getElementById('print-report-btn');
    if (printBtn) {
      printBtn.addEventListener('click', () => window.print());
    }
  }

  function runCalculation(scrollOnMobile) {
    if (!form.checkValidity()) {
      form.reportValidity();
      resultsEl.innerHTML = `
        <section class="alert-panel alert-danger">
          <h2>Check Highlighted Inputs</h2>
          <p>Correct out-of-range numeric values before calculating risk across protocols.</p>
        </section>
      `;
      return;
    }
    const p = collectFormValues();
    const res = window.RiskEngines.evaluateAllProtocols(p, window.PREVENT_COEFFS);
    renderResults(res, p);
    if (scrollOnMobile && window.innerWidth < 1024) {
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Clinical validation presets
  const PRESETS = {
    indianPrimary: {
      age: 42,
      sex: 'male',
      ethnicity: '2',
      pceRace: 'auto',
      heightCm: 172,
      weightKg: 77.5,
      sbp: 128,
      dbp: 78,
      bpTx: 'no',
      statin: 'no',
      tc: 204,
      hdl: 44,
      ldl: 134,
      smokeCat: '1',
      smokelessTobacco: 'no',
      heavySmokingOver1Pack: 'no',
      dmStatus: 'none',
      dmTod: 'no',
      ckdStage: 'none',
      ascvd: 'no',
      egfr: 96,
      hba1c: 5.5,
      uacr: '',
      sdi: '',
      sbpSd: '',
      townsend: '',
      qrFhCvd: true,
      qrAF: false,
      qrMigraine: false,
      qrRA: false,
      qrSLE: false,
      qrSMI: false,
      qrAtypicalAntipsy: false,
      qrSteroids: false,
      qrED: false,
      qrLifetime: 34,
      qrEndAge: 85,
      plaque: 'no',
      fh: 'no',
      recurrent: 'no',
      catC: 'no',
      cac: 0,
      cacPct: '',
      laiFamily: 'yes',
      apoB: 112,
      lpa: 28,
      metSyndrome: 'no',
      nafldFibrosis: 'no',
      fbg: 104,
      waistCm: 93,
      hsCRP: 1.4,
      triglycerides: 162,
      tgState: 'fasting',
      laiInflammatory: false,
      laiFemaleSpecific: false,
      laiHighPRS: false,
      laiAirPollution: true,
      laiHIV: false,
    },
    diabeticMetabolic: {
      age: 56,
      sex: 'female',
      ethnicity: '2',
      pceRace: 'auto',
      heightCm: 158,
      weightKg: 73.5,
      sbp: 142,
      dbp: 86,
      bpTx: 'yes',
      statin: 'no',
      tc: 226,
      hdl: 42,
      ldl: 144,
      smokeCat: '1',
      smokelessTobacco: 'no',
      heavySmokingOver1Pack: 'no',
      dmStatus: 't2',
      dmTod: 'no',
      ckdStage: 'none',
      ascvd: 'no',
      egfr: 74,
      hba1c: 7.6,
      uacr: 48,
      sdi: '',
      sbpSd: 11.2,
      townsend: '',
      qrFhCvd: false,
      qrAF: false,
      qrMigraine: false,
      qrRA: true,
      qrSLE: false,
      qrSMI: false,
      qrAtypicalAntipsy: false,
      qrSteroids: false,
      qrED: false,
      qrLifetime: '',
      qrEndAge: '',
      plaque: 'no',
      fh: 'no',
      recurrent: 'no',
      catC: 'no',
      cac: 45,
      cacPct: '',
      laiFamily: 'no',
      apoB: 136,
      lpa: 58,
      metSyndrome: 'yes',
      nafldFibrosis: 'yes',
      fbg: 138,
      waistCm: 92,
      hsCRP: 3.1,
      triglycerides: 215,
      tgState: 'fasting',
      laiInflammatory: false,
      laiFemaleSpecific: true,
      laiHighPRS: false,
      laiAirPollution: true,
      laiHIV: false,
    },
    secondaryExtreme: {
      age: 61,
      sex: 'male',
      ethnicity: '2',
      pceRace: 'auto',
      heightCm: 170,
      weightKg: 80,
      sbp: 136,
      dbp: 82,
      bpTx: 'yes',
      statin: 'yes',
      tc: 162,
      hdl: 36,
      ldl: 86,
      smokeCat: '2',
      smokelessTobacco: 'no',
      heavySmokingOver1Pack: 'no',
      dmStatus: 't2',
      dmTod: 'yes',
      ckdStage: '3b',
      ascvd: 'yes',
      egfr: 41,
      hba1c: 8.1,
      uacr: 185,
      sdi: '',
      sbpSd: 12.5,
      townsend: '',
      qrFhCvd: true,
      qrAF: true,
      qrMigraine: false,
      qrRA: false,
      qrSLE: false,
      qrSMI: false,
      qrAtypicalAntipsy: false,
      qrSteroids: false,
      qrED: true,
      qrLifetime: '',
      qrEndAge: '',
      plaque: 'yes',
      fh: 'no',
      recurrent: 'yes',
      catC: 'no',
      cac: 410,
      cacPct: '',
      laiFamily: 'yes',
      apoB: 92,
      lpa: 64,
      metSyndrome: 'yes',
      nafldFibrosis: 'no',
      fbg: 148,
      waistCm: 98,
      hsCRP: 2.9,
      triglycerides: 240,
      tgState: 'fasting',
      laiInflammatory: false,
      laiFemaleSpecific: false,
      laiHighPRS: false,
      laiAirPollution: false,
      laiHIV: false,
    },
  };

  function applyPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    form.reset();
    Object.entries(preset).forEach(([name, val]) => {
      const el = form.elements[name];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = Boolean(val);
      else el.value = val;
    });
    updateDerivedReadouts();
    runCalculation(true);
  }

  // Event wiring
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runCalculation(true);
  });

  form.addEventListener('input', updateDerivedReadouts);
  form.addEventListener('change', updateDerivedReadouts);

  form.addEventListener('reset', () => {
    setTimeout(() => {
      updateDerivedReadouts();
      resultsEl.innerHTML = `
        <section class="empty-stage">
          <h2>Ready for Clinical Assessment</h2>
          <p>Enter patient parameters on the left or select a clinical validation preset above, then select <strong>Assess All Risks</strong> to calculate ASCVD (PCE, PREVENT 10-yr &amp; 30-yr, ACC Lifetime), QRISK3 (10-yr &amp; Lifetime), and LAI 2023 Consensus IV results simultaneously.</p>
        </section>
      `;
    }, 0);
  });

  document.getElementById('top-assess-btn').addEventListener('click', () => {
    runCalculation(true);
  });

  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  if (calcEgfrBtn) {
    calcEgfrBtn.addEventListener('click', () => {
      const scr = numVal('scrHelper');
      const age = numVal('age');
      const sex = strVal('sex');
      const egfr = window.RiskEngines.calcCKDEPI2021(scr, age, sex);
      if (egfr === null) {
        egfrHelperNote.textContent = 'Enter Age, Sex, and Serum Creatinine (mg/dL) first.';
        return;
      }
      form.elements.egfr.value = egfr;
      egfrHelperNote.textContent = `CKD-EPI 2021 calculated eGFR: ${egfr} mL/min/1.73m²`;
      updateDerivedReadouts();
    });
  }

  // Load the primary prevention preset on first load so the clinician immediately sees all 3 protocols in action
  applyPreset('indianPrimary');
})();
