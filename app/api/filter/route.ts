import path from "path";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SUPPORTED_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".tsv"]);

type ResultRow = {
  email: string;
  domain: string;
  source_file: string;
  sheet: string;
  row_index: number;
  column: string;
};

function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function normalizeDomain(domain: string): string {
  const trimmed = domain.trim().toLowerCase();
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

function domainMatches(email: string, domain: string, exact: boolean): boolean {
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1) {
    return false;
  }
  const host = email.slice(atIndex + 1).toLowerCase();
  if (exact) {
    return host === domain;
  }
  return host === domain || host.endsWith(`.${domain}`);
}

function parseColumns(columns: string): Set<string> | null {
  const normalized = columns
    .split(",")
    .map((column) => column.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) {
    return null;
  }
  return new Set(normalized);
}

function toColumnNames(headerRow: unknown[]): string[] {
  return headerRow.map((value, index) => {
    const name = String(value ?? "").trim();
    if (name.length > 0) {
      return name;
    }
    return `column_${index + 1}`;
  });
}

function extractFromSheet(
  rows: unknown[][],
  sourceFile: string,
  sheet: string,
  domain: string,
  exact: boolean,
  selectedColumns: Set<string> | null
): { matches: ResultRow[]; matchedColumns: number } {
  if (rows.length === 0) {
    return { matches: [], matchedColumns: 0 };
  }

  const headers = toColumnNames(rows[0]);
  let indexesToScan = headers.map((_, index) => index);
  let matchedColumns = 0;

  if (selectedColumns) {
    indexesToScan = headers
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => selectedColumns.has(name.trim().toLowerCase()))
      .map(({ index }) => index);
    matchedColumns = indexesToScan.length;
  }

  const matches: ResultRow[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (const columnIndex of indexesToScan) {
      const value = row[columnIndex];
      if (value === null || value === undefined) {
        continue;
      }
      const emails = String(value).match(EMAIL_RE) ?? [];
      for (const rawEmail of emails) {
        const email = rawEmail.toLowerCase();
        if (!domainMatches(email, domain, exact)) {
          continue;
        }
        matches.push({
          email,
          domain,
          source_file: sourceFile,
          sheet,
          row_index: rowIndex,
          column: headers[columnIndex]
        });
      }
    }
  }

  return { matches, matchedColumns };
}

async function processFile(
  file: File,
  domain: string,
  exact: boolean,
  selectedColumns: Set<string> | null
): Promise<{ rows: ResultRow[]; matchedColumns: number }> {
  const extension = path.extname(file.name).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported file type: ${file.name}`);
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const workbook =
    extension === ".tsv"
      ? XLSX.read(fileBuffer, { type: "buffer", FS: "\t" })
      : XLSX.read(fileBuffer, { type: "buffer" });

  const isDelimited = extension === ".csv" || extension === ".tsv";
  let matchedColumns = 0;
  const allRows: ResultRow[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: null
    }) as unknown[][];
    if (rows.length === 0) {
      continue;
    }

    const extracted = extractFromSheet(
      rows,
      file.name,
      isDelimited ? "(csv)" : sheetName,
      domain,
      exact,
      selectedColumns
    );

    allRows.push(...extracted.matches);
    matchedColumns += extracted.matchedColumns;
  }

  return { rows: allRows, matchedColumns };
}

function dedupeRows(rows: ResultRow[]): ResultRow[] {
  const seen = new Set<string>();
  const deduped: ResultRow[] = [];
  for (const row of rows) {
    if (seen.has(row.email)) {
      continue;
    }
    seen.add(row.email);
    deduped.push(row);
  }
  return deduped;
}

function buildWorkbookBuffer(rows: ResultRow[]): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "emails");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const domainValue = formData.get("domain");
  const columnsValue = formData.get("columns");
  const exact = formData.get("exact") === "true";
  const dedupe = formData.get("dedupe") === "true";

  if (typeof domainValue !== "string" || !domainValue.trim()) {
    return NextResponse.json({ error: "Domain is required." }, { status: 400 });
  }

  const files = formData.getAll("files").filter(isFile);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }

  const domain = normalizeDomain(domainValue);
  if (!domain) {
    return NextResponse.json({ error: "Domain is required." }, { status: 400 });
  }

  const selectedColumns =
    typeof columnsValue === "string" && columnsValue.trim()
      ? parseColumns(columnsValue)
      : null;

  try {
    let matchedColumnsTotal = 0;
    const allMatches: ResultRow[] = [];

    for (const file of files) {
      const processed = await processFile(file, domain, exact, selectedColumns);
      allMatches.push(...processed.rows);
      matchedColumnsTotal += processed.matchedColumns;
    }

    if (selectedColumns && matchedColumnsTotal === 0) {
      return NextResponse.json(
        { error: "None of the specified columns were found in the inputs." },
        { status: 400 }
      );
    }

    if (allMatches.length === 0) {
      return NextResponse.json({ error: "No matching emails found." }, { status: 400 });
    }

    const finalRows = dedupe ? dedupeRows(allMatches) : allMatches;
    const outputBuffer = buildWorkbookBuffer(finalRows);
    const responseBody = new Uint8Array(outputBuffer);
    const filename = `emails_${domain || "output"}.xlsx`;

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
