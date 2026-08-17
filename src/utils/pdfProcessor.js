import { PDFDocument, PDFName, PDFString, PDFHexString, rgb, StandardFonts, degrees, PDFRawStream, PDFNumber, decodePDFRawStream } from 'pdf-lib';
import { pdfjsLib } from './pdfWorkerInit';


/**
 * Sanitizes a string so that it can be safely encoded using standard PDF WinAnsi (Windows-1252) encoding.
 * Replaces common mathematical and layout characters (e.g., ≥, ≤, μ, smart quotes) with safe equivalents,
 * normalizes accents, and filters out unencodable characters to prevent pdf-lib rendering crashes.
 * 
 * @param {string} text - The input text to clean
 * @returns {string} - The sanitized text
 */
export function sanitizeTextForWinAnsi(text) {
    if (!text) return '';
    
    // 1. Common mathematical and layout replacements
    let cleaned = text
        .replace(/≥/g, '>=')
        .replace(/≤/g, '<=')
        .replace(/≠/g, '!=')
        .replace(/±/g, '+/-')
        .replace(/≈/g, '~=')
        .replace(/≡/g, '==')
        .replace(/→|➔|➡|➔/g, '->')
        .replace(/←|⬅/g, '<-')
        .replace(/⇒|⟹/g, '=>')
        .replace(/⇐|⟸/g, '<=')
        .replace(/✓|✔/g, '[x]')
        .replace(/✗|✘/g, '[ ]')
        .replace(/μ|µ/g, 'u') // Both Greek mu and Micro sign to standard u
        .replace(/α/g, 'alpha')
        .replace(/β/g, 'beta')
        .replace(/π/g, 'pi')
        .replace(/·/g, '*')
        .replace(/●|■|◆|▲|▼/g, '-')
        .replace(/™/g, '(TM)')
        .replace(/©/g, '(C)')
        .replace(/®/g, '(R)');

    // 2. Decompose accented letters and strip the accents (e.g. é -> e)
    cleaned = cleaned.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 3. Strict filter for WinAnsi (Windows-1252) allowed characters
    const allowedCodePoints = new Set([
        0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6,
        0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C,
        0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A,
        0x0153, 0x017E, 0x0178
    ]);

    let result = '';
    for (let i = 0; i < cleaned.length; i++) {
        const char = cleaned[i];
        const code = char.charCodeAt(0);
        
        if ((code >= 0x00 && code <= 0x7F) || (code >= 0xA0 && code <= 0xFF) || allowedCodePoints.has(code)) {
            result += char;
        } else {
            // Replace completely unsupported symbols with a space to prevent crash
            result += ' ';
        }
    }
    
    // Clean up multiple spaces that might have been introduced
    return result.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts comments (annotations) from a PDF.
 * 
 * @param {ArrayBuffer} pdfBuffer - The original PDF file buffer
 * @returns {Promise<Array>} - Array of extracted comments
 */
export async function extractCommentsFromPDF(pdfBuffer) {
    try {
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const pages = pdfDoc.getPages();
        const comments = [];

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const pageNum = i + 1;
            const pageDict = page.node;
            const annotsRef = pageDict.get(PDFName.of('Annots'));
            if (!annotsRef) continue;

            const annotsArray = pdfDoc.context.lookup(annotsRef);
            if (!annotsArray || typeof annotsArray.asArray !== 'function') continue;

            for (const annotRef of annotsArray.asArray()) {
                const annotDict = pdfDoc.context.lookup(annotRef);
                if (!annotDict) continue;

                const subtype = annotDict.get(PDFName.of('Subtype'));
                const subtypeStr = subtype ? subtype.toString() : '';

                // Ignore links, widgets, popups
                if (['/Popup', '/Link', '/Widget'].includes(subtypeStr)) continue;

                // ── Helper: decode a PDFString/PDFHexString to plain text ──────
                const decodeStr = (obj) => {
                    if (!obj) return '';
                    if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
                    if (typeof obj.decodeText === 'function') return obj.decodeText();
                    return obj.toString().replace(/^[\/(<]|[>)]$/g, '');
                };

                // ── Extract standard text fields ─────────────────────────────
                const contentsObj = annotDict.get(PDFName.of('Contents'));
                const text = sanitizeTextForWinAnsi(decodeStr(contentsObj).trim());

                const authorObj = annotDict.get(PDFName.of('T'));
                const author = sanitizeTextForWinAnsi(decodeStr(authorObj).trim()) || 'Anonymous';

                const rectObj = annotDict.get(PDFName.of('Rect'));
                let rect = null;
                if (rectObj) {
                    const lookupRect = pdfDoc.context.lookup(rectObj);
                    if (lookupRect && typeof lookupRect.asArray === 'function') {
                        rect = lookupRect.asArray().map(v =>
                            typeof v.asNumber === 'function' ? v.asNumber() : (v.value !== undefined ? v.value : Number(v))
                        );
                    }
                }

                // ── FileAttachment: extract embedded image bytes ─────────────
                let attachmentBytes = null;
                let attachmentName = '';
                let attachmentMime = '';

                if (subtypeStr === '/FileAttachment') {
                    try {
                        const fsObj = annotDict.get(PDFName.of('FS'));
                        const fsDict = fsObj ? pdfDoc.context.lookup(fsObj) : null;
                        if (fsDict) {
                            // Get filename for mime detection
                            const fnObj = fsDict.get(PDFName.of('F')) || fsDict.get(PDFName.of('UF'));
                            attachmentName = decodeStr(fnObj).toLowerCase();

                            const efDict = fsDict.get(PDFName.of('EF'));
                            const efResolved = efDict ? pdfDoc.context.lookup(efDict) : null;
                            if (efResolved) {
                                const streamRef = efResolved.get(PDFName.of('F')) ||
                                                  efResolved.get(PDFName.of('UF')) ||
                                                  efResolved.entries().next().value?.[1];
                                const streamObj = streamRef ? pdfDoc.context.lookup(streamRef) : null;
                                if (streamObj && (streamObj instanceof PDFRawStream || streamObj.constructor.name === 'PDFRawStream')) {
                                    // Determine mime from filename extension
                                    if (/\.jpe?g$/i.test(attachmentName)) attachmentMime = 'image/jpeg';
                                    else if (/\.png$/i.test(attachmentName))  attachmentMime = 'image/png';
                                    else if (/\.gif$/i.test(attachmentName))  attachmentMime = 'image/gif';
                                    else if (/\.bmp$/i.test(attachmentName))  attachmentMime = 'image/bmp';
                                    else if (/\.webp$/i.test(attachmentName)) attachmentMime = 'image/webp';

                                    if (attachmentMime) {
                                        // Decode stream (handles FlateDecode wrapping)
                                        try {
                                            attachmentBytes = decodePDFRawStream(streamObj).decode();
                                        } catch (_) {
                                            attachmentBytes = streamObj.contents;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (attachErr) {
                        console.warn('Could not extract attachment:', attachErr.message);
                    }
                }

                // ── Only record if there is text OR an image attachment ───────
                if (text || attachmentBytes) {
                    comments.push({
                        page: pageNum,
                        subtype: subtypeStr.replace('/', ''),
                        text: text || (attachmentName ? `[Attached: ${attachmentName}]` : '[Image Attachment]'),
                        author,
                        rect,
                        attachmentBytes,   // Uint8Array | null
                        attachmentMime,    // 'image/jpeg' | 'image/png' | '' | null
                    });
                }
            }
        }

        return comments.sort((a, b) => a.page - b.page);
    } catch (e) {
        console.error('Error extracting comments:', e);
        return [];
    }
}

/**
 * Wraps text to fit a specified width using pdf-lib font utilities.
 */
function wrapText(text, width, font, fontSize) {
    if (!text) return [];
    const paragraphs = text.split('\n');
    const lines = [];

    for (const para of paragraphs) {
        const words = para.split(/\s+/);
        let currentLine = '';

        for (const word of words) {
            if (!word) continue;
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const testWidth = font.widthOfTextAtSize(testLine, fontSize);
            if (testWidth > width) {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    // Force split word if it's too wide
                    let chunk = '';
                    for (let i = 0; i < word.length; i++) {
                        const testChunk = chunk + word[i];
                        if (font.widthOfTextAtSize(testChunk, fontSize) > width) {
                            lines.push(chunk);
                            chunk = word[i];
                        } else {
                            chunk = testChunk;
                        }
                    }
                    currentLine = chunk;
                }
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) {
            lines.push(currentLine);
        }
    }
    return lines;
}

/**
 * Generates and inserts comment resolution sheets at the beginning of the PDF.
 */
async function generateCommentResolutionSheet(pdfDoc, comments) {
    const pages = pdfDoc.getPages();
    const originalPageRefs = pages.map(p => p.ref);
    const firstPage = pages[0];
    const { width: pageWidth, height: pageHeight } = firstPage ? firstPage.getSize() : { width: 595.27, height: 841.89 };

    const margin = 40;
    const topMargin = 60;
    const bottomMargin = 50;
    const printableWidth = pageWidth - margin * 2;

    // Define column width percentages: Ref/Page (12%), Comment Details (44%), Vendor (22%), Contractor (22%)
    const colWidths = [
        0.12 * printableWidth,
        0.44 * printableWidth,
        0.22 * printableWidth,
        0.22 * printableWidth
    ];
    const colPositions = [
        margin,
        margin + colWidths[0],
        margin + colWidths[0] + colWidths[1],
        margin + colWidths[0] + colWidths[1] + colWidths[2]
    ];

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const sheetPages = [];
    let currentPageIndex = 0;
    let currentPage = null;
    let currentY = 0;

    const addNewSheetPage = () => {
        const page = pdfDoc.insertPage(currentPageIndex, [pageWidth, pageHeight]);
        sheetPages.push(page);
        currentPageIndex++;

        // Draw White Background
        page.drawRectangle({
            x: 0,
            y: 0,
            width: pageWidth,
            height: pageHeight,
            color: rgb(1, 1, 1),
        });

        // Title
        page.drawText('COMMENT RESOLUTION SHEET', {
            x: margin,
            y: pageHeight - 35,
            size: 14,
            font: helveticaBold,
            color: rgb(0.09, 0.14, 0.25),
        });

        // Top Accent Line
        page.drawLine({
            start: { x: margin, y: pageHeight - 45 },
            end: { x: pageWidth - margin, y: pageHeight - 45 },
            thickness: 1.5,
            color: rgb(0.23, 0.51, 0.96),
        });

        // Table Header Row
        const headerY = pageHeight - topMargin - 20;
        const headerHeight = 20;
        page.drawRectangle({
            x: margin,
            y: headerY,
            width: printableWidth,
            height: headerHeight,
            color: rgb(0.09, 0.14, 0.25),
        });

        const headers = ['Ref / Page', 'Comment Details', 'Vendor Response', 'Contractor Response'];
        for (let j = 0; j < headers.length; j++) {
            page.drawText(headers[j], {
                x: colPositions[j] + 6,
                y: headerY + 6,
                size: 8.5,
                font: helveticaBold,
                color: rgb(1, 1, 1),
            });
        }

        // Table Header Borders
        page.drawLine({
            start: { x: margin, y: headerY + headerHeight },
            end: { x: margin + printableWidth, y: headerY + headerHeight },
            thickness: 0.5,
            color: rgb(0.58, 0.64, 0.72),
        });
        page.drawLine({
            start: { x: margin, y: headerY },
            end: { x: margin + printableWidth, y: headerY },
            thickness: 0.5,
            color: rgb(0.58, 0.64, 0.72),
        });

        for (let j = 0; j <= headers.length; j++) {
            const x = j === headers.length ? margin + printableWidth : colPositions[j];
            page.drawLine({
                start: { x, y: headerY + headerHeight },
                end: { x, y: headerY },
                thickness: 0.5,
                color: rgb(0.58, 0.64, 0.72),
            });
        }

        currentPage = page;
        currentY = headerY;
    };

    if (comments.length === 0) {
        // Generate single sheet page indicating no comments found
        addNewSheetPage();
        const rowHeight = 70;

        currentPage.drawRectangle({
            x: margin,
            y: currentY - rowHeight,
            width: printableWidth,
            height: rowHeight,
            color: rgb(0.98, 0.98, 0.99),
        });

        currentPage.drawText('No comments detected in the PDF.', {
            x: margin + 15,
            y: currentY - rowHeight / 2 - 4,
            size: 9.5,
            font: helvetica,
            color: rgb(0.4, 0.45, 0.5),
        });

        // Bottom border
        currentPage.drawLine({
            start: { x: margin, y: currentY - rowHeight },
            end: { x: margin + printableWidth, y: currentY - rowHeight },
            thickness: 0.5,
            color: rgb(0.8, 0.82, 0.86),
        });

        // Vertical separators
        for (let j = 0; j <= 4; j++) {
            const x = j === 4 ? margin + printableWidth : colPositions[j];
            currentPage.drawLine({
                start: { x, y: currentY },
                end: { x, y: currentY - rowHeight },
                thickness: 0.5,
                color: rgb(0.8, 0.82, 0.86),
            });
        }
    } else {
        // Draw rows for each comment
        for (let index = 0; index < comments.length; index++) {
            const comment = comments[index];
            const lines2Text = wrapText(comment.text, colWidths[1] - 12, helvetica, 8);

            // Try to embed attachment image for this comment
            let embeddedImg = null;
            let imgDrawW = 0, imgDrawH = 0;
            const IMG_MAX_W = colWidths[1] - 14;
            const IMG_MAX_H = 80;
            if (comment.attachmentBytes && comment.attachmentMime) {
                try {
                    if (comment.attachmentMime === 'image/jpeg' || comment.attachmentMime === 'image/jpg') {
                        embeddedImg = await pdfDoc.embedJpg(comment.attachmentBytes);
                    } else if (comment.attachmentMime === 'image/png') {
                        embeddedImg = await pdfDoc.embedPng(comment.attachmentBytes);
                    } else {
                        // Convert via canvas to JPEG for other types (gif, bmp, webp)
                        const blob = new Blob([comment.attachmentBytes], { type: comment.attachmentMime });
                        const url = URL.createObjectURL(blob);
                        const jpegBytes = await new Promise((res) => {
                            const img2 = new Image();
                            img2.onload = () => {
                                URL.revokeObjectURL(url);
                                const cv = document.createElement('canvas');
                                cv.width = img2.naturalWidth; cv.height = img2.naturalHeight;
                                cv.getContext('2d').drawImage(img2, 0, 0);
                                cv.toBlob(b => b ? b.arrayBuffer().then(ab => res(new Uint8Array(ab))).catch(() => res(null)) : res(null), 'image/jpeg', 0.85);
                            };
                            img2.onerror = () => { URL.revokeObjectURL(url); res(null); };
                            img2.src = url;
                        });
                        if (jpegBytes) embeddedImg = await pdfDoc.embedJpg(jpegBytes);
                    }

                    if (embeddedImg) {
                        const nat = embeddedImg.size();
                        const scale = Math.min(IMG_MAX_W / nat.width, IMG_MAX_H / nat.height, 1);
                        imgDrawW = nat.width  * scale;
                        imgDrawH = nat.height * scale;
                    }
                } catch (imgErr) {
                    console.warn('Could not embed attachment image in sheet:', imgErr.message);
                    embeddedImg = null;
                }
            }

            // Calculate cell and row heights
            const minRowHeight = 70;
            const commentTextHeight = (lines2Text.length * 10) + 25;
            const imgHeight = embeddedImg ? imgDrawH + 10 : 0;
            const rowHeight = Math.max(minRowHeight, commentTextHeight + imgHeight);

            // Check if page break is needed
            if (!currentPage || (currentY - rowHeight < bottomMargin)) {
                addNewSheetPage();
            }

            // Alternating backgrounds
            const rowBg = index % 2 === 0 ? rgb(1, 1, 1) : rgb(0.98, 0.98, 0.99);
            currentPage.drawRectangle({
                x: margin, y: currentY - rowHeight,
                width: printableWidth, height: rowHeight, color: rowBg,
            });

            // Column 1: Ref / Page
            const targetPageRef = originalPageRefs[comment.page - 1];
            const pageText = `Page ${comment.page}`;
            const linkColor = rgb(0.1, 0.45, 0.88);

            currentPage.drawText(pageText, {
                x: colPositions[0] + 6, y: currentY - 18,
                size: 8.5, font: helveticaBold, color: linkColor,
            });
            const textWidth = helveticaBold.widthOfTextAtSize(pageText, 8.5);
            currentPage.drawLine({
                start: { x: colPositions[0] + 6, y: currentY - 19.5 },
                end:   { x: colPositions[0] + 6 + textWidth, y: currentY - 19.5 },
                thickness: 0.5, color: linkColor,
            });
            currentPage.drawText(`#${index + 1}`, {
                x: colPositions[0] + 6, y: currentY - 30,
                size: 8, font: helvetica, color: rgb(0.47, 0.55, 0.67),
            });

            // GoTo link annotation
            if (targetPageRef) {
                const linkAnnotation = pdfDoc.context.obj({
                    Type: 'Annot', Subtype: 'Link',
                    Rect: [colPositions[0], currentY - rowHeight, colPositions[0] + colWidths[0], currentY],
                    Border: [0, 0, 0],
                    Dest: comment.rect
                        ? [targetPageRef, 'XYZ', comment.rect[0] - 20, comment.rect[3] + 20, null]
                        : [targetPageRef, 'XYZ', null, null, null],
                });
                const linkRef = pdfDoc.context.register(linkAnnotation);
                if (!currentPage.node.has(PDFName.of('Annots'))) {
                    currentPage.node.set(PDFName.of('Annots'), pdfDoc.context.obj([]));
                }
                const annots = pdfDoc.context.lookup(currentPage.node.get(PDFName.of('Annots')));
                annots.push(linkRef);
            }

            // Column 2: Comment Details (Author + Text + optional image)
            currentPage.drawText(`By: ${comment.author}`, {
                x: colPositions[1] + 6, y: currentY - 15,
                size: 8, font: helveticaBold, color: rgb(0.09, 0.14, 0.25),
            });

            let textY = currentY - 26;
            for (const line of lines2Text) {
                currentPage.drawText(line, {
                    x: colPositions[1] + 6, y: textY,
                    size: 8, font: helvetica, color: rgb(0.2, 0.27, 0.38),
                });
                textY -= 10;
            }

            // Draw embedded image below the text if present
            if (embeddedImg) {
                const imgX = colPositions[1] + 6;
                const imgY = textY - imgDrawH - 4;
                // Light border around the image
                currentPage.drawRectangle({
                    x: imgX - 1, y: imgY - 1,
                    width: imgDrawW + 2, height: imgDrawH + 2,
                    borderColor: rgb(0.75, 0.78, 0.84), borderWidth: 0.5,
                    color: rgb(1, 1, 1),
                });
                currentPage.drawImage(embeddedImg, {
                    x: imgX, y: imgY,
                    width: imgDrawW, height: imgDrawH,
                });
            }

            // Row borders
            currentPage.drawLine({
                start: { x: margin, y: currentY - rowHeight },
                end:   { x: margin + printableWidth, y: currentY - rowHeight },
                thickness: 0.5, color: rgb(0.8, 0.82, 0.86),
            });
            for (let j = 0; j <= 4; j++) {
                const x = j === 4 ? margin + printableWidth : colPositions[j];
                currentPage.drawLine({
                    start: { x, y: currentY },
                    end:   { x, y: currentY - rowHeight },
                    thickness: 0.5, color: rgb(0.8, 0.82, 0.86),
                });
            }

            currentY -= rowHeight;
        }
    }

    // Add page numbers at bottom of each sheet page
    const totalSheets = sheetPages.length;
    for (let i = 0; i < totalSheets; i++) {
        sheetPages[i].drawText(`Comment Resolution Sheet - Page ${i + 1} of ${totalSheets}`, {
            x: margin,
            y: 22,
            size: 8,
            font: helvetica,
            color: rgb(0.47, 0.55, 0.67),
        });
    }

    return totalSheets;
}

/**
 * Processes a PDF buffer, appends a signature to original pages and/or inserts a comment resolution sheet.
 * 
 * @param {ArrayBuffer} pdfBuffer - The original PDF file buffer
 * @param {ArrayBuffer|null} signatureBuffer - The signature image buffer (optional)
 * @param {string|null} signatureType - Mime type of the image (optional)
 * @param {object} options - Options object, e.g. { generateResolutionSheet: boolean }
 * @returns {Promise<Uint8Array>} - The processed PDF as a byte array
 */
/**
 * Helper to parse custom page ranges (e.g. "1-3, 5, 8-10") into an array of page numbers.
 * Page numbers are 1-based.
 */
export function parsePageRange(rangeStr, totalPages) {
    const pagesSet = new Set();
    if (!rangeStr) return [];
    
    const cleanStr = rangeStr.replace(/\s+/g, '');
    const parts = cleanStr.split(',');

    for (const part of parts) {
        if (!part) continue;
        
        if (part.includes('-')) {
            const [startStr, endStr] = part.split('-');
            const start = parseInt(startStr, 10);
            const end = parseInt(endStr, 10);
            
            if (!isNaN(start) && !isNaN(end)) {
                const s = Math.min(start, end);
                const e = Math.max(start, end);
                for (let i = s; i <= e; i++) {
                    if (i >= 1 && i <= totalPages) {
                        pagesSet.add(i);
                    }
                }
            }
        } else {
            const num = parseInt(part, 10);
            if (!isNaN(num) && num >= 1 && num <= totalPages) {
                pagesSet.add(num);
            }
        }
    }
    return Array.from(pagesSet).sort((a, b) => a - b);
}

export async function processSignedPDF(pdfBuffer, signatureBuffer, signatureType, options = {}) {
    // Load the PDF
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    let sheetPagesCount = 0;
    if (options.generateResolutionSheet) {
        const comments = await extractCommentsFromPDF(pdfBuffer);
        sheetPagesCount = await generateCommentResolutionSheet(pdfDoc, comments);
    }

    // Embed and draw the signature block if image, name, or date are provided
    if (signatureBuffer || options.signerName || options.signerDate) {
        // Define size configurations: Small, Medium, Large
        const sizeSettings = {
            small: { maxWidth: 100, maxHeight: 50, fontSize: 6.5, lineHeight: 8.5, spacing: 4 },
            medium: { maxWidth: 150, maxHeight: 75, fontSize: 7.5, lineHeight: 10, spacing: 6 },
            large: { maxWidth: 200, maxHeight: 100, fontSize: 9, lineHeight: 12, spacing: 8 }
        };
        const activeSettings = sizeSettings[options.stampSize] || sizeSettings.medium;

        let signatureImageEmbed;
        let scaledWidth = 0;
        let scaledHeight = 0;

        if (signatureBuffer) {
            if (signatureType === 'image/png') {
                signatureImageEmbed = await pdfDoc.embedPng(signatureBuffer);
            } else if (signatureType === 'image/jpeg' || signatureType === 'image/jpg') {
                signatureImageEmbed = await pdfDoc.embedJpg(signatureBuffer);
            } else {
                throw new Error(`Unsupported image type: ${signatureType}. Please use PNG or JPG.`);
            }

            // Calculate scaled dimensions for the signature
            const maxWidth = activeSettings.maxWidth;
            const maxHeight = activeSettings.maxHeight;

            const { width, height } = signatureImageEmbed.scale(1);
            const scale = Math.min(maxWidth / width, maxHeight / height, 1);
            scaledWidth = width * scale;
            scaledHeight = height * scale;
        }

        // Initialize text details
        const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontSize = activeSettings.fontSize;
        const lineHeight = activeSettings.lineHeight;
        
        const textLines = [];
        if (options.signerName) {
            textLines.push(options.signerName); // No "Name: " prefix
        }
        if (options.signerDate) {
            textLines.push(`Date: ${options.signerDate}`);
        }

        const spacing = signatureBuffer && textLines.length > 0 ? activeSettings.spacing : 0;
        const textBlockHeight = textLines.length * lineHeight;
        const totalBlockHeight = scaledHeight + spacing + textBlockHeight;

        // Add signature to targeted ORIGINAL pages
        const pages = pdfDoc.getPages();
        const originalPagesCount = pages.length - sheetPagesCount;

        // Determine which 1-based original page numbers to sign
        const targetPages = [];
        if (options.pageSelectionType === 'odd') {
            for (let p = 1; p <= originalPagesCount; p++) {
                if (p % 2 !== 0) targetPages.push(p);
            }
        } else if (options.pageSelectionType === 'even') {
            for (let p = 1; p <= originalPagesCount; p++) {
                if (p % 2 === 0) targetPages.push(p);
            }
        } else if (options.pageSelectionType === 'custom' && options.customPageRange) {
            const parsed = parsePageRange(options.customPageRange, originalPagesCount);
            targetPages.push(...parsed);
        } else {
            // Default: 'all'
            for (let p = 1; p <= originalPagesCount; p++) {
                targetPages.push(p);
            }
        }

        // Draw signature/stamp on the target pages
        for (const p of targetPages) {
            const pageIndex = sheetPagesCount + p - 1;
            if (pageIndex < 0 || pageIndex >= pages.length) continue;

            const page = pages[pageIndex];
            const size = page.getSize();
            const W = size.width;
            const H = size.height;
            const rot = page.getRotation().angle || 0;

            let W_visual = W;
            let H_visual = H;
            if (rot === 90 || rot === 270) {
                W_visual = H;
                H_visual = W;
            }

            // Margins (visual space)
            const marginX = 50;
            const marginY = 50;

            // Calculate max width of the block to position it correctly
            let maxBlockWidth = scaledWidth;
            for (const line of textLines) {
                const w = helvetica.widthOfTextAtSize(line, fontSize);
                if (w > maxBlockWidth) maxBlockWidth = w;
            }

            // Coordinate transformation helper from visual layout to unrotated PDF coords
            const getPdfCoords = (X_vis, Y_vis) => {
                if (rot === 90) {
                    return {
                        x: Y_vis,
                        y: H - X_vis,
                        rotateAngle: -90
                    };
                } else if (rot === 180) {
                    return {
                        x: W - X_vis,
                        y: H - Y_vis,
                        rotateAngle: 180
                    };
                } else if (rot === 270) {
                    return {
                        x: W - Y_vis,
                        y: X_vis,
                        rotateAngle: 90
                    };
                } else {
                    return {
                        x: X_vis,
                        y: Y_vis,
                        rotateAngle: 0
                    };
                }
            };

            // Determine block visual bottom-left X-coordinate based on selected alignment
            let X_block;
            if (options.stampAlignment === 'left') {
                X_block = marginX;
            } else if (options.stampAlignment === 'center') {
                X_block = (W_visual - maxBlockWidth) / 2;
            } else {
                // Default: right
                X_block = W_visual - maxBlockWidth - marginX;
            }

            const Y_block = marginY;

            // 1. Draw text lines from bottom to top, centered relative to the block width
            let currentTextY = Y_block;
            for (let j = textLines.length - 1; j >= 0; j--) {
                const line = textLines[j];
                const textWidth = helvetica.widthOfTextAtSize(line, fontSize);
                const textX = X_block + (maxBlockWidth - textWidth) / 2;

                const pdfCoords = getPdfCoords(textX, currentTextY);

                page.drawText(line, {
                    x: pdfCoords.x,
                    y: pdfCoords.y,
                    size: fontSize,
                    font: helvetica,
                    color: rgb(0.2, 0.2, 0.2),
                    rotate: degrees(pdfCoords.rotateAngle)
                });
                currentTextY += lineHeight;
            }

            // 2. Draw signature image on top of the text block, centered relative to the block width
            if (signatureBuffer) {
                const imageY = Y_block + textBlockHeight + spacing;
                const imageX = X_block + (maxBlockWidth - scaledWidth) / 2;

                const pdfCoords = getPdfCoords(imageX, imageY);

                page.drawImage(signatureImageEmbed, {
                    x: pdfCoords.x,
                    y: pdfCoords.y,
                    width: scaledWidth,
                    height: scaledHeight,
                    opacity: 0.9,
                    rotate: degrees(pdfCoords.rotateAngle)
                });
            }
        }
    }

    // Serialize the PDFDocument to bytes (a Uint8Array)
    return await pdfDoc.save();
}

/**
 * Draw raw image bytes onto an off-screen canvas and re-encode as JPEG.
 * Supports any image format the browser can decode (JPEG, PNG, etc.)
 * Returns { bytes: Uint8Array, width, height } or null on failure.
 */
async function compressImageBytes(bytes, mimeType, quality, maxDimension) {
    return new Promise((resolve) => {
        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);

            // Clamp dimensions
            let w = img.naturalWidth  || img.width;
            let h = img.naturalHeight || img.height;
            if (!w || !h) { resolve(null); return; }

            if (w > maxDimension || h > maxDimension) {
                if (w >= h) {
                    h = Math.round((h * maxDimension) / w);
                    w = maxDimension;
                } else {
                    w = Math.round((w * maxDimension) / h);
                    h = maxDimension;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width  = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            // White background (important for transparent PNGs → JPEG)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);

            canvas.toBlob((blob2) => {
                if (!blob2) { resolve(null); return; }
                blob2.arrayBuffer().then(ab => {
                    resolve({ bytes: new Uint8Array(ab), width: w, height: h });
                }).catch(() => resolve(null));
            }, 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
    });
}

/**
 * Compresses an existing PDF buffer by downsampling embedded images via the
 * HTML5 Canvas API and saving with object streams.
 *
 * Works for both DCTDecode (JPEG) and FlateDecode (PNG / ZIP-wrapped) images.
 *
 * @param {ArrayBuffer|Uint8Array} pdfBuffer - The input PDF bytes
 * @returns {Promise<Uint8Array>} - Compressed PDF bytes
 */
export async function compressPDF(pdfBuffer) {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

    const QUALITY      = 0.6;   // JPEG re-encode quality (0–1)
    const MAX_DIM      = 1500;  // Max pixel side before downscaling

    let imagesProcessed = 0;

    const entries = pdfDoc.context.enumerateIndirectObjects();
    for (const [, obj] of entries) {
        // Must be a raw stream
        if (!(obj instanceof PDFRawStream) && obj.constructor.name !== 'PDFRawStream') continue;

        const dict = obj.dict;
        if (!dict) continue;

        // Must be an Image XObject
        const subtypeObj = dict.get(PDFName.of('Subtype'));
        if (!subtypeObj || subtypeObj.toString() !== '/Image') continue;

        // Get width / height
        const wObj = dict.get(PDFName.of('Width'));
        const hObj = dict.get(PDFName.of('Height'));
        if (!wObj || !hObj) continue;
        const imgW = Number(wObj.toString());
        const imgH = Number(hObj.toString());
        // Skip tiny thumbnails (< 32 px)
        if (!imgW || !imgH || imgW < 32 || imgH < 32) continue;

        // Determine filter(s)
        const filterObj = dict.get(PDFName.of('Filter'));
        if (!filterObj) continue;

        const filterNames = [];
        const fStr = filterObj.toString();
        if (fStr.startsWith('[')) {
            // PDFArray
            if (typeof filterObj.size === 'function') {
                for (let i = 0; i < filterObj.size(); i++) {
                    const item = filterObj.get(i);
                    if (item) filterNames.push(item.toString());
                }
            }
        } else {
            filterNames.push(fStr);
        }

        const isDCT   = filterNames.includes('/DCTDecode');
        const isFlate = filterNames.includes('/FlateDecode');

        if (!isDCT && !isFlate) continue; // skip unsupported filters

        try {
            let imageBytes;
            let mimeType;

            if (isDCT) {
                // Raw bytes ARE the JPEG data
                imageBytes = obj.contents;
                mimeType   = 'image/jpeg';
            } else {
                // FlateDecode — decompress first using pdf-lib helper
                try {
                    const decoded = decodePDFRawStream(obj).decode();
                    imageBytes = decoded;
                } catch (_) {
                    // If decode fails, skip this stream
                    continue;
                }
                // Check for common PNG signature in decoded bytes
                const colorSpace = dict.get(PDFName.of('ColorSpace'));
                const csStr = colorSpace ? colorSpace.toString() : '';
                const bitsPerComp = dict.get(PDFName.of('BitsPerComponent'));
                const bits = bitsPerComp ? Number(bitsPerComp.toString()) : 8;
                // Rebuild a minimal raw pixel blob the browser can load
                // Only handle simple 8-bit RGB / Gray images
                if (bits !== 8) continue;
                const channels = csStr.includes('RGB') ? 3 : csStr.includes('Gray') ? 1 : 0;
                if (!channels) continue;
                mimeType = channels === 3 ? 'image/png' : 'image/png';

                // Build a raw ImageData canvas instead of a blob
                const compressed = await (async () => {
                    return new Promise((res) => {
                        const canvas2 = document.createElement('canvas');
                        let cW = imgW, cH = imgH;
                        if (cW > MAX_DIM || cH > MAX_DIM) {
                            if (cW >= cH) { cH = Math.round(cH * MAX_DIM / cW); cW = MAX_DIM; }
                            else          { cW = Math.round(cW * MAX_DIM / cH); cH = MAX_DIM; }
                        }
                        canvas2.width  = cW;
                        canvas2.height = cH;
                        const ctx2 = canvas2.getContext('2d');
                        ctx2.fillStyle = '#ffffff';
                        ctx2.fillRect(0, 0, cW, cH);

                        // Build RGBA array from raw pixel bytes
                        const pixCount = imgW * imgH;
                        const rgba = new Uint8ClampedArray(pixCount * 4);
                        for (let p = 0; p < pixCount; p++) {
                            if (channels === 3) {
                                rgba[p*4]   = imageBytes[p*3];
                                rgba[p*4+1] = imageBytes[p*3+1];
                                rgba[p*4+2] = imageBytes[p*3+2];
                                rgba[p*4+3] = 255;
                            } else {
                                const v = imageBytes[p];
                                rgba[p*4]=rgba[p*4+1]=rgba[p*4+2]=v; rgba[p*4+3]=255;
                            }
                        }

                        // Draw original at full resolution then scale
                        const srcCanvas = document.createElement('canvas');
                        srcCanvas.width  = imgW;
                        srcCanvas.height = imgH;
                        const srcCtx = srcCanvas.getContext('2d');
                        srcCtx.putImageData(new ImageData(rgba, imgW, imgH), 0, 0);
                        ctx2.drawImage(srcCanvas, 0, 0, cW, cH);

                        canvas2.toBlob((b) => {
                            if (!b) { res(null); return; }
                            b.arrayBuffer().then(ab => res({ bytes: new Uint8Array(ab), width: cW, height: cH })).catch(() => res(null));
                        }, 'image/jpeg', QUALITY);
                    });
                })();

                if (!compressed || compressed.bytes.length >= obj.contents.length) continue;

                // Replace with JPEG
                obj.contents = compressed.bytes;
                dict.set(PDFName.of('Filter'),  PDFName.of('DCTDecode'));
                dict.set(PDFName.of('Width'),   PDFNumber.of(compressed.width));
                dict.set(PDFName.of('Height'),  PDFNumber.of(compressed.height));
                dict.set(PDFName.of('Length'),  PDFNumber.of(compressed.bytes.length));
                dict.delete(PDFName.of('DecodeParms'));
                imagesProcessed++;
                continue; // already handled
            }

            // DCTDecode path
            const result = await compressImageBytes(imageBytes, mimeType, QUALITY, MAX_DIM);
            if (!result || result.bytes.length >= imageBytes.length) continue;

            obj.contents = result.bytes;
            dict.set(PDFName.of('Length'),  PDFNumber.of(result.bytes.length));
            dict.set(PDFName.of('Width'),   PDFNumber.of(result.width));
            dict.set(PDFName.of('Height'),  PDFNumber.of(result.height));
            imagesProcessed++;
        } catch (err) {
            console.warn('Image compress skip:', err.message);
        }
    }

    console.log(`[compressPDF] Processed ${imagesProcessed} image(s).`);
    return await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
}

// ─── PDF Word & Text Editing Utilities ──────────────────────────────────────

/**
 * Converts a hex color string (e.g. #3b82f6) to pdf-lib rgb() color object.
 */
export function hexToRgb(hex) {
    if (!hex || hex === 'none' || hex === 'transparent') return null;
    let cleaned = hex.replace('#', '');
    if (cleaned.length === 3) {
        cleaned = cleaned.split('').map(c => c + c).join('');
    }
    const num = parseInt(cleaned, 16);
    if (isNaN(num)) return rgb(0, 0, 0);
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    return rgb(r, g, b);
}

/**
 * Maps font name strings to embedded StandardFonts in pdf-lib.
 */
export async function getStandardFont(pdfDoc, fontName) {
    switch (fontName) {
        case 'HelveticaBold':
        case 'Helvetica-Bold':
            return await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        case 'HelveticaOblique':
        case 'Helvetica-Oblique':
            return await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
        case 'TimesRoman':
        case 'Times-Roman':
            return await pdfDoc.embedFont(StandardFonts.TimesRoman);
        case 'TimesRomanBold':
        case 'Times-Bold':
            return await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
        case 'Courier':
            return await pdfDoc.embedFont(StandardFonts.Courier);
        case 'CourierBold':
        case 'Courier-Bold':
            return await pdfDoc.embedFont(StandardFonts.CourierBold);
        case 'Helvetica':
        default:
            return await pdfDoc.embedFont(StandardFonts.Helvetica);
    }
}

/**
 * Parses page range string (e.g. "1, 3-5") into a Set of 1-based page numbers.
 */
export function parsePageRanges(rangeStr, totalPages) {
    if (!rangeStr || typeof rangeStr !== 'string' || rangeStr.trim().toLowerCase() === 'all') {
        return new Set(Array.from({ length: totalPages }, (_, i) => i + 1));
    }
    const pages = new Set();
    const parts = rangeStr.split(',');
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        if (trimmed.includes('-')) {
            const [startStr, endStr] = trimmed.split('-');
            const start = parseInt(startStr, 10);
            const end = parseInt(endStr, 10);
            if (!isNaN(start) && !isNaN(end)) {
                for (let p = Math.max(1, start); p <= Math.min(totalPages, end); p++) {
                    pages.add(p);
                }
            }
        } else {
            const p = parseInt(trimmed, 10);
            if (!isNaN(p) && p >= 1 && p <= totalPages) {
                pages.add(p);
            }
        }
    }
    return pages.size > 0 ? pages : new Set(Array.from({ length: totalPages }, (_, i) => i + 1));
}

/**
 * Extracts all text spans, words, font sizes and precise coordinates from a PDF.
 * 
 * @param {ArrayBuffer|Uint8Array} pdfBuffer - Input PDF bytes
 * @returns {Promise<Object>} - Object with page count and pagesData containing extracted text items
 */
export async function extractTextItemsFromPDF(pdfBuffer) {
    const rawBytes = pdfBuffer instanceof Uint8Array ? pdfBuffer.slice() : new Uint8Array(pdfBuffer).slice();
    const loadingTask = pdfjsLib.getDocument({ 
        data: rawBytes,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
    });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    const pagesData = {};

    for (let p = 1; p <= numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent();
        const items = [];

        for (const item of textContent.items) {
            if (!item.str || !item.str.trim()) continue;
            const transform = item.transform; // [scaleX, skewY, skewX, scaleY, tx, ty]
            const tx = transform[4];
            const ty = transform[5];
            const fontSize = Math.hypot(transform[0], transform[1]) || item.height || 10;
            const width = item.width || (fontSize * item.str.length * 0.5);
            const height = fontSize;

            // In viewport coordinates (top-left origin)
            const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
            const canvasX = vx;
            const canvasY = vy - height;

            items.push({
                str: item.str,
                dir: item.dir,
                pdfX: tx,
                pdfY: ty,
                width: width,
                height: height,
                fontSize: fontSize,
                fontName: item.fontName,
                canvasX: canvasX,
                canvasY: canvasY,
                canvasWidth: width,
                canvasHeight: height,
                page: p
            });
        }

        pagesData[p] = {
            pageNum: p,
            pageWidth: viewport.width,
            pageHeight: viewport.height,
            rotation: viewport.rotation,
            items: items
        };
    }

    return { numPages, pages: pagesData };
}

/**
 * Scans a PDF for words/phrases based on search rules.
 * 
 * @param {ArrayBuffer|Uint8Array} pdfBuffer - Input PDF bytes
 * @param {Array<Object>} rules - Search rules [{ findText, replaceText, matchCase, matchWholeWord, targetPages }]
 * @returns {Promise<Array<Object>>} - Array of matched text occurrences with coordinates and snippets
 */
export async function findTextMatchesInPDF(pdfBuffer, rules = []) {
    const rulesList = Array.isArray(rules) ? rules : [rules];
    const textData = await extractTextItemsFromPDF(pdfBuffer);
    const results = [];

    for (let p = 1; p <= textData.numPages; p++) {
        const pageInfo = textData.pages[p];
        if (!pageInfo) continue;

        for (const rule of rulesList) {
            const findText = (rule.findText || '').trim();
            if (!findText) continue;

            const targetPages = parsePageRanges(rule.targetPages || 'all', textData.numPages);
            if (!targetPages.has(p)) continue;

            const matchCase = !!rule.matchCase;
            const matchWholeWord = !!rule.matchWholeWord;

            for (const item of pageInfo.items) {
                const itemStr = item.str;
                const searchStr = matchCase ? itemStr : itemStr.toLowerCase();
                const term = matchCase ? findText : findText.toLowerCase();

                let startIndex = 0;
                while (startIndex < searchStr.length) {
                    const matchIndex = searchStr.indexOf(term, startIndex);
                    if (matchIndex === -1) break;

                    // Check whole word if requested
                    if (matchWholeWord) {
                        const prevChar = matchIndex > 0 ? searchStr[matchIndex - 1] : ' ';
                        const nextChar = matchIndex + term.length < searchStr.length ? searchStr[matchIndex + term.length] : ' ';
                        const isWordBoundary = /\W/.test(prevChar) && /\W/.test(nextChar);
                        if (!isWordBoundary) {
                            startIndex = matchIndex + term.length;
                            continue;
                        }
                    }

                    // Calculate bounding box in PDF points
                    const charRatioStart = matchIndex / itemStr.length;
                    const charRatioWidth = term.length / itemStr.length;
                    const matchX = item.pdfX + (item.width * charRatioStart);
                    const matchWidth = Math.max(8, item.width * charRatioWidth);
                    const matchY = item.pdfY;
                    const matchHeight = item.height;

                    // Snippet context
                    const startSnippet = Math.max(0, matchIndex - 15);
                    const endSnippet = Math.min(itemStr.length, matchIndex + term.length + 15);
                    const snippet = (startSnippet > 0 ? '…' : '') + 
                                    itemStr.substring(startSnippet, endSnippet) + 
                                    (endSnippet < itemStr.length ? '…' : '');

                    results.push({
                        ruleId: rule.id,
                        page: p,
                        findText: findText,
                        replaceText: rule.replaceText || '',
                        matchedText: itemStr.substring(matchIndex, matchIndex + term.length),
                        snippet: snippet,
                        pdfX: matchX,
                        pdfY: matchY,
                        pdfWidth: matchWidth,
                        pdfHeight: matchHeight,
                        fontSize: item.fontSize,
                        fontFamily: rule.fontFamily || 'Helvetica',
                        textColor: rule.textColor || '#000000',
                        bgFill: rule.bgFill || '#ffffff',
                        canvasX: item.canvasX + (item.canvasWidth * charRatioStart),
                        canvasY: item.canvasY,
                        canvasWidth: matchWidth,
                        canvasHeight: matchHeight
                    });

                    startIndex = matchIndex + term.length;
                }
            }
        }
    }

    return results;
}

/**
 * Performs Find & Replace across a PDF, masking original text and drawing replacements.
 * 
 * @param {ArrayBuffer|Uint8Array} pdfBuffer - Input PDF bytes
 * @param {Array<Object>} rules - Search rules [{ findText, replaceText, matchCase, matchWholeWord, targetPages, fontFamily, textColor, bgFill }]
 * @returns {Promise<Uint8Array>} - Modified PDF bytes
 */
export async function findAndReplaceTextInPDF(pdfBuffer, rules = []) {
    const rawBytes = pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer);
    const pdfDoc = await PDFDocument.load(rawBytes, { ignoreEncryption: true });
    const matches = await findTextMatchesInPDF(rawBytes, rules);

    if (matches.length === 0) {
        return rawBytes;
    }

    // Cache embedded fonts
    const fontCache = {};
    const getFont = async (fontName) => {
        if (!fontCache[fontName]) {
            fontCache[fontName] = await getStandardFont(pdfDoc, fontName);
        }
        return fontCache[fontName];
    };

    const pages = pdfDoc.getPages();

    for (const match of matches) {
        const pageIdx = match.page - 1;
        if (pageIdx < 0 || pageIdx >= pages.length) continue;
        const page = pages[pageIdx];

        // 1. Draw whiteout / background mask over original word
        if (match.bgFill && match.bgFill !== 'transparent' && match.bgFill !== 'none') {
            const bgColor = hexToRgb(match.bgFill) || rgb(1, 1, 1);
            page.drawRectangle({
                x: match.pdfX - 1,
                y: match.pdfY - 2,
                width: match.pdfWidth + 2,
                height: match.pdfHeight + 4,
                color: bgColor
            });
        }

        // 2. Draw replacement text
        if (match.replaceText) {
            const embeddedFont = await getFont(match.fontFamily || 'Helvetica');
            const sanitizedText = sanitizeTextForWinAnsi(match.replaceText);
            const textColor = hexToRgb(match.textColor) || rgb(0, 0, 0);
            const fontSize = match.fontSize || 10;

            page.drawText(sanitizedText, {
                x: match.pdfX,
                y: match.pdfY,
                size: fontSize,
                font: embeddedFont,
                color: textColor
            });
        }
    }

    return await pdfDoc.save();
}

/**
 * Applies visual studio edits (word replacements, custom text boxes, whiteout boxes, blackout redactions).
 * 
 * @param {ArrayBuffer|Uint8Array} pdfBuffer - Input PDF bytes
 * @param {Object} pageEdits - Structured edits per page { [pageNum]: [edits] }
 * @returns {Promise<Uint8Array>} - Modified PDF bytes
 */
export async function applyVisualEditsToPDF(pdfBuffer, pageEdits = {}) {
    const rawBytes = pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer);
    const pdfDoc = await PDFDocument.load(rawBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();

    const fontCache = {};
    const getFont = async (fontName) => {
        if (!fontCache[fontName]) {
            fontCache[fontName] = await getStandardFont(pdfDoc, fontName);
        }
        return fontCache[fontName];
    };

    for (const [pageNumStr, edits] of Object.entries(pageEdits)) {
        const pageNum = parseInt(pageNumStr, 10);
        const pageIndex = pageNum - 1;
        if (pageIndex < 0 || pageIndex >= pages.length || !Array.isArray(edits)) continue;
        const page = pages[pageIndex];

        for (const edit of edits) {
            if (edit.type === 'replace_word' || edit.type === 'text_box') {
                // Background mask
                if (edit.bgFill && edit.bgFill !== 'transparent' && edit.bgFill !== 'none') {
                    const bgColor = hexToRgb(edit.bgFill) || rgb(1, 1, 1);
                    page.drawRectangle({
                        x: edit.pdfX - 1,
                        y: edit.pdfY - 2,
                        width: edit.pdfWidth + 2,
                        height: edit.pdfHeight + 4,
                        color: bgColor
                    });
                }
                // Text overlay
                if (edit.text) {
                    const font = await getFont(edit.fontFamily || 'Helvetica');
                    const color = hexToRgb(edit.textColor) || rgb(0, 0, 0);
                    const size = edit.fontSize || 12;
                    page.drawText(sanitizeTextForWinAnsi(edit.text), {
                        x: edit.pdfX,
                        y: edit.pdfY,
                        size: size,
                        font: font,
                        color: color
                    });
                }
            } else if (edit.type === 'whiteout') {
                const color = hexToRgb(edit.color || '#ffffff') || rgb(1, 1, 1);
                page.drawRectangle({
                    x: edit.pdfX,
                    y: edit.pdfY,
                    width: edit.pdfWidth,
                    height: edit.pdfHeight,
                    color: color
                });
            } else if (edit.type === 'redact') {
                const color = hexToRgb(edit.color || '#000000') || rgb(0, 0, 0);
                page.drawRectangle({
                    x: edit.pdfX,
                    y: edit.pdfY,
                    width: edit.pdfWidth,
                    height: edit.pdfHeight,
                    color: color
                });
            }
        }
    }

    return await pdfDoc.save();
}

export async function renderPdfPageToCanvas(pdfBuffer, pageNum, canvas, scale = 1.5) {
    if (!canvas) return null;
    const rawBytes = pdfBuffer instanceof Uint8Array ? pdfBuffer.slice() : new Uint8Array(pdfBuffer).slice();
    const loadingTask = pdfjsLib.getDocument({ 
        data: rawBytes,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
    });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: scale });
    const outputScale = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    const renderContext = {
        canvasContext: ctx,
        viewport: viewport,
        transform: transform
    };

    await page.render(renderContext).promise;
    return { width: viewport.width, height: viewport.height, scale, page, viewport, numPages: pdf.numPages };
}



