import { useState, useMemo } from "react";
import { jsPDF } from "jspdf";

const C = {
  bg: "#F5F0E8", surface: "#FFFFFF", panel: "#FAF7F2", border: "#D4C8B0",
  gold: "#C49A22", goldLight: "#F0D87A", goldDark: "#8A6A0A",
  red: "#8B2A1A", redLight: "#C4442A", earth: "#4A3728",
  text: "#2C1F14", textMuted: "#7A6A58",
  success: "#2A6B3C", successBg: "#E8F5EC", warn: "#7A4A0A", warnBg: "#FDF3E0",
};

const BF = {
  redevanceRate: 0.08, fmdRate: 0.01,
  taxeSuperfY1: 1500000 / 565.5, taxeSuperfRenew: 3000000 / 565.5,
  permisOctroi: 7000000 / 565.5, discountRate: 0.10,
  reservePriceFactor: 0.778, cfaToUsd: 565.5, ozToG: 31.1035,
  miningCostPerTonne: 26, processingCostPerTonne: 38.5, sustainCapCostPerTonne: 5.5,
};

const PHASE_DEFS = [
  { key: "phase1", label: "Phase 1", color: C.red },
  { key: "phase2", label: "Phase 2", color: C.gold },
  { key: "phase3", label: "Phase 3", color: C.success },
];

const emptyPhaseInputs = () => ({
  depositName: "", tonnes: "", grade: "", depth: "", oreType: "oxide",
  capacityTPD: "", recovery: "", permitAreaKm2: "", goldPrice: "", useReservePrice: true,
});

function estimateCapex(capacityTPD, pitDepth) {
  const s = capacityTPD / 250;
  const ds = Math.min(pitDepth / 50, 2);
  return {
    mine: Math.round((60000 + 50000 + 100000) * 1.8 * s * ds),
    crushing: Math.round(57800 * s),
    grinding: Math.round(41840 * s),
    cil: Math.round(129600 * s),
    vehicles: Math.round(120000 * s),
    energy: Math.round(49600 * s),
    lighting: Math.round(8680),
    water: Math.round(23000),
    infrastructure: Math.round(110000 * Math.pow(s, 0.6)),
    elution: Math.round(9000 * s),
    tooling: Math.round(750),
    ppe: Math.round(7605 * s),
    permis: Math.round(BF.permisOctroi),
    nies: 15000,
  };
}

function estimateOpex(capacityTPD, headcountScale) {
  const s = capacityTPD / 250;
  const reagents = 20185 * s;
  const fuel = 43626 * s;
  const salaries = 31343.26 * Math.pow(s * headcountScale, 0.75);
  const maintenance = 18000 * s;
  const food = 9000 * Math.pow(s, 0.6);
  const other = 5200 * Math.pow(s, 0.5);
  const subtotal = reagents + fuel + salaries + maintenance + food + other;
  return {
    reagents: Math.round(reagents), fuel: Math.round(fuel), salaries: Math.round(salaries),
    maintenance: Math.round(maintenance), food: Math.round(food), other: Math.round(other),
    contingency: Math.round(subtotal * 0.1), total: Math.round(subtotal * 1.1),
  };
}

function calcFinancials({ capexTotal, opexMonthly, capacityTPD, grade, recovery, goldPriceUSD, permitAreaKm2 }) {
  const goldPerG = goldPriceUSD / BF.ozToG;
  const monthlyOre = capacityTPD * 30;
  const goldRecoveredMonthly = monthlyOre * grade * recovery;
  const revenueMonthly = goldRecoveredMonthly * goldPerG;
  const redevance = revenueMonthly * BF.redevanceRate;
  const fmd = revenueMonthly * BF.fmdRate;
  const taxeY1 = BF.taxeSuperfY1 * permitAreaKm2;
  const taxeRenew = BF.taxeSuperfRenew * permitAreaKm2;
  const cashflowBrut = revenueMonthly - opexMonthly;
  const cashflowNetY1 = (cashflowBrut - redevance - fmd - taxeY1 / 12) * 12;
  const cashflowNetY2 = (cashflowBrut - redevance - fmd - taxeRenew / 12) * 12;
  const cf = [cashflowNetY1, cashflowNetY2, cashflowNetY2];
  const van = cf.reduce((acc, c, i) => acc + c / Math.pow(1 + BF.discountRate, i + 1), -capexTotal);

  const goldPriceConserv = goldPriceUSD * 0.5;
  const goldPerGConserv = goldPriceConserv / BF.ozToG;
  const revenueConserv = goldRecoveredMonthly * goldPerGConserv;
  const redevConserv = revenueConserv * BF.redevanceRate;
  const fmdConserv = revenueConserv * BF.fmdRate;
  const cashBrutConserv = revenueConserv - opexMonthly;
  const cfNetConservY1 = (cashBrutConserv - redevConserv - fmdConserv - taxeY1 / 12) * 12;
  const cfNetConservY2 = (cashBrutConserv - redevConserv - fmdConserv - taxeRenew / 12) * 12;
  const vanConserv = [cfNetConservY1, cfNetConservY2, cfNetConservY2].reduce(
    (acc, c, i) => acc + c / Math.pow(1 + BF.discountRate, i + 1), -capexTotal
  );

  const paybackMonths = revenueMonthly > opexMonthly
    ? Math.ceil(capexTotal / (cashflowBrut * 12) * 12)
    : null;

  return {
    goldPerG, monthlyOre, goldRecoveredMonthly, revenueMonthly, redevance, fmd,
    cashflowBrut, cashflowNetY1, cashflowNetY2, van, vanConserv, paybackMonths,
    revenueAnnual: revenueMonthly * 12,
    costPerTonne: opexMonthly / monthlyOre,
    marginPerTonne: (revenueMonthly - opexMonthly) / monthlyOre,
  };
}

function calcCutoffGrade(goldPriceUSD) {
  const totalCostPerTonne = BF.miningCostPerTonne + BF.processingCostPerTonne + BF.sustainCapCostPerTonne;
  const goldPerG = goldPriceUSD / BF.ozToG;
  const cog = totalCostPerTonne / goldPerG;
  return { cog: Math.ceil(cog * 100) / 100, recommended: Math.ceil(cog * 100 + 5) / 100, totalCostPerTonne };
}

function calcSensitivityGrid({ capacityTPD, oreDepth, recovery, permitAreaKm2, centerGoldPrice, centerGrade }) {
  const goldFactors = [0.5, 0.75, 1.0, 1.25, 1.5];
  const gradeFactors = [0.7, 0.85, 1.0, 1.15, 1.3];
  const capacityFactors = [0.6, 1.0, 1.6];
  const goldPrices = goldFactors.map(f => centerGoldPrice * f);
  const grades = gradeFactors.map(f => centerGrade * f);

  const capacityLevels = capacityFactors.map(cf => {
    const capacity = capacityTPD * cf;
    const capex = estimateCapex(capacity, oreDepth);
    const capexTotal = Object.values(capex).reduce((a, b) => a + b, 0);
    const opex = estimateOpex(capacity, 1);
    const grid = grades.map(grade =>
      goldPrices.map(goldPriceUSD => {
        const fin = calcFinancials({ capexTotal, opexMonthly: opex.total, capacityTPD: capacity, grade, recovery, goldPriceUSD, permitAreaKm2 });
        return fin.van;
      })
    );
    return { capacity, capacityFactor: cf, capexTotal, opexMonthly: opex.total, grid };
  });

  return { goldPrices, grades, capacityLevels, baseCapacityIndex: 1 };
}

function computePhase(inputs) {
  const tonnes = parseFloat(inputs.tonnes) || 0;
  const grade = parseFloat(inputs.grade) || 0;
  const depth = parseFloat(inputs.depth) || 0;
  const capacityTPD = parseFloat(inputs.capacityTPD) || 0;
  const recovery = (parseFloat(inputs.recovery) || 0) / 100;
  const permitAreaKm2 = parseFloat(inputs.permitAreaKm2) || 0;
  const goldPrice = parseFloat(inputs.goldPrice) || 0;
  const effectiveGold = inputs.useReservePrice ? goldPrice * BF.reservePriceFactor : goldPrice;

  const capex = estimateCapex(capacityTPD, depth);
  const capexTotal = Object.values(capex).reduce((a, b) => a + b, 0);
  const opex = estimateOpex(capacityTPD, 1);
  const cog = calcCutoffGrade(effectiveGold);
  const fin = calcFinancials({ capexTotal, opexMonthly: opex.total, capacityTPD, grade, recovery, goldPriceUSD: effectiveGold, permitAreaKm2 });
  const sensitivity = calcSensitivityGrid({ capacityTPD, oreDepth: depth, recovery, permitAreaKm2, centerGoldPrice: effectiveGold, centerGrade: grade });
  const durationMonths = capacityTPD > 0 ? Math.ceil(tonnes / (capacityTPD * 30)) : 0;

  return { tonnes, grade, depth, capacityTPD, recovery, permitAreaKm2, goldPrice, effectiveGold, useReservePrice: inputs.useReservePrice, capex, capexTotal, opex, cog, fin, sensitivity, durationMonths };
}

function isPhaseFilled(inputs) {
  return inputs.tonnes && inputs.grade && inputs.capacityTPD && inputs.recovery && inputs.permitAreaKm2 && inputs.goldPrice;
}

const fmt = (n, dec = 0) => n == null || Number.isNaN(n) ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtUSD = (n) => `$${fmt(n)}`;
const fmtK = (n) => Math.abs(n) >= 1e6 ? `${n < 0 ? "-" : ""}$${fmt(Math.abs(n) / 1e6, 2)}M` : `${n < 0 ? "-" : ""}$${fmt(Math.abs(n) / 1e3, 1)}k`;

const Label = ({ children }) => (
  <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted, marginBottom: 4 }}>{children}</label>
);

const Input = ({ label, value, onChange, type = "number", unit, hint, placeholder, step }) => (
  <div style={{ marginBottom: 16 }}>
    <Label>{label}</Label>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input type={type} value={value} step={step || "any"} placeholder={placeholder} onChange={e => onChange(e.target.value)}
        style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: `1.5px solid ${C.border}`, background: C.surface, fontSize: 14, color: C.text, outline: "none", fontFamily: "inherit" }} />
      {unit && <span style={{ fontSize: 12, color: C.textMuted, whiteSpace: "nowrap" }}>{unit}</span>}
    </div>
    {hint && <p style={{ margin: "4px 0 0", fontSize: 11, color: C.textMuted }}>{hint}</p>}
  </div>
);

const Select = ({ label, value, onChange, options, hint }) => (
  <div style={{ marginBottom: 16 }}>
    <Label>{label}</Label>
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: `1.5px solid ${C.border}`, background: C.surface, fontSize: 14, color: C.text, outline: "none", fontFamily: "inherit" }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    {hint && <p style={{ margin: "4px 0 0", fontSize: 11, color: C.textMuted }}>{hint}</p>}
  </div>
);

const Card = ({ title, accent, children, style = {} }) => (
  <div style={{ background: C.surface, borderRadius: 10, border: `1.5px solid ${C.border}`, borderTop: `3px solid ${accent || C.gold}`, padding: "20px 24px", marginBottom: 20, ...style }}>
    {title && <h3 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: accent || C.goldDark }}>{title}</h3>}
    {children}
  </div>
);

const MetricRow = ({ label, value, sub, highlight }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
    <span style={{ fontSize: 13, color: C.textMuted }}>{label}</span>
    <div style={{ textAlign: "right" }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: highlight || C.text }}>{value}</span>
      {sub && <span style={{ display: "block", fontSize: 11, color: C.textMuted }}>{sub}</span>}
    </div>
  </div>
);

const SectionTitle = ({ n, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "32px 0 16px" }}>
    <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.red, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{n}</div>
    <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.earth, letterSpacing: "0.04em" }}>{children}</h2>
  </div>
);

const VanBar = ({ label, van, maxAbs }) => {
  const positive = van >= 0;
  const w = maxAbs > 0 ? Math.min(Math.abs(van) / maxAbs * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: C.textMuted }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: positive ? C.success : C.red }}>{fmtK(van)}</span>
      </div>
      <div style={{ background: C.border, borderRadius: 4, height: 8 }}>
        <div style={{ width: `${w}%`, height: 8, borderRadius: 4, background: positive ? C.success : C.redLight }} />
      </div>
    </div>
  );
};

const SensCell = ({ van, isCenter }) => {
  const positive = van >= 0;
  const intensity = Math.min(Math.abs(van) / 400000, 1);
  const bg = positive ? `rgba(42,107,60,${0.08 + intensity * 0.3})` : `rgba(196,68,42,${0.08 + intensity * 0.3})`;
  return (
    <div style={{ padding: "8px 4px", textAlign: "center", borderRadius: 5, background: bg, border: isCenter ? `2px solid ${C.goldDark}` : `1px solid ${C.border}`, fontSize: 11, fontWeight: isCenter ? 800 : 600, color: positive ? C.success : C.red }}>
      {fmtK(van)}
    </div>
  );
};

async function generatePdfReport({ phases, consolidated }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 48;
  let y = 0;

  const colors = { earth: [74, 55, 40], red: [139, 42, 26], gold: [138, 106, 10], success: [42, 107, 60], muted: [122, 106, 88], text: [44, 31, 20], border: [212, 200, 176] };

  const checkPageBreak = (needed = 60) => { if (y > doc.internal.pageSize.getHeight() - needed) { doc.addPage(); y = 56; } };

  const drawHeaderBand = (title, subtitle) => {
    doc.setFillColor(...colors.earth);
    doc.rect(0, 0, pageW, 86, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(17);
    doc.text(title, marginX, 40);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(subtitle, marginX, 60);
    doc.setFontSize(8); doc.setTextColor(220, 210, 195);
    doc.text("Burkina Faso - Code Minier 2024", marginX, 75);
    y = 110;
  };

  const sectionTitle = (txt, color = colors.gold) => {
    checkPageBreak(50);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...color);
    doc.text(txt.toUpperCase(), marginX, y);
    doc.setDrawColor(...colors.border);
    doc.line(marginX, y + 5, pageW - marginX, y + 5);
    y += 22;
  };

  const row = (label, value, sub) => {
    checkPageBreak(28);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...colors.muted);
    doc.text(label, marginX, y);
    doc.setFont("helvetica", "bold"); doc.setTextColor(...colors.text);
    const valW = doc.getTextWidth(String(value));
    doc.text(String(value), pageW - marginX - valW, y);
    y += 14;
    if (sub) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...colors.muted);
      const subW = doc.getTextWidth(sub);
      doc.text(sub, pageW - marginX - subW, y);
      y += 12;
    }
    doc.setDrawColor(...colors.border);
    doc.line(marginX, y - 2, pageW - marginX, y - 2);
    y += 6;
  };

  const totalRow = (label, value, color = colors.text) => {
    checkPageBreak(28);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...color);
    doc.text(label, marginX, y);
    const valW = doc.getTextWidth(String(value));
    doc.text(String(value), pageW - marginX - valW, y);
    y += 18;
  };

  const paragraph = (txt, size = 8.5, color = colors.muted) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(txt, pageW - marginX * 2);
    lines.forEach(line => { checkPageBreak(20); doc.text(line, marginX, y); y += size + 3; });
    y += 6;
  };

  const kpiGrid = (kpis) => {
    const boxW = (pageW - marginX * 2 - 12) / 2;
    const boxH = 50;
    kpis.forEach((k, i) => {
      const col = i % 2, rowI = Math.floor(i / 2);
      const bx = marginX + col * (boxW + 12);
      const by = y + rowI * (boxH + 10);
      doc.setDrawColor(...colors.border); doc.setFillColor(250, 247, 242);
      doc.roundedRect(bx, by, boxW, boxH, 4, 4, "FD");
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...colors.muted);
      doc.text(k.label.toUpperCase(), bx + 10, by + 16);
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...k.color);
      doc.text(k.value, bx + 10, by + 36);
    });
    y += Math.ceil(kpis.length / 2) * (boxH + 10) + 10;
  };

  drawHeaderBand("Rapport d'Investissement Progressif", `${phases.length} phase(s) renseignee(s)`);

  sectionTitle("Resume Consolide - Toutes Phases", colors.red);
  kpiGrid([
    { label: "CAPEX Cumule", value: fmtK(consolidated.capexTotal), color: colors.red },
    { label: "OPEX Mensuel Cumule", value: fmtK(consolidated.opexTotal), color: colors.earth },
    { label: "VAN Cumulee (Base)", value: fmtK(consolidated.vanTotal), color: consolidated.vanTotal > 0 ? colors.success : colors.red },
    { label: "Duree Totale", value: `${consolidated.durationMonths} mois`, color: colors.gold },
  ]);

  phases.forEach((p) => {
    const { capex, capexTotal, opex, cog, fin, sensitivity, durationMonths } = p.results;
    doc.addPage(); y = 56;
    const titleColor = p.color === C.red ? colors.red : p.color === C.gold ? colors.gold : colors.success;
    sectionTitle(`${p.label}${p.depositName ? " - " + p.depositName : ""}`, titleColor);

    row("Tonnage", `${fmt(p.results.tonnes)} t`);
    row("Teneur moyenne", `${p.results.grade} g/t Au`);
    row("Capacite de traitement", `${fmt(p.results.capacityTPD)} t/j`);
    row("Recuperation metallurgique", `${(p.results.recovery * 100).toFixed(0)}%`);
    row("Prix de l'or utilise", `${fmtUSD(Math.round(p.results.effectiveGold))}/oz`);
    row("Duree d'exploitation estimee", `${durationMonths} mois`);

    y += 6;
    kpiGrid([
      { label: "CAPEX", value: fmtK(capexTotal), color: colors.red },
      { label: "OPEX / mois", value: fmtK(opex.total), color: colors.earth },
      { label: "VAN (Base)", value: fmtK(fin.van), color: fin.van > 0 ? colors.success : colors.red },
      { label: "VAN (Conservateur)", value: fmtK(fin.vanConserv), color: fin.vanConserv > 0 ? colors.success : colors.red },
    ]);

    sectionTitle("Teneur de Coupure", colors.gold);
    row("Cout de production total", `$${cog.totalCostPerTonne}/t`);
    row("Teneur de coupure calculee", `${cog.cog} g/t`);
    row("Teneur de coupure retenue (prudente)", `${cog.recommended} g/t`);

    sectionTitle("CAPEX Detaille", colors.red);
    [
      ["Mine (engins + camions)", capex.mine], ["Concassage", capex.crushing],
      ["Broyage", capex.grinding], ["Lixiviation CIL", capex.cil],
      ["Vehicules de service", capex.vehicles], ["Energie", capex.energy],
      ["Eclairage", capex.lighting], ["Alimentation en eau", capex.water],
      ["Infrastructures", capex.infrastructure], ["Elution / Fonderie", capex.elution],
      ["EPI / Securite", capex.ppe], ["Permis d'exploitation", capex.permis],
      ["NIES (estimation)", capex.nies],
    ].forEach(([l, v]) => row(l, fmtUSD(v)));
    totalRow("TOTAL CAPEX", fmtUSD(capexTotal), colors.red);

    sectionTitle("OPEX Mensuel Detaille", colors.earth);
    [
      ["Reactifs", opex.reagents], ["Carburant", opex.fuel], ["Masse salariale", opex.salaries],
      ["Maintenance & explosifs", opex.maintenance], ["Alimentation personnel", opex.food],
      ["Autres charges", opex.other], ["Imprevus (10%)", opex.contingency],
    ].forEach(([l, v]) => row(l, fmtUSD(v)));
    totalRow("TOTAL OPEX / mois", fmtUSD(opex.total), colors.earth);

    sectionTitle("Revenus & VAN", colors.success);
    row("Chiffre d'affaires mensuel", fmtUSD(Math.round(fin.revenueMonthly)));
    row("Benefice brut mensuel", fmtUSD(Math.round(fin.cashflowBrut)));
    row("VAN scenario de base", fmtK(fin.van));
    row("VAN scenario conservateur (-50% prix or)", fmtK(fin.vanConserv));
    if (fin.paybackMonths) row("Periode de remboursement estimee", `${fin.paybackMonths} mois`);

    y += 8;
    sectionTitle("Analyse de Sensibilite - VAN (Prix x Teneur x Capacite)", colors.red);
    const nCols = sensitivity.goldPrices.length;
    const tableW = pageW - marginX * 2;
    const firstColW = 64;
    const cellW = (tableW - firstColW) / nCols;
    const cellH = 22;
    const capacityLabels = ["Capacite faible", "Capacite de base", "Capacite elevee"];

    sensitivity.capacityLevels.forEach((lvl, levelIdx) => {
      const isBaseCapacity = levelIdx === sensitivity.baseCapacityIndex;
      checkPageBreak(cellH * (sensitivity.grades.length + 1) + 50);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
      doc.setTextColor(...(isBaseCapacity ? colors.gold : colors.text));
      doc.text(`${capacityLabels[levelIdx]} - ${fmt(Math.round(lvl.capacity))} t/j`, marginX, y);
      y += 14;

      doc.setFillColor(74, 55, 40);
      doc.rect(marginX, y, tableW, cellH, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255);
      doc.text("Teneur / Or", marginX + 6, y + cellH / 2 + 3);
      sensitivity.goldPrices.forEach((gp, i) => {
        const cx = marginX + firstColW + i * cellW + cellW / 2;
        const txt = `$${fmt(Math.round(gp))}`;
        doc.text(txt, cx - doc.getTextWidth(txt) / 2, y + cellH / 2 + 3);
      });
      y += cellH;

      sensitivity.grades.forEach((grade, ri) => {
        checkPageBreak(cellH + 10);
        doc.setFillColor(250, 247, 242); doc.setDrawColor(...colors.border);
        doc.rect(marginX, y, firstColW, cellH, "FD");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...colors.text);
        doc.text(`${grade.toFixed(2)} g/t`, marginX + 6, y + cellH / 2 + 3);

        lvl.grid[ri].forEach((van, ci) => {
          const cx = marginX + firstColW + ci * cellW;
          const isCenter = isBaseCapacity && ri === 2 && ci === 2;
          const positive = van >= 0;
          const intensity = Math.min(Math.abs(van) / 400000, 1);
          if (positive) doc.setFillColor(232 - intensity * 60, 245 - intensity * 40, 236 - intensity * 50);
          else doc.setFillColor(252 - intensity * 30, 225 - intensity * 60, 215 - intensity * 70);
          doc.setDrawColor(...(isCenter ? colors.gold : colors.border));
          doc.setLineWidth(isCenter ? 1.2 : 0.5);
          doc.rect(cx, y, cellW, cellH, "FD");
          doc.setLineWidth(0.5);
          doc.setFont("helvetica", isCenter ? "bold" : "normal"); doc.setFontSize(7.5);
          doc.setTextColor(...(positive ? colors.success : colors.red));
          const txt = fmtK(van);
          doc.text(txt, cx + cellW / 2 - doc.getTextWidth(txt) / 2, y + cellH / 2 + 3);
        });
        y += cellH;
      });
      y += 16;
    });
  });

  doc.addPage(); y = 56;
  doc.setDrawColor(...colors.border);
  doc.line(marginX, y, pageW - marginX, y);
  y += 16;
  paragraph("Ce travail est base sur le modele d'investissement progressif de Lankoande (2025).", 9, colors.muted);

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...colors.muted);
    doc.text(`${i} / ${pageCount}`, pageW - marginX - 20, doc.internal.pageSize.getHeight() - 24);
    doc.text("Rapport d'Investissement Progressif", marginX, doc.internal.pageSize.getHeight() - 24);
  }

  doc.save("rapport_investissement_progressif.pdf");
}

function PhaseForm({ phaseLabel, inputs, onChange }) {
  return (
    <div>
      <SectionTitle n="A">Gisement - {phaseLabel}</SectionTitle>
      <Card>
        <Input label="Nom du gisement / permis (optionnel)" value={inputs.depositName} onChange={v => onChange({ ...inputs, depositName: v })} type="text" placeholder="Ex : Bloc Nord" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Input label="Tonnage de minerai" value={inputs.tonnes} onChange={v => onChange({ ...inputs, tonnes: v })} unit="tonnes" hint="Ressources indiquees ou mesurees" placeholder="Ex : 250000" />
          <Input label="Teneur moyenne" value={inputs.grade} onChange={v => onChange({ ...inputs, grade: v })} step={0.01} unit="g/t Au" hint="Au-dessus de la teneur de coupure" placeholder="Ex : 1.2" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Input label="Profondeur de la mineralisation" value={inputs.depth} onChange={v => onChange({ ...inputs, depth: v })} unit="m" hint="Profondeur max de la fosse" placeholder="Ex : 50" />
          <Select label="Type de minerai dominant" value={inputs.oreType} onChange={v => onChange({ ...inputs, oreType: v })}
            options={[
              { value: "oxide", label: "Oxyde (Laterite / Saprolite)" },
              { value: "transition", label: "Transition" },
              { value: "fresh", label: "Roche fraiche" },
              { value: "mixed", label: "Mixte" },
            ]} hint="Influence la densite et la recuperation" />
        </div>
      </Card>

      <SectionTitle n="B">Parametres d'Exploitation - {phaseLabel}</SectionTitle>
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Input label="Capacite de traitement" value={inputs.capacityTPD} onChange={v => onChange({ ...inputs, capacityTPD: v })} unit="t/j" hint="Recommande : 100-500 t/j pour semi-mecanise" placeholder="Ex : 250" />
          <Input label="Taux de recuperation metallurgique" value={inputs.recovery} onChange={v => onChange({ ...inputs, recovery: v })} unit="%" step={0.5} hint="CIL : 85-93% typique" placeholder="Ex : 90" />
        </div>
        <Input label="Superficie du permis" value={inputs.permitAreaKm2} onChange={v => onChange({ ...inputs, permitAreaKm2: v })} unit="km2" step={0.1} hint="Maximum legal : 1,5 km2 (Code Minier 2024, art. 78)" placeholder="Ex : 1.0" />
      </Card>

      <SectionTitle n="C">Prix de l'Or - {phaseLabel}</SectionTitle>
      <Card>
        <Input label="Cours spot de l'or (marche)" value={inputs.goldPrice} onChange={v => onChange({ ...inputs, goldPrice: v })} unit="USD/oz" placeholder="Ex : 4500" />
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, background: inputs.useReservePrice ? C.warnBg : C.panel, border: `1px solid ${inputs.useReservePrice ? C.warn + "44" : C.border}`, borderRadius: 8, padding: 14, cursor: "pointer" }}
          onClick={() => onChange({ ...inputs, useReservePrice: !inputs.useReservePrice })}>
          <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${C.gold}`, background: inputs.useReservePrice ? C.gold : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {inputs.useReservePrice && <span style={{ color: "#fff", fontSize: 12, fontWeight: 900 }}>OK</span>}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.earth, marginBottom: 2 }}>Appliquer la methode du prix de reserve (-22,2%)</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>Recommande pour stress-test et classification des ressources</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PhaseResults({ results, sensCapacityIdx, setSensCapacityIdx }) {
  const { capex, capexTotal, opex, cog, fin, sensitivity, durationMonths, tonnes, grade, recovery, capacityTPD, effectiveGold, useReservePrice, permitAreaKm2 } = results;
  const maxVan = Math.max(Math.abs(fin.van), Math.abs(fin.vanConserv));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          { label: "CAPEX Total", value: fmtK(capexTotal), color: C.red },
          { label: "OPEX Mensuel", value: fmtK(opex.total), color: C.earth },
          { label: "VAN (Base)", value: fmtK(fin.van), color: fin.van > 0 ? C.success : C.red },
          { label: "VAN (Conservateur)", value: fmtK(fin.vanConserv), color: fin.vanConserv > 0 ? C.success : C.red },
        ].map(k => (
          <div key={k.label} style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderTop: `3px solid ${k.color}`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <Card title="Teneur de Coupure Calculee" accent={C.goldDark}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 8 }}>
          {[
            { label: "Cout de production total", value: `$${cog.totalCostPerTonne}/t` },
            { label: "Teneur de coupure calculee", value: `${cog.cog} g/t` },
            { label: "Teneur retenue (prudente)", value: `${cog.recommended} g/t` },
          ].map(m => (
            <div key={m.label} style={{ textAlign: "center", padding: "12px 8px", background: C.panel, borderRadius: 8 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: C.goldDark }}>{m.value}</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{m.label}</div>
            </div>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
          Prix de reserve utilise : <strong>{fmtUSD(Math.round(effectiveGold))} USD/oz</strong> ({useReservePrice ? "-22,2% du cours spot" : "cours spot direct"})
        </p>
      </Card>

      <Card title="Contenu Metallique" accent={C.gold}>
        <MetricRow label="Tonnage" value={`${fmt(tonnes)} t`} />
        <MetricRow label="Teneur moyenne" value={`${grade} g/t Au`} />
        <MetricRow label="Or contenu" value={`${fmt(tonnes * grade, 0)} g`} sub={`${fmt(tonnes * grade / BF.ozToG, 0)} oz`} />
        <MetricRow label={`Or recuperable (x${(recovery * 100).toFixed(0)}%)`} value={`${fmt(tonnes * grade * recovery, 0)} g`} sub={`${fmt(tonnes * grade * recovery / BF.ozToG, 0)} oz`} highlight={C.success} />
        <MetricRow label="Duree d'exploitation estimee" value={`${durationMonths} mois`} sub={`Base: ${fmt(capacityTPD)} t/j`} />
      </Card>

      <Card title="Couts d'Investissement (CAPEX)" accent={C.red}>
        {[
          ["Mine (engins + camions)", capex.mine], ["Concassage", capex.crushing],
          ["Broyage", capex.grinding], ["Lixiviation CIL", capex.cil],
          ["Vehicules de service", capex.vehicles], ["Energie (groupes electrogenes)", capex.energy],
          ["Eclairage", capex.lighting], ["Alimentation en eau", capex.water],
          ["Infrastructures (base vie, routes)", capex.infrastructure], ["Elution / Fonderie", capex.elution],
          ["EPI / Securite", capex.ppe], ["Permis d'exploitation (octroi)", capex.permis],
          ["NIES (estimation)", capex.nies],
        ].map(([l, v]) => <MetricRow key={l} label={l} value={fmtUSD(v)} />)}
        <MetricRow label="TOTAL CAPEX" value={fmtUSD(capexTotal)} highlight={C.red} />
      </Card>

      <Card title="Couts d'Exploitation Mensuels (OPEX)" accent={C.earth}>
        {[
          ["Reactifs (NaCN, CaO, charbon)", opex.reagents], ["Carburant", opex.fuel],
          ["Masse salariale", opex.salaries], ["Maintenance & explosifs", opex.maintenance],
          ["Alimentation personnel", opex.food], ["Autres charges", opex.other],
          ["Imprevus (10%)", opex.contingency],
        ].map(([l, v]) => <MetricRow key={l} label={l} value={fmtUSD(v)} />)}
        <MetricRow label="TOTAL OPEX / mois" value={fmtUSD(opex.total)} highlight={C.earth} />
        <MetricRow label="Cout de production unitaire" value={`${fin.costPerTonne.toFixed(1)} USD/t`} />
      </Card>

      <Card title="Revenus & Marges Mensuels" accent={C.success}>
        <MetricRow label="Prix de l'or utilise" value={`${fmtUSD(Math.round(effectiveGold))}/oz`} sub={useReservePrice ? "Prix de reserve (-22,2%)" : "Cours spot"} />
        <MetricRow label="Or recupere/mois" value={`${fmt(fin.goldRecoveredMonthly, 0)} g`} sub={`${fmt(fin.goldRecoveredMonthly / BF.ozToG, 1)} oz`} />
        <MetricRow label="Chiffre d'affaires mensuel" value={fmtUSD(Math.round(fin.revenueMonthly))} />
        <MetricRow label="OPEX mensuel" value={`(${fmtUSD(opex.total)})`} />
        <MetricRow label="Benefice brut mensuel" value={fmtUSD(Math.round(fin.cashflowBrut))} highlight={fin.cashflowBrut > 0 ? C.success : C.red} />
        <MetricRow label="Valeur par tonne de minerai" value={`${fin.marginPerTonne.toFixed(1)} USD/t`} highlight={fin.marginPerTonne > 0 ? C.success : C.red} />
      </Card>

      <Card title="Fiscalite Miniere - Burkina Faso (Code Minier 2024)" accent={C.goldDark}>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
          Appliquee au CA mensuel de <strong>{fmtUSD(Math.round(fin.revenueMonthly))}</strong>
        </div>
        <MetricRow label="Redevance proportionnelle (8% - or >= 3 500 USD/oz)" value={`${fmtUSD(Math.round(fin.redevance))}/mois`} />
        <MetricRow label="Fonds Minier de Developpement (1% CA)" value={`${fmtUSD(Math.round(fin.fmd))}/mois`} />
        <MetricRow label={`Taxe superficiere (${permitAreaKm2} km2)`} value={`${fmtUSD(Math.round(BF.taxeSuperfY1 * permitAreaKm2))}/an (A1)`} sub={`${fmtUSD(Math.round(BF.taxeSuperfRenew * permitAreaKm2))}/an (A2+)`} />
        <MetricRow label="Permis d'exploitation (octroi unique)" value={fmtUSD(Math.round(BF.permisOctroi))} />
        <div style={{ marginTop: 12, padding: 10, background: C.warnBg, borderRadius: 8, fontSize: 12, color: C.warn }}>
          Paiement des redevances : delai 21 jours apres pesee. Penalite : 10%/jour de retard.
        </div>
      </Card>

      <Card title="Valeur Actuelle Nette - 3 ans (taux 10%)" accent={C.goldDark}>
        <VanBar label={`Scenario base (${fmtUSD(Math.round(effectiveGold))}/oz)`} van={fin.van} maxAbs={maxVan} />
        <VanBar label={`Scenario conservateur (${fmtUSD(Math.round(effectiveGold * 0.5))}/oz - -50%)`} van={fin.vanConserv} maxAbs={maxVan} />
        {fin.paybackMonths && (
          <div style={{ marginTop: 16, padding: 12, background: C.successBg, borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 2 }}>Periode de remboursement estimee</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.success }}>{fin.paybackMonths} mois</div>
          </div>
        )}
        <div style={{ marginTop: 12, fontSize: 12, color: C.textMuted }}>
          Flux nets incluent les redevances, FMD et taxes superficieres. CAPEX initial = {fmtK(capexTotal)}.
        </div>
      </Card>

      <Card title="Analyse de Sensibilite - VAN (Prix de l'Or x Teneur)" accent={C.red}>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: C.textMuted }}>
          Lignes : teneur (g/t Au) - Colonnes : prix de l'or (USD/oz). La cellule entouree en or est le scenario de base actuel.
        </p>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {sensitivity.capacityLevels.map((lvl, idx) => {
            const isActive = idx === sensCapacityIdx;
            const isBase = idx === sensitivity.baseCapacityIndex;
            return (
              <button key={idx} onClick={() => setSensCapacityIdx(idx)}
                style={{ flex: 1, padding: "8px 6px", borderRadius: 7, border: isActive ? `2px solid ${C.goldDark}` : `1.5px solid ${C.border}`, background: isActive ? C.goldLight + "33" : C.panel, cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: isActive ? C.goldDark : C.text }}>{fmt(Math.round(lvl.capacity))} t/j</div>
                <div style={{ fontSize: 9.5, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {idx === 0 ? "Capacite faible" : idx === 2 ? "Capacite elevee" : "Capacite base"}{isBase ? " (actif)" : ""}
                </div>
              </button>
            );
          })}
        </div>
        {(() => {
          const lvl = sensitivity.capacityLevels[sensCapacityIdx];
          const isBaseCapacity = sensCapacityIdx === sensitivity.baseCapacityIndex;
          return (
            <>
              <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 11, color: C.textMuted }}>
                <span>CAPEX : <strong style={{ color: C.text }}>{fmtK(lvl.capexTotal)}</strong></span>
                <span>OPEX/mois : <strong style={{ color: C.text }}>{fmtK(lvl.opexMonthly)}</strong></span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: `64px repeat(${sensitivity.goldPrices.length}, 1fr)`, gap: 4, minWidth: 480 }}>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 700, display: "flex", alignItems: "center" }}>g/t / $/oz</div>
                  {sensitivity.goldPrices.map((gp, i) => (
                    <div key={i} style={{ fontSize: 10, fontWeight: 700, color: C.earth, textAlign: "center", padding: "6px 2px", background: C.panel, borderRadius: 5 }}>{fmtUSD(Math.round(gp))}</div>
                  ))}
                  {sensitivity.grades.map((g, ri) => (
                    <>
                      <div key={`label-${ri}`} style={{ fontSize: 11, fontWeight: 700, color: C.earth, display: "flex", alignItems: "center", padding: "0 4px" }}>{g.toFixed(2)}</div>
                      {lvl.grid[ri].map((van, ci) => (<SensCell key={`${ri}-${ci}`} van={van} isCenter={isBaseCapacity && ri === 2 && ci === 2} />))}
                    </>
                  ))}
                </div>
              </div>
            </>
          );
        })()}
        <div style={{ marginTop: 12, fontSize: 11, color: C.textMuted, display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: C.success, opacity: 0.6 }} /> VAN positive</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: C.red, opacity: 0.6 }} /> VAN negative</span>
        </div>
      </Card>
    </div>
  );
}

export default function MineCalculator() {
  const [unlockedCount, setUnlockedCount] = useState(1);
  const [activeTab, setActiveTab] = useState(0);
  const [phaseInputs, setPhaseInputs] = useState([emptyPhaseInputs(), emptyPhaseInputs(), emptyPhaseInputs()]);
  const [showResults, setShowResults] = useState([false, false, false]);
  const [sensCapacityIdx, setSensCapacityIdx] = useState([1, 1, 1]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const updatePhaseInput = (idx, newInputs) => setPhaseInputs(prev => prev.map((p, i) => i === idx ? newInputs : p));

  const phaseResultsList = useMemo(
    () => phaseInputs.map((inp, idx) => showResults[idx] && isPhaseFilled(inp) ? computePhase(inp) : null),
    [phaseInputs, showResults]
  );

  const consolidated = useMemo(() => {
    const filled = phaseResultsList.filter(Boolean);
    return {
      capexTotal: filled.reduce((a, r) => a + r.capexTotal, 0),
      opexTotal: filled.reduce((a, r) => a + r.opex.total, 0),
      vanTotal: filled.reduce((a, r) => a + r.fin.van, 0),
      vanConservTotal: filled.reduce((a, r) => a + r.fin.vanConserv, 0),
      durationMonths: filled.reduce((a, r) => a + r.durationMonths, 0),
      count: filled.length,
    };
  }, [phaseResultsList]);

  const handleCalculate = (idx) => setShowResults(prev => prev.map((v, i) => i === idx ? true : v));

  const handleUnlockNext = () => {
    setUnlockedCount(c => Math.min(c + 1, 3));
    setActiveTab(unlockedCount);
  };

  const handleExportPdf = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const phases = PHASE_DEFS
        .map((def, idx) => ({ ...def, depositName: phaseInputs[idx].depositName, results: phaseResultsList[idx] }))
        .filter(p => p.results);
      if (phases.length === 0) { setExportError("Aucune phase calculee a exporter pour le moment."); return; }
      await generatePdfReport({ phases, consolidated });
    } catch (err) {
      setExportError("Echec de l'export PDF. Verifiez votre connexion et reessayez.");
    } finally {
      setExporting(false);
    }
  };

  const anyResults = phaseResultsList.some(Boolean);

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", background: C.bg, minHeight: "100vh", padding: "20px 16px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ background: `linear-gradient(135deg, ${C.earth} 0%, ${C.red} 100%)`, borderRadius: 12, padding: "28px 28px 24px", marginBottom: 20, color: "#fff", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -20, top: -20, width: 120, height: 120, borderRadius: "50%", background: C.goldLight, opacity: 0.08 }} />
          <div style={{ position: "absolute", right: 20, bottom: -30, width: 80, height: 80, borderRadius: "50%", background: C.gold, opacity: 0.1 }} />
          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.7, marginBottom: 8 }}>Burkina Faso - Code Minier 2024</div>
          <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 900, lineHeight: 1.2 }}>Modele d'Investissement Progressif</h1>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>Mines Auriferes Semi-Mecanisees - Calculateur Multi-Phases</p>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {PHASE_DEFS.map((def, idx) => {
            const unlocked = idx < unlockedCount;
            const isActive = idx === activeTab;
            return (
              <button key={def.key} disabled={!unlocked} onClick={() => unlocked && setActiveTab(idx)}
                style={{ flex: 1, padding: "10px 8px", borderRadius: 8, border: isActive ? `2px solid ${def.color}` : `1.5px solid ${C.border}`, background: !unlocked ? C.panel : isActive ? def.color + "18" : C.surface, cursor: unlocked ? "pointer" : "not-allowed", fontFamily: "inherit", textAlign: "center", opacity: unlocked ? 1 : 0.5 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: unlocked ? def.color : C.textMuted }}>{def.label}</div>
                <div style={{ fontSize: 9.5, color: C.textMuted, marginTop: 2 }}>{unlocked ? (showResults[idx] ? "Calcule" : "A parametrer") : "Verrouillee"}</div>
              </button>
            );
          })}
        </div>

        {anyResults && (
          <Card title="Resume Consolide - Toutes Phases" accent={C.gold} style={{ marginBottom: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              {[
                { label: "CAPEX Cumule", value: fmtK(consolidated.capexTotal), color: C.red },
                { label: "OPEX Mensuel Cumule", value: fmtK(consolidated.opexTotal), color: C.earth },
                { label: "VAN Cumulee (Base)", value: fmtK(consolidated.vanTotal), color: consolidated.vanTotal > 0 ? C.success : C.red },
                { label: "Duree Totale", value: `${consolidated.durationMonths} mois`, color: C.goldDark },
              ].map(k => (
                <div key={k.label} style={{ padding: "10px 12px", background: C.panel, borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{k.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>Base sur {consolidated.count} phase(s) calculee(s) sur {unlockedCount} debloquee(s).</p>
          </Card>
        )}

        {anyResults && (
          <>
            <button onClick={handleExportPdf} disabled={exporting}
              style={{ width: "100%", padding: "14px", borderRadius: 8, background: exporting ? C.border : `linear-gradient(135deg, ${C.goldDark}, ${C.gold})`, color: exporting ? C.textMuted : "#fff", border: "none", cursor: exporting ? "default" : "pointer", fontSize: 13.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {exporting ? (
                <>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${C.textMuted}`, borderTopColor: "transparent", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
                  Generation du PDF...
                </>
              ) : (<>Exporter le Rapport Complet (Toutes Phases) en PDF</>)}
            </button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            {exportError && (
              <div style={{ background: C.warnBg, border: `1px solid ${C.warn}44`, borderRadius: 8, padding: 10, fontSize: 12, color: C.warn, marginBottom: 20, textAlign: "center" }}>{exportError}</div>
            )}
          </>
        )}

        {!showResults[activeTab] ? (
          <div>
            <PhaseForm phaseLabel={PHASE_DEFS[activeTab].label} inputs={phaseInputs[activeTab]} onChange={v => updatePhaseInput(activeTab, v)} />
            <button onClick={() => handleCalculate(activeTab)} disabled={!isPhaseFilled(phaseInputs[activeTab])}
              style={{ width: "100%", padding: "16px", borderRadius: 8, background: isPhaseFilled(phaseInputs[activeTab]) ? `linear-gradient(135deg, ${C.red}, ${C.redLight})` : C.border, color: "#fff", border: "none", cursor: isPhaseFilled(phaseInputs[activeTab]) ? "pointer" : "not-allowed", fontSize: 15, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 8, marginBottom: 16 }}>
              Calculer {PHASE_DEFS[activeTab].label}
            </button>
            {!isPhaseFilled(phaseInputs[activeTab]) && (
              <p style={{ textAlign: "center", fontSize: 11, color: C.textMuted, marginTop: -8, marginBottom: 24 }}>Renseigne tous les champs ci-dessus pour lancer le calcul.</p>
            )}
          </div>
        ) : (
          <div>
            <div style={{ background: `linear-gradient(135deg, ${C.earth}, ${PHASE_DEFS[activeTab].color})`, borderRadius: 12, padding: "20px 24px", marginBottom: 20, color: "#fff" }}>
              <button onClick={() => setShowResults(prev => prev.map((v, i) => i === activeTab ? false : v))}
                style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", padding: "4px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer", marginBottom: 10, fontFamily: "inherit" }}>Modifier les parametres</button>
              <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 900 }}>
                {PHASE_DEFS[activeTab].label}{phaseInputs[activeTab].depositName ? ` - ${phaseInputs[activeTab].depositName}` : ""}
              </h2>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {fmt(phaseResultsList[activeTab].tonnes)} t - {phaseResultsList[activeTab].grade} g/t Au - {fmt(phaseResultsList[activeTab].capacityTPD)} t/j
              </div>
            </div>
            <PhaseResults results={phaseResultsList[activeTab]} sensCapacityIdx={sensCapacityIdx[activeTab]} setSensCapacityIdx={(v) => setSensCapacityIdx(prev => prev.map((x, i) => i === activeTab ? v : x))} />
          </div>
        )}

        {unlockedCount < 3 && (
          <button onClick={handleUnlockNext}
            style={{ width: "100%", padding: "14px", borderRadius: 8, background: C.surface, border: `2px dashed ${C.border}`, color: C.textMuted, cursor: "pointer", fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", marginTop: 8, marginBottom: 32 }}>
            Debloquer {PHASE_DEFS[unlockedCount].label}
          </button>
        )}

        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, fontSize: 11, color: C.textMuted, marginBottom: 32, lineHeight: 1.6 }}>
          Ce travail est base sur le modele d'investissement progressif de Lankoande (2025).
        </div>
      </div>
    </div>
  );
}
