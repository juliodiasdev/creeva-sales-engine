import { buildWorkbook } from "./workbook";
import { toCsv } from "./export.service";
import type { ExportData } from "./export.service";

import { saveFile, saveText } from "../../lib/saveFile";

const stamp = () => new Date().toISOString().slice(0, 10);

/** Retorna o caminho salvo (ou null se o usuário cancelou). */
export function downloadCsv(data: ExportData): Promise<string | null> {
  return saveText(
    `creava-contatos-${stamp()}.csv`,
    toCsv(data.companies),
    [{ name: "CSV (Excel)", extensions: ["csv"] }],
    "text/csv;charset=utf-8",
  );
}

export async function downloadXlsx(data: ExportData): Promise<string | null> {
  return saveFile(
    `creava-contatos-${stamp()}.xlsx`,
    await buildWorkbook(data),
    [{ name: "Planilha do Excel", extensions: ["xlsx"] }],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
