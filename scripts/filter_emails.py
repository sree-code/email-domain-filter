#!/usr/bin/env python3
import argparse
import re
from pathlib import Path
from typing import Iterable, List, Dict, Any

try:
    import pandas as pd
except ModuleNotFoundError as exc:
    if exc.name == "pandas":
        raise SystemExit(
            "Missing dependency: pandas.\n"
            "Create a virtual environment and install requirements:\n"
            "python3.11 -m venv .venv\n"
            "source .venv/bin/activate\n"
            "python -m pip install -r requirements.txt"
        )
    raise

EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)


def normalize_domain(domain: str) -> str:
    domain = domain.strip().lower()
    if domain.startswith("@"):
        domain = domain[1:]
    return domain


def iter_input_files(paths: List[str]) -> Iterable[Path]:
    for p in paths:
        path = Path(p)
        if path.is_dir():
            for pattern in ("*.xlsx", "*.xls", "*.csv", "*.tsv"):
                for match in path.glob(pattern):
                    yield match
        else:
            yield path


def domain_matches(email: str, domain: str, exact: bool) -> bool:
    if "@" not in email:
        return False
    host = email.rsplit("@", 1)[1].lower()
    if exact:
        return host == domain
    return host == domain or host.endswith("." + domain)


def extract_from_dataframe(
    df: pd.DataFrame,
    domain: str,
    exact: bool,
    source_file: str,
    sheet: str,
    columns: List[str] | None,
) -> tuple[List[Dict[str, Any]], int]:
    results: List[Dict[str, Any]] = []
    columns_to_scan = list(df.columns)
    matched_columns = 0
    if columns:
        normalized = {c.strip().lower() for c in columns if c.strip()}
        columns_to_scan = [
            col for col in df.columns if str(col).strip().lower() in normalized
        ]
        matched_columns = len(columns_to_scan)

    for col in columns_to_scan:
        series = df[col]
        for row_index, value in series.items():
            if pd.isna(value):
                continue
            for email in EMAIL_RE.findall(str(value)):
                email_norm = email.lower()
                if domain_matches(email_norm, domain, exact):
                    results.append(
                        {
                            "email": email_norm,
                            "domain": domain,
                            "source_file": source_file,
                            "sheet": sheet,
                            "row_index": int(row_index) + 1,
                            "column": str(col),
                        }
                    )
    return results, matched_columns


def process_file(
    path: Path, domain: str, exact: bool, columns: List[str] | None
) -> tuple[List[Dict[str, Any]], int]:
    results: List[Dict[str, Any]] = []
    matched_columns = 0
    suffix = path.suffix.lower()

    if suffix in {".xlsx", ".xls"}:
        try:
            sheets = pd.read_excel(path, sheet_name=None, dtype=object)
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(f"Failed to read {path.name}: {exc}")

        for sheet_name, df in sheets.items():
            if df.empty:
                continue
            sheet_results, sheet_matched = extract_from_dataframe(
                df=df,
                domain=domain,
                exact=exact,
                source_file=path.name,
                sheet=sheet_name,
                columns=columns,
            )
            results.extend(sheet_results)
            matched_columns += sheet_matched
    elif suffix in {".csv", ".tsv"}:
        sep = "\t" if suffix == ".tsv" else ","
        df = pd.read_csv(path, sep=sep, dtype=object)
        if not df.empty:
            sheet_results, sheet_matched = extract_from_dataframe(
                df=df,
                domain=domain,
                exact=exact,
                source_file=path.name,
                sheet="(csv)",
                columns=columns,
            )
            results.extend(sheet_results)
            matched_columns += sheet_matched
    else:
        raise ValueError(f"Unsupported file type: {path.name}")

    return results, matched_columns


def autosize_columns(path: Path) -> None:
    try:
        from openpyxl import load_workbook
    except Exception:
        return

    wb = load_workbook(path)
    ws = wb.active
    for column_cells in ws.columns:
        max_len = 0
        col_letter = column_cells[0].column_letter
        for cell in column_cells:
            if cell.value is None:
                continue
            max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col_letter].width = min(max_len + 2, 60)
    wb.save(path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Filter emails by domain across multiple spreadsheet inputs.",
    )
    parser.add_argument(
        "--domain",
        required=True,
        help="Domain to filter (example: insightglobal.com or @insightglobal.com)",
    )
    parser.add_argument(
        "--input",
        nargs="+",
        required=True,
        help="Input files or directories containing .xlsx/.csv/.tsv",
    )
    parser.add_argument(
        "--output",
        help="Output .xlsx file path. Defaults to output/spreadsheet/emails_<domain>.xlsx",
    )
    parser.add_argument(
        "--exact",
        action="store_true",
        help="Match only the exact domain (no subdomains)",
    )
    parser.add_argument(
        "--dedupe",
        action="store_true",
        help="Remove duplicate emails in the output",
    )
    parser.add_argument(
        "--columns",
        help="Comma-separated column names to scan (optional). Example: email, contact_email",
    )

    args = parser.parse_args()

    domain = normalize_domain(args.domain)
    inputs = list(iter_input_files(args.input))
    if not inputs:
        raise SystemExit("No input files found.")

    all_rows: List[Dict[str, Any]] = []
    columns: List[str] | None = None
    if args.columns:
        columns = [c.strip() for c in args.columns.split(",") if c.strip()]
    matched_columns_total = 0
    for path in inputs:
        if not path.exists():
            raise SystemExit(f"Input not found: {path}")
        rows, matched_columns = process_file(path, domain, args.exact, columns)
        all_rows.extend(rows)
        matched_columns_total += matched_columns

    if columns and matched_columns_total == 0:
        raise SystemExit("None of the specified columns were found in the inputs.")

    if not all_rows:
        raise SystemExit("No matching emails found.")

    df = pd.DataFrame(all_rows)
    if args.dedupe:
        df = df.drop_duplicates(subset=["email"], keep="first")

    output_path = Path(args.output) if args.output else None
    if output_path is None:
        repo_root = Path(__file__).resolve().parents[1]
        output_dir = repo_root / "output" / "spreadsheet"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"emails_{domain}.xlsx"

    df.to_excel(output_path, index=False)
    autosize_columns(output_path)

    print(f"Wrote {len(df)} rows to {output_path}")


if __name__ == "__main__":
    main()
