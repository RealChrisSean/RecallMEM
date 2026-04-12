import { NextRequest } from "next/server";
import path from "node:path";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Server-side file processing endpoint.
// PDFs: extracts text + renders each page as an image so the LLM can see
// charts, diagrams, scanned content — not just extractable text.
// Images and small text files are handled client-side.

export const runtime = "nodejs";
export const maxDuration = 60;

// Cache the worker setup so we only do it once per process
let workerInitialized = false;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return json({ error: "No file provided" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const name = file.name;
    const lower = name.toLowerCase();

    // PDFs — extract text AND render pages as images
    if (lower.endsWith(".pdf")) {
      // 1. Extract text via pdf-parse
      let textContent = "";
      try {
        const pdfModule = (await import("pdf-parse")) as unknown as {
          PDFParse: {
            new (opts: { data: Uint8Array }): {
              getText: () => Promise<{ text: string }>;
              destroy: () => Promise<void>;
            };
            setWorker: (workerSrc?: string) => string;
          };
        };
        const { PDFParse } = pdfModule;

        if (!workerInitialized) {
          const workerPath = path.join(
            process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"
          );
          PDFParse.setWorker(workerPath);
          workerInitialized = true;
        }

        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        try {
          const result = await parser.getText();
          textContent = result.text;
        } finally {
          await parser.destroy().catch(() => {});
        }
      } catch {
        // Text extraction failed (scanned PDF, etc) — images will still work
      }

      // 2. Render pages as images via pdftoppm (poppler)
      const pageImages: string[] = [];
      const id = randomUUID();
      const pdfPath = path.join(tmpdir(), `recallmem-pdf-${id}.pdf`);
      const outDir = path.join(tmpdir(), `recallmem-pdf-${id}`);

      try {
        writeFileSync(pdfPath, buffer);
        mkdirSync(outDir, { recursive: true });

        // Render at 150 DPI (good balance of quality vs size). Max 20 pages.
        execSync(
          `pdftoppm -png -r 150 -l 20 "${pdfPath}" "${outDir}/page"`,
          { timeout: 30000 }
        );

        // Read rendered page images and convert to base64
        const files = readdirSync(outDir)
          .filter((f) => f.endsWith(".png"))
          .sort();

        for (const f of files) {
          const imgBuf = readFileSync(path.join(outDir, f));
          pageImages.push(imgBuf.toString("base64"));
        }
      } catch (err) {
        console.error("[upload] pdftoppm failed:", err);
        // Continue without images — text-only fallback
      } finally {
        // Cleanup temp files
        try { unlinkSync(pdfPath); } catch {}
        try {
          for (const f of readdirSync(outDir)) unlinkSync(path.join(outDir, f));
          require("node:fs").rmdirSync(outDir);
        } catch {}
      }

      return json({
        name,
        type: "pdf",
        content: textContent,
        images: pageImages, // base64 PNG per page
        pageCount: pageImages.length,
        size: file.size,
      });
    }

    // Text-like files
    const TEXT_EXTENSIONS = [
      ".txt", ".md", ".markdown", ".json", ".csv", ".yaml", ".yml",
      ".js", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".rs",
      ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".swift",
      ".kt", ".sh", ".bash", ".zsh", ".sql", ".html", ".css", ".scss",
      ".xml", ".log", ".env", ".toml", ".ini", ".conf",
    ];
    if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return json({
        name,
        type: "text",
        content: buffer.toString("utf-8"),
        size: file.size,
      });
    }

    return json({ error: `Unsupported file type: ${name}` }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
