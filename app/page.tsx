"use client";

import { useState } from "react";

export default function Page() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [domain, setDomain] = useState("");
  const [columns, setColumns] = useState("");
  const [exact, setExact] = useState(false);
  const [dedupe, setDedupe] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!files || files.length === 0) {
      setStatus("Please add at least one spreadsheet file.");
      return;
    }
    if (!domain.trim()) {
      setStatus("Please enter a domain to filter.");
      return;
    }

    setBusy(true);
    setStatus("Processing files...");

    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      formData.append("domain", domain.trim());
      formData.append("columns", columns.trim());
      formData.append("exact", String(exact));
      formData.append("dedupe", String(dedupe));

      const response = await fetch("/api/filter", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to generate output.");
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `emails_${domain.replace("@", "").trim() || "output"}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);

      setStatus("Done. Your file has downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <header>
        <h1>Email Domain Filter</h1>
        <p>
          Upload multiple spreadsheets, filter emails by domain, and download a
          clean Excel output. Works with .xlsx, .xls, .csv, and .tsv.
        </p>
      </header>

      <section className="card">
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Spreadsheet files
            <input
              type="file"
              multiple
              accept=".xlsx,.xls,.csv,.tsv"
              onChange={(event) => setFiles(event.target.files)}
            />
          </label>

          <div className="row">
            <label>
              Domain (example: @insightglobal.com)
              <input
                type="text"
                placeholder="@insightglobal.com"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
              />
            </label>

            <label>
              Columns to scan (optional)
              <input
                type="text"
                placeholder="email, contact_email"
                value={columns}
                onChange={(event) => setColumns(event.target.value)}
              />
            </label>
          </div>

          <div className="row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={exact}
                onChange={(event) => setExact(event.target.checked)}
              />
              Match exact domain only
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={dedupe}
                onChange={(event) => setDedupe(event.target.checked)}
              />
              Remove duplicate emails
            </label>
          </div>

          <button type="submit" disabled={busy}>
            {busy ? "Filtering..." : "Generate Excel"}
          </button>

          {status ? <div className="status">{status}</div> : null}
          <div className="note">
            Output includes source file, sheet name, row index, and column for
            each email match.
          </div>
        </form>
      </section>
    </main>
  );
}
