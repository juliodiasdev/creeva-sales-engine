import writeXlsxFile from "write-excel-file/browser";

import { CONTACT_COLUMNS, toCsv } from "./export.service";
import type { ContactRow } from "./export.service";

function save(blob: Blob, fileName: string): void {
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function downloadCsv(rows: ContactRow[]): void {
  save(
    new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }),
    `creava-contatos-${stamp()}.csv`,
  );
}

export async function downloadXlsx(rows: ContactRow[]): Promise<void> {
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

  // Mesmo caminho de download do CSV (link temporário).
  save(await file.toBlob(), `creava-contatos-${stamp()}.xlsx`);
}
