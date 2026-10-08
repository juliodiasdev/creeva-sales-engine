import ExcelJS from "exceljs";

import { normalizeDomain } from "../../lib/normalize";

import type { ExportCompany, ExportData } from "./export.service";

const INK = "FF1E1E1E";
const LIME = "FFF0FF7C";
const GRID = "FFDDDDDD";
const ZEBRA = "FFF6F7F2";
const LINK = "FF1155CC";

const thin = (color = GRID): Partial<ExcelJS.Borders> => ({
  top: { style: "thin", color: { argb: color } },
  left: { style: "thin", color: { argb: color } },
  bottom: { style: "thin", color: { argb: color } },
  right: { style: "thin", color: { argb: color } },
});

const fill = (argb: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});

/* ---------- textos de exibição dos links ---------- */

const site = (url: string) => normalizeDomain(url) ?? url;

const social = (url: string) => {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts.join("/");

    return url.includes("instagram.com") ? `@${parts[0] ?? ""}` : last || url;
  } catch {
    return url;
  }
};

/* ---------- formatação por faixa ---------- */

function scoreColors(score: number | null): { bg: string; fg: string } {
  if (score === null) return { bg: "FFFFFFFF", fg: "FF999999" };
  if (score >= 70) return { bg: "FFC6F0D2", fg: "FF145A32" };
  if (score >= 50) return { bg: "FFFFF1B8", fg: "FF7A5C00" };

  return { bg: "FFE9EAEC", fg: "FF555555" };
}

function statusColors(status: string): { bg: string; fg: string } {
  switch (status) {
    case "Em prospecção":
      return { bg: LIME, fg: INK };
    case "Qualificada":
      return { bg: "FFC6F0D2", fg: "FF145A32" };
    case "Descartada":
      return { bg: "FFFAD4D4", fg: "FF8A1C1C" };
    default:
      return { bg: "FFE9EAEC", fg: "FF555555" };
  }
}

function rowHeight(text: string, width: number, min = 22): number {
  const lines = text
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (width * 1.05))), 0);

  return Math.min(Math.max(min, lines * 15 + 6), 160);
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 30;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: LIME }, size: 11, name: "Calibri" };
    cell.fill = fill(INK);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thin(INK);
  });
}

function link(cell: ExcelJS.Cell, text: string, url: string) {
  cell.value = { text, hyperlink: url };
  cell.font = { color: { argb: LINK }, underline: true, size: 10.5 };
}

/* ---------- abas ---------- */

function addSummary(wb: ExcelJS.Workbook, data: ExportData, when: Date) {
  const ws = wb.addWorksheet("Resumo", {
    properties: { tabColor: { argb: LIME } },
    views: [{ showGridLines: false }],
  });

  ws.columns = [{ width: 34 }, { width: 14 }, { width: 18 }, { width: 18 }];

  ws.mergeCells("A1:D1");
  ws.getCell("A1").value = "Creava Digital - Agência";
  ws.getCell("A1").font = { bold: true, size: 20, color: { argb: LIME } };
  ws.getCell("A1").fill = fill(INK);
  ws.getCell("A1").alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 40;

  ws.mergeCells("A2:D2");
  ws.getCell("A2").value = `Base de contatos · gerada em ${when.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
  ws.getCell("A2").font = { size: 11, color: { argb: "FFCCCCCC" } };
  ws.getCell("A2").fill = fill(INK);
  ws.getCell("A2").alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 22;

  const list = data.companies;
  const count = (fn: (c: ExportCompany) => boolean) => list.filter(fn).length;

  const kpis: [string, number][] = [
    ["Total de empresas", list.length],
    ["Com algum contato", count((c) => c.hasContact)],
    ["Com WhatsApp", count((c) => !!c.whatsapp)],
    ["Com e-mail", count((c) => !!c.email)],
    ["Com Instagram", count((c) => !!c.instagram)],
    ["Com site próprio", count((c) => !!c.website)],
    ["Em prospecção", count((c) => !!c.prospectStatus)],
    ["Sem nenhum contato", count((c) => !c.hasContact)],
  ];

  let r = 4;

  ws.getCell(`A${r}`).value = "INDICADORES";
  ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: "FF777777" } };
  r++;

  for (const [name, value] of kpis) {
    const a = ws.getCell(`A${r}`);
    const b = ws.getCell(`B${r}`);

    a.value = name;
    b.value = value;
    b.alignment = { horizontal: "center" };
    b.font = { bold: true, size: 12 };
    a.border = thin();
    b.border = thin();
    a.fill = fill(r % 2 ? ZEBRA : "FFFFFFFF");
    b.fill = fill(r % 2 ? ZEBRA : "FFFFFFFF");
    r++;
  }

  r += 1;
  ws.getCell(`A${r}`).value = "POR SEGMENTO";
  ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: "FF777777" } };
  r++;

  const head = ws.getRow(r);

  ["Segmento", "Empresas", "Com WhatsApp", "Pontuação média"].forEach((t, i) => {
    head.getCell(i + 1).value = t;
  });
  styleHeader(head);
  head.height = 24;
  r++;

  const bySegment = new Map<string, ExportCompany[]>();

  for (const c of list) {
    const key = c.segment || "Sem segmento";
    bySegment.set(key, [...(bySegment.get(key) ?? []), c]);
  }

  [...bySegment.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([segment, items], i) => {
      const scores = items.map((c) => c.score).filter((s): s is number => s !== null);
      const avg = scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;

      const row = ws.getRow(r);
      row.getCell(1).value = segment;
      row.getCell(2).value = items.length;
      row.getCell(3).value = items.filter((c) => c.whatsapp).length;
      row.getCell(4).value = avg ?? "—";

      for (let col = 1; col <= 4; col++) {
        const cell = row.getCell(col);
        cell.border = thin();
        cell.fill = fill(i % 2 ? ZEBRA : "FFFFFFFF");
        if (col > 1) cell.alignment = { horizontal: "center" };
      }

      r++;
    });

  r += 1;
  ws.mergeCells(`A${r}:D${r + 2}`);
  const note = ws.getCell(`A${r}`);
  note.value =
    "Como ler: WhatsApp com * é provável (celular encontrado no Google, ainda não confirmado no site). " +
    "As abas “Contatos” e “Sem contato” separam o que já pode ser abordado do que ainda precisa de enriquecimento. " +
    "Os links são clicáveis.";
  note.alignment = { wrapText: true, vertical: "top" };
  note.font = { size: 10, color: { argb: "FF666666" }, italic: true };
}

interface Col {
  header: string;
  width: number;
}

function addCompanies(
  wb: ExcelJS.Workbook,
  name: string,
  tab: string,
  companies: ExportCompany[],
  withMissing: boolean,
) {
  const ws = wb.addWorksheet(name, {
    properties: { tabColor: { argb: tab } },
    views: [{ state: "frozen", xSplit: 1, ySplit: 1, showGridLines: false }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const cols: Col[] = withMissing
    ? [
        { header: "Empresa", width: 38 },
        { header: "Segmento", width: 16 },
        { header: "Cidade", width: 16 },
        { header: "UF", width: 6 },
        { header: "Endereço", width: 44 },
        { header: "Site", width: 30 },
        { header: "Situação", width: 16 },
        { header: "O que fazer", width: 54 },
        { header: "Nome no Google", width: 40 },
      ]
    : [
        { header: "Empresa", width: 36 },
        { header: "Segmento", width: 16 },
        { header: "Cidade", width: 14 },
        { header: "UF", width: 6 },
        { header: "Pontuação", width: 12 },
        { header: "Situação", width: 15 },
        { header: "Etapa de vendas", width: 16 },
        { header: "WhatsApp", width: 19 },
        { header: "Telefone", width: 16 },
        { header: "E-mail", width: 30 },
        { header: "Site", width: 28 },
        { header: "Instagram", width: 24 },
        { header: "Facebook", width: 24 },
        { header: "LinkedIn", width: 22 },
        { header: "Serviço sugerido", width: 24 },
        { header: "Abordagem sugerida (WhatsApp)", width: 64 },
        { header: "Nota Google", width: 11 },
        { header: "Avaliações", width: 11 },
        { header: "Endereço", width: 42 },
        { header: "Nome no Google", width: 40 },
        { header: "Fonte", width: 12 },
        { header: "Cadastrado em", width: 14 },
      ];

  ws.columns = cols.map((c) => ({ width: c.width }));

  const head = ws.getRow(1);
  cols.forEach((c, i) => (head.getCell(i + 1).value = c.header));
  styleHeader(head);

  companies.forEach((c, i) => {
    const row = ws.getRow(i + 2);
    const zebra = i % 2 ? ZEBRA : "FFFFFFFF";
    let longest = 22;

    const set = (col: number, value: ExcelJS.CellValue, opts: Partial<ExcelJS.Style> = {}) => {
      const cell = row.getCell(col);

      cell.value = value;
      cell.style = {
        font: { size: 10.5 },
        alignment: { vertical: "top", wrapText: false },
        ...opts,
      } as ExcelJS.Style;

      return cell;
    };

    if (withMissing) {
      set(1, c.name, { font: { bold: true, size: 10.5 } });
      set(2, c.segment);
      set(3, c.city);
      set(4, c.state, { alignment: { horizontal: "center", vertical: "top" } });
      set(5, c.address, { alignment: { wrapText: true, vertical: "top" } });
      const s = set(6, c.website || "—");
      if (c.website) link(s, site(c.website), c.website);
      const st = set(7, c.leadStatus, { alignment: { horizontal: "center", vertical: "top" } });
      st.fill = fill(statusColors(c.leadStatus).bg);
      st.font = { size: 10.5, bold: true, color: { argb: statusColors(c.leadStatus).fg } };
      set(8, c.missing, { alignment: { wrapText: true, vertical: "top" } });
      set(9, c.originalName, { font: { size: 9.5, color: { argb: "FF888888" } }, alignment: { wrapText: true, vertical: "top" } });
      longest = Math.max(rowHeight(c.address, 44), rowHeight(c.missing, 54), rowHeight(c.originalName, 40));
    } else {
      set(1, c.name, { font: { bold: true, size: 10.5 }, alignment: { wrapText: true, vertical: "top" } });
      set(2, c.segment);
      set(3, c.city);
      set(4, c.state, { alignment: { horizontal: "center", vertical: "top" } });

      const sc = scoreColors(c.score);
      const scoreCell = set(5, c.score ?? "—", { alignment: { horizontal: "center", vertical: "top" } });
      scoreCell.fill = fill(sc.bg);
      scoreCell.font = { bold: true, size: 10.5, color: { argb: sc.fg } };

      const stc = statusColors(c.leadStatus);
      const st = set(6, c.leadStatus, { alignment: { horizontal: "center", vertical: "top" } });
      st.fill = fill(stc.bg);
      st.font = { size: 10.5, bold: true, color: { argb: stc.fg } };

      set(7, c.prospectStatus || "—", { alignment: { horizontal: "center", vertical: "top" } });

      const wa = set(8, c.whatsapp || "—");
      if (c.whatsapp && c.whatsappUrl) {
        link(wa, c.whatsapp + (c.whatsappProbable ? " *" : ""), c.whatsappUrl);
      }

      set(9, c.landline || "—");

      const em = set(10, c.email || "—");
      if (c.email) link(em, c.email, `mailto:${c.email}`);

      const sw = set(11, c.website || "—");
      if (c.website) link(sw, site(c.website), c.website);

      for (const [col, url] of [[12, c.instagram], [13, c.facebook], [14, c.linkedin]] as const) {
        const cell = set(col, url || "—");
        if (url) link(cell, social(url), url);
      }

      set(15, c.service || "—");
      set(16, c.approach || "—", { alignment: { wrapText: true, vertical: "top" } });
      set(17, c.rating ?? "—", { alignment: { horizontal: "center", vertical: "top" }, numFmt: "0.0" });
      set(18, c.reviews ?? "—", { alignment: { horizontal: "center", vertical: "top" }, numFmt: "#,##0" });
      set(19, c.address, { alignment: { wrapText: true, vertical: "top" } });
      set(20, c.originalName, { font: { size: 9.5, color: { argb: "FF888888" } }, alignment: { wrapText: true, vertical: "top" } });
      set(21, c.source);
      set(22, c.createdAt, { alignment: { horizontal: "center", vertical: "top" } });

      longest = Math.max(
        rowHeight(c.approach, 64),
        rowHeight(c.address, 42),
        rowHeight(c.originalName, 40),
        rowHeight(c.name, 36),
      );
    }

    row.height = longest;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > cols.length) return;
      cell.border = thin();

      const isColored =
        (!withMissing && (colNumber === 5 || colNumber === 6)) ||
        (withMissing && colNumber === 7);

      if (!isColored) cell.fill = fill(zebra);
    });
  });

  if (companies.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: companies.length + 1, column: cols.length },
    };
  }

  return ws;
}

function addApproaches(wb: ExcelJS.Workbook, data: ExportData) {
  const ws = wb.addWorksheet("Abordagens", {
    properties: { tabColor: { argb: "FF8AB4F8" } },
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const cols: Col[] = [
    { header: "Empresa", width: 36 },
    { header: "Canal", width: 14 },
    { header: "Serviço", width: 26 },
    { header: "Origem", width: 10 },
    { header: "Mensagem", width: 90 },
  ];

  ws.columns = cols.map((c) => ({ width: c.width }));
  cols.forEach((c, i) => (ws.getRow(1).getCell(i + 1).value = c.header));
  styleHeader(ws.getRow(1));

  data.approaches.forEach((a, i) => {
    const row = ws.getRow(i + 2);
    row.values = [a.company, a.channel, a.service || "—", a.origin, a.message];
    row.height = rowHeight(a.message, 90);

    row.eachCell({ includeEmpty: true }, (cell, n) => {
      if (n > cols.length) return;
      cell.border = thin();
      cell.fill = fill(i % 2 ? ZEBRA : "FFFFFFFF");
      cell.font = { size: 10.5, bold: n === 1 };
      cell.alignment = {
        vertical: "top",
        wrapText: n === 5 || n === 1,
        horizontal: n === 2 || n === 4 ? "center" : "left",
      };
    });
  });

  if (data.approaches.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: data.approaches.length + 1, column: cols.length },
    };
  }
}

const byPriority = (a: ExportCompany, b: ExportCompany) =>
  Number(!!b.prospectStatus) - Number(!!a.prospectStatus) ||
  (b.score ?? -1) - (a.score ?? -1) ||
  a.name.localeCompare(b.name, "pt-BR");

/** Monta a planilha profissional (xlsx) a partir dos dados organizados. */
export async function buildWorkbook(
  data: ExportData,
  when = new Date(),
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();

  wb.creator = "Creava Digital - Agência";
  wb.created = when;
  wb.title = "Base de contatos";

  const sorted = [...data.companies].sort(byPriority);

  addSummary(wb, data, when);

  addCompanies(
    wb,
    "Contatos",
    "FF6EE7A0",
    sorted.filter((c) => c.hasContact),
    false,
  );

  addCompanies(
    wb,
    "Sem contato",
    "FFFFB4B4",
    sorted.filter((c) => !c.hasContact),
    true,
  );

  addApproaches(wb, data);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
