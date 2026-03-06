# Email Domain Filter

Filter email addresses from multiple spreadsheets by domain and write the results to a new Excel file. Includes a small Next.js UI and a standalone Python CLI.

## Setup
```bash
npm run setup
```

If `nvm use` fails, install Node `22.14.0` first (`nvm install 22.14.0`).
If `python3.11` is unavailable, use any Python `3.9+` executable that supports `venv`.

## Run the UI
```bash
npm run dev
```

Open `http://localhost:3000`.

The API route automatically prefers `.venv/bin/python` if it exists.

## Run the CLI
```bash
.venv/bin/python scripts/filter_emails.py --domain @insightglobal.com --input data
```

You can also pass multiple files and folders:
```bash
.venv/bin/python scripts/filter_emails.py --domain insightglobal.com --input data file1.xlsx file2.csv
```

## Output
By default, output is written to:
```
output/spreadsheet/emails_<domain>.xlsx
```

## Options
- `--columns "email, contact_email"` scan only specific columns
- `--exact` match only the exact domain (no subdomains)
- `--dedupe` remove duplicate emails
- `--output /path/to/output.xlsx` custom output file

## Notes
- The script scans all columns in all sheets unless `--columns` is set.
- For legacy `.xls` files, you may need the `xlrd` package.
