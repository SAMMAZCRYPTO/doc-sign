import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker with rock-solid public URL and CDN fallback
if (typeof window !== 'undefined') {
    try {
        // First try local static worker served from /public
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
    } catch (_) {
        // Fallback to trusted CDN if local URL fails
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
}

export { pdfjsLib };
