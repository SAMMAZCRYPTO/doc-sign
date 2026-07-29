import mammoth from 'mammoth';
import html2canvas from 'html2canvas';
import { PDFDocument } from 'pdf-lib';

/**
 * Converts a .docx File object to a PDF Uint8Array using:
 *   mammoth   → DOCX to HTML
 *   html2canvas → HTML to canvas (rendered in a hidden off-screen div)
 *   pdf-lib   → canvas slices to A4 PDF pages
 *
 * @param {File} file - The .docx file object
 * @param {function} [onProgress] - Optional callback(message: string)
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function convertWordToPDF(file, onProgress) {
    const report = (msg) => { if (typeof onProgress === 'function') onProgress(msg); };

    // ── 1. Read DOCX ──────────────────────────────────────────────────────────
    report('Reading Word document…');
    const arrayBuffer = await file.arrayBuffer();

    // ── 2. DOCX → HTML via mammoth ────────────────────────────────────────────
    report('Converting document content…');
    const mammothResult = await mammoth.convertToHtml({ arrayBuffer });
    const htmlBody = mammothResult.value;

    if (!htmlBody || !htmlBody.trim()) {
        throw new Error('The Word document appears to be empty or could not be parsed.');
    }

    // ── 3. Render HTML in a hidden off-screen container ───────────────────────
    report('Rendering document layout…');

    // A4 width at 96 dpi = 794px
    const A4_WIDTH_PX  = 794;
    const A4_HEIGHT_PX = 1123; // A4 at 96 dpi
    const PADDING_PX   = 72;   // ~1 inch margins each side

    const container = document.createElement('div');
    Object.assign(container.style, {
        position: 'fixed',
        top:      '0',
        left:     '-9999px',
        width:    `${A4_WIDTH_PX}px`,
        minHeight: `${A4_HEIGHT_PX}px`,
        padding:  `${PADDING_PX}px`,
        boxSizing: 'border-box',
        background: '#ffffff',
        color:      '#000000',
        fontFamily: '"Calibri", "Arial", sans-serif',
        fontSize:   '11pt',
        lineHeight: '1.6',
        wordBreak:  'break-word',
    });

    // Inject rich style overrides so mammoth HTML looks clean
    const style = document.createElement('style');
    style.textContent = `
        h1 { font-size: 2em;   font-weight: bold; margin: 0.67em 0; }
        h2 { font-size: 1.5em; font-weight: bold; margin: 0.75em 0; }
        h3 { font-size: 1.17em;font-weight: bold; margin: 0.83em 0; }
        h4 { font-size: 1em;   font-weight: bold; margin: 1.12em 0; }
        p  { margin: 0 0 0.6em 0; }
        ul, ol { margin: 0.5em 0 0.5em 1.5em; padding: 0; }
        li { margin-bottom: 0.3em; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
        th, td { border: 1px solid #aaa; padding: 6px 8px; }
        th { background: #e8e8e8; font-weight: bold; }
        img { max-width: 100%; height: auto; }
        strong, b { font-weight: bold; }
        em, i { font-style: italic; }
        u { text-decoration: underline; }
        a { color: #1a56db; text-decoration: underline; }
        pre, code { font-family: "Courier New", monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
    `;
    container.appendChild(style);

    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = htmlBody;
    container.appendChild(contentDiv);
    document.body.appendChild(container);

    // ── 4. Capture full container to canvas ───────────────────────────────────
    report('Capturing pages…');
    let canvas;
    try {
        canvas = await html2canvas(container, {
            scale:           2,          // 2× for crisp text on retina/HiDPI
            useCORS:         true,
            allowTaint:      true,
            backgroundColor: '#ffffff',
            logging:         false,
        });
    } finally {
        document.body.removeChild(container);
    }

    // ── 5. Slice canvas into A4 pages and build PDF ───────────────────────────
    report('Building PDF pages…');

    // PDF point dimensions for A4
    const PDF_A4_W = 595.28;
    const PDF_A4_H = 841.89;

    // How many canvas pixels correspond to one PDF A4 page height
    const scale = canvas.width / PDF_A4_W;          // canvas px per PDF pt
    const pageHeightPx = PDF_A4_H * scale;          // one A4 page in canvas px
    const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

    const pdfDoc = await PDFDocument.create();

    for (let p = 0; p < totalPages; p++) {
        const sliceY      = Math.round(p * pageHeightPx);
        const sliceH      = Math.min(Math.round(pageHeightPx), canvas.height - sliceY);
        if (sliceH <= 0) break;

        // Extract this page slice into a temporary canvas
        const slice = document.createElement('canvas');
        slice.width  = canvas.width;
        slice.height = sliceH;
        slice.getContext('2d').drawImage(canvas, 0, -sliceY);

        // Encode slice as JPEG
        const blob  = await new Promise((res) => slice.toBlob(res, 'image/jpeg', 0.92));
        const bytes = new Uint8Array(await blob.arrayBuffer());

        const img  = await pdfDoc.embedJpg(bytes);
        const page = pdfDoc.addPage([PDF_A4_W, PDF_A4_H]);

        // Fill white background then draw the image
        page.drawImage(img, {
            x:      0,
            y:      PDF_A4_H - (sliceH / scale),   // align to top of page
            width:  PDF_A4_W,
            height: sliceH / scale,
        });
    }

    report('Done converting!');
    return await pdfDoc.save();
}
