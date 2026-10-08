import writeXlsxFile from "write-excel-file/browser";

import { saveFile, saveText } from "../../lib/saveFile";

import { CONTACT_COLUMNS, toCsv } from "./export.service";
import type { ContactRow } from "./export.service";

const stamp = () => new Date().toISOString().slice(0, 10);

/** Retorna o caminho salvo (ou null se o usuário cancelou). */
export function downloadCsv(rows: ContactRow[]): Promise<string | null> {
  return saveText(
    `creava-contatos-${stamp()}.csv`,
    toCsv(rows),
    [{ name: "CSV (Excel)", extensions: ["csv"] }],
    "text/csv;charset=utf-8",
  );
}

export async function downloadXlsx(rows: ContactRow[]): Promise<string | null> {
  const header = CONTACT_COLUMNS.map((c) => ({
    value: c.title,
    fontWeight: "bold" as const,
    backgroundColor: "#1e1e1e",
    color: "#f0ff7c",
  }));

  const data = [
    header,
    ...rows.map((row) =>
      CONTACT_COLUMNS.map((c) => {
        const value = row[c.key];

        return typeof value === "number"
          ? { type: Number, value }
          : { type: String, value: value === null ? "" : String(value) };
      }),
    ),
  ];

  const file = writeXlsxFile(
    data as never,
    {
      sheet: "Contatos",
      columns: CONTACT_COLUMNS.map((c) => ({ width: c.width })),
      stickyRowsCount: 1,
    },
  );

  const blob = await file.toBlob();

  return saveFile(
    `creava-contatos-${stamp()}.xlsx`,
    new Uint8Array(await blob.arrayBuffer()),
    [{ name: "Planilha do Excel", extensions: ["xlsx"] }],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
