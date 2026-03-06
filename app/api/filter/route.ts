import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

async function saveFile(file: File, dir: string) {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${crypto.randomUUID()}_${safeName}`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function findPythonExecutable(repoRoot: string): Promise<string> {
  if (process.env.PYTHON_BIN?.trim()) {
    return process.env.PYTHON_BIN.trim();
  }

  const venvPython = path.join(repoRoot, ".venv", "bin", "python");
  try {
    await fs.access(venvPython);
    return venvPython;
  } catch {
    return "python3";
  }
}

function formatPythonError(message: string): string {
  if (!message.includes("ModuleNotFoundError") || !message.includes("pandas")) {
    return message;
  }

  return [
    "Python dependency `pandas` is missing for this project.",
    "Create a virtual environment and install requirements:",
    "python3.11 -m venv .venv",
    "source .venv/bin/activate",
    "python -m pip install -r requirements.txt",
    "",
    "Alternatively set PYTHON_BIN to a Python executable that already has dependencies installed."
  ].join("\n");
}

function runPython(
  pythonBin: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, { cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(formatPythonError(stderr || stdout || `Python exited with code ${code}`)));
      }
    });
  });
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const domain = formData.get("domain");
  const columns = formData.get("columns");
  const exact = formData.get("exact") === "true";
  const dedupe = formData.get("dedupe") === "true";

  if (typeof domain !== "string" || !domain.trim()) {
    return NextResponse.json({ error: "Domain is required." }, { status: 400 });
  }

  const files = formData.getAll("files").filter(isFile);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "email-domain-filter-"));
  const repoRoot = process.cwd();
  const outputPath = path.join(tmpDir, "emails.xlsx");

  try {
    const inputPaths: string[] = [];
    for (const file of files) {
      inputPaths.push(await saveFile(file, tmpDir));
    }

    const args = [
      path.join("scripts", "filter_emails.py"),
      "--domain",
      domain,
      "--input",
      ...inputPaths,
      "--output",
      outputPath
    ];

    if (typeof columns === "string" && columns.trim().length > 0) {
      args.push("--columns", columns.trim());
    }
    if (exact) {
      args.push("--exact");
    }
    if (dedupe) {
      args.push("--dedupe");
    }

    const pythonBin = await findPythonExecutable(repoRoot);
    await runPython(pythonBin, args, repoRoot);

    const buffer = await fs.readFile(outputPath);
    const filename = `emails_${domain.replace("@", "").trim() || "output"}.xlsx`;

    return new NextResponse(buffer, {
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
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
