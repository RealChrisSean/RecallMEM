import { NextRequest } from "next/server";
import path from "node:path";

// Server-side file processing endpoint.
// Used for PDFs (need Node.js to parse) and large files.
// Images and small text files are handled client-side.

export const runtime = "nodejs";
export const maxDuration = 30;

// Cache the worker setup so we only do it once per process
let workerInitialized = false;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const name = file.name;
    const lower = name.toLowerCase();

    // PDFs - parse to text using pdf-parse v2 class-based API
    if (lower.endsWith(".pdf")) {
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

      // Point pdf-parse at the actual worker file in node_modules.
      // Without this, Next.js bundles pdfjs-dist but not the worker, and pdfjs throws.
      if (!workerInitialized) {
        const workerPath = path.join(
          process.cwd(),
          "node_modules",
          "pdfjs-dist",
          "legacy",
          "build",
          "pdf.worker.mjs"
        );
        PDFParse.setWorker(workerPath);
        workerInitialized = true;
      }

      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        return new Response(
          JSON.stringify({
            name,
            type: "pdf",
            content: result.text,
            size: file.size,
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      } finally {
        await parser.destroy().catch(() => {});
      }
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
      const text = buffer.toString("utf-8");
      return new Response(
        JSON.stringify({
          name,
          type: "text",
          content: text,
          size: file.size,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unsupported file type: ${name}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
