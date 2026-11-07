import { getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

// About 1584px on a Letter page's long edge, the most Claude takes before downscaling.
const RENDER_SCALE = 2;

// pdfjs types its factory as a bare object. In Node it is backed by @napi-rs/canvas, whose canvas adds toBuffer.
type Canvas = Parameters<PDFPageProxy["render"]>[0]["canvas"] & { toBuffer(mime: string): Buffer };
type NodeCanvasFactory = { create(width: number, height: number): { canvas: Canvas } };

// Takes bytes only, never a URL, so pdfjs has nothing to fetch.
async function withDocument<T>(pdf: Uint8Array, use: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  // A copy, because pdfjs detaches the buffer it is given.
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  try {
    return await use(await task.promise);
  } finally {
    await task.destroy();
  }
}

export const pdfText = (pdf: Uint8Array): Promise<string> =>
  withDocument(pdf, async (doc) => {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const { items } = await (await doc.getPage(n)).getTextContent();
      pages.push(items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "")).join(""));
    }
    return pages.join("\n\n");
  });

export const pdfPageImages = (pdf: Uint8Array): Promise<{ mediaType: string; base64: string }[]> =>
  withDocument(pdf, async (doc) => {
    const images = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const { canvas } = (doc.canvasFactory as NodeCanvasFactory).create(viewport.width, viewport.height);
      await page.render({ canvas, viewport }).promise;
      images.push({ mediaType: "image/png", base64: canvas.toBuffer("image/png").toString("base64") });
    }
    return images;
  });
