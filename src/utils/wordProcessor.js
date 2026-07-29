import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import { PDFDocument } from 'pdf-lib';

const SERVER_URL = 'http://127.0.0.1:3001';

/**
 * Checks whether the local conversion server is running and which engine it uses.
 * Returns null if the server is not reachable.
 */
async function checkServer() {
    try {
        const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return null;
        const data = await res.json();
        return data.ok ? data : null;   // { ok, method: 'word' | 'libreoffice' }
    } catch {
        return null;
    }
}

/**
 * Sends the .docx file to the local conversion server and gets back PDF bytes.
 * The server uses Microsoft Word COM automation or LibreOffice for 100% fidelity.
 */
async function convertViaServer(file, onProgress) {
    onProgress?.(`Converting via ${SERVER_URL}…`);

    const form = new FormData();
    form.append('file', file, file.name);

    const res = await fetch(`${SERVER_URL}/convert`, { method: 'POST', body: form });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Server returned ${res.status}`);
    }

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
}

/**
 * Browser-side fallback: renders with docx-preview (OOXML engine) + html2canvas.
 * Better than mammoth but not pixel-perfect.
 */
async function convertInBrowser(file, onProgress) {
    onProgress?.('Reading Word document…');
    const arrayBuffer = await file.arrayBuffer();

    onProgress?.('Rendering document with OOXML engine…');

    const host = document.createElement('div');
    Object.assign(host.style, {
        position:   'fixed',
        top:        '0',
        left:       '-99999px',
        background: 'white',
        width:      'auto',
        height:     'auto',
        overflow:   'visible',
        zIndex:     '-1',
    });
    document.body.appendChild(host);

    const docxStyle = document.createElement('style');
    docxStyle.textContent = `
        .docx-wrapper { background: white !important; padding: 0 !important; margin: 0 !important; }
        .docx-wrapper > section.docx { box-shadow: none !important; margin: 0 !important; }
    `;
    document.head.appendChild(docxStyle);

    let pdfBytes;
    try {
        await renderAsync(arrayBuffer, host, null, {
            className: 'docx', inWrapper: true,
            ignoreWidth: false, ignoreHeight: false, ignoreFonts: false,
            breakPages: true, ignoreLastRenderedPageBreak: false,
            experimental: true, trimXmlDeclaration: true, useBase64URL: true,
            renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
        });

        const pageSections = host.querySelectorAll('section.docx');
        if (!pageSections.length) throw new Error('docx-preview produced no pages.');

        onProgress?.(`Capturing ${pageSections.length} page(s)…`);

        const pdfDoc = await PDFDocument.create();

        for (let i = 0; i < pageSections.length; i++) {
            onProgress?.(`Capturing page ${i + 1} of ${pageSections.length}…`);
            const section = pageSections[i];

            const canvas = await html2canvas(section, {
                scale: 2, useCORS: true, allowTaint: true,
                backgroundColor: '#ffffff', logging: false,
                width: section.offsetWidth, height: section.offsetHeight, x: 0, y: 0,
            });

            const ptPerPx = 72 / 96;
            const pdfW = section.offsetWidth  * ptPerPx;
            const pdfH = section.offsetHeight * ptPerPx;

            const blob  = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
            const bytes = new Uint8Array(await blob.arrayBuffer());

            const img  = await pdfDoc.embedJpg(bytes);
            const page = pdfDoc.addPage([pdfW, pdfH]);
            page.drawImage(img, { x: 0, y: 0, width: pdfW, height: pdfH });
        }

        onProgress?.('Finalizing PDF…');
        pdfBytes = await pdfDoc.save();
    } finally {
        document.body.removeChild(host);
        document.head.removeChild(docxStyle);
    }

    return pdfBytes;
}

/**
 * Main entry point.
 *
 * 1. If the local DocSign conversion server is running → use it (100% fidelity via Word or LibreOffice)
 * 2. Otherwise → fall back to browser-side docx-preview rendering
 *
 * @param {File}     file       — .docx File object
 * @param {Function} onProgress — optional status callback(message: string)
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function convertWordToPDF(file, onProgress) {
    const serverInfo = await checkServer();

    if (serverInfo) {
        const engineLabel = serverInfo.method === 'word'
            ? 'Microsoft Word'
            : serverInfo.method === 'libreoffice'
            ? 'LibreOffice'
            : 'conversion server';

        onProgress?.(`Using ${engineLabel} for 100% accurate conversion…`);
        return await convertViaServer(file, onProgress);
    }

    // Server not running — fall back to browser rendering
    console.warn('[wordProcessor] Conversion server not detected at', SERVER_URL,
        '— falling back to browser-side docx-preview. Run `npm run dev:full` for 100% fidelity.');
    onProgress?.('Server not found — using browser rendering (run npm run dev:full for best quality)…');

    return await convertInBrowser(file, onProgress);
}
