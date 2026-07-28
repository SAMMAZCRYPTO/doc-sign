import { PDFDocument, PDFName, PDFString, PDFHexString, rgb, StandardFonts } from 'pdf-lib';

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

                // Ignore links, widgets, popups, etc.
                if (['/Popup', '/Link', '/Widget'].includes(subtypeStr)) {
                    continue;
                }

                const contents = annotDict.get(PDFName.of('Contents'));
                if (contents) {
                    let text = '';
                    if (contents instanceof PDFString || contents instanceof PDFHexString) {
                        text = contents.decodeText();
                    } else if (typeof contents.decodeText === 'function') {
                        text = contents.decodeText();
                    } else {
                        text = contents.toString();
                    }

                    if (text && text.trim()) {
                        // Extract author (/T) if present
                        const authorObj = annotDict.get(PDFName.of('T'));
                        let author = '';
                        if (authorObj) {
                            if (authorObj instanceof PDFString || authorObj instanceof PDFHexString) {
                                author = authorObj.decodeText();
                            } else if (typeof authorObj.decodeText === 'function') {
                                author = authorObj.decodeText();
                            } else {
                                author = authorObj.toString();
                            }
                        }

                        // Extract visual bounding box (/Rect) if present
                        const rectObj = annotDict.get(PDFName.of('Rect'));
                        let rect = null;
                        if (rectObj) {
                            const lookupRect = pdfDoc.context.lookup(rectObj);
                            if (lookupRect && typeof lookupRect.asArray === 'function') {
                                rect = lookupRect.asArray().map(v => {
                                    return typeof v.asNumber === 'function' 
                                        ? v.asNumber() 
                                        : (v.value !== undefined ? v.value : Number(v));
                                });
                            }
                        }

                        comments.push({
                            page: pageNum,
                            subtype: subtypeStr.replace('/', ''),
                            text: sanitizeTextForWinAnsi(text.trim()),
                            author: sanitizeTextForWinAnsi(author.trim()) || 'Anonymous',
                            rect: rect
                        });
                    }
                }
            }
        }
        
        // Sort comments by page number
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
            
            // Calculate cell and row heights
            const minRowHeight = 70; // Provide enough blank space for responses
            const commentTextHeight = (lines2Text.length * 10) + 25; // 25pt for padding/author line
            const rowHeight = Math.max(minRowHeight, commentTextHeight);

            // Check if page break is needed
            if (!currentPage || (currentY - rowHeight < bottomMargin)) {
                addNewSheetPage();
            }

            // Alternating backgrounds
            const rowBg = index % 2 === 0 ? rgb(1, 1, 1) : rgb(0.98, 0.98, 0.99);
            currentPage.drawRectangle({
                x: margin,
                y: currentY - rowHeight,
                width: printableWidth,
                height: rowHeight,
                color: rowBg,
            });

            // Draw Column 1: Ref / Page (Underlined blue hyperlink to original comment)
            const targetPageRef = originalPageRefs[comment.page - 1];
            const pageText = `Page ${comment.page}`;
            const linkColor = rgb(0.1, 0.45, 0.88);

            currentPage.drawText(pageText, {
                x: colPositions[0] + 6,
                y: currentY - 18,
                size: 8.5,
                font: helveticaBold,
                color: linkColor,
            });

            // Underline
            const textWidth = helveticaBold.widthOfTextAtSize(pageText, 8.5);
            currentPage.drawLine({
                start: { x: colPositions[0] + 6, y: currentY - 19.5 },
                end: { x: colPositions[0] + 6 + textWidth, y: currentY - 19.5 },
                thickness: 0.5,
                color: linkColor,
            });

            currentPage.drawText(`#${index + 1}`, {
                x: colPositions[0] + 6,
                y: currentY - 30,
                size: 8,
                font: helvetica,
                color: rgb(0.47, 0.55, 0.67),
            });

            // Create and register GoTo page annotation
            if (targetPageRef) {
                const linkAnnotation = pdfDoc.context.obj({
                    Type: 'Annot',
                    Subtype: 'Link',
                    Rect: [
                        colPositions[0],
                        currentY - rowHeight,
                        colPositions[0] + colWidths[0],
                        currentY
                    ],
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

            // Draw Column 2: Comment Details (Author + Text)
            currentPage.drawText(`By: ${comment.author}`, {
                x: colPositions[1] + 6,
                y: currentY - 15,
                size: 8,
                font: helveticaBold,
                color: rgb(0.09, 0.14, 0.25),
            });

            let textY = currentY - 26;
            for (const line of lines2Text) {
                currentPage.drawText(line, {
                    x: colPositions[1] + 6,
                    y: textY,
                    size: 8,
                    font: helvetica,
                    color: rgb(0.2, 0.27, 0.38),
                });
                textY -= 10;
            }

            // Draw grid borders for current row
            // Bottom line
            currentPage.drawLine({
                start: { x: margin, y: currentY - rowHeight },
                end: { x: margin + printableWidth, y: currentY - rowHeight },
                thickness: 0.5,
                color: rgb(0.8, 0.82, 0.86),
            });

            // Vertical borders
            for (let j = 0; j <= 4; j++) {
                const x = j === 4 ? margin + printableWidth : colPositions[j];
                currentPage.drawLine({
                    start: { x, y: currentY },
                    end: { x, y: currentY - rowHeight },
                    thickness: 0.5,
                    color: rgb(0.8, 0.82, 0.86),
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
            const maxWidth = 150;
            const maxHeight = 75;

            const { width, height } = signatureImageEmbed.scale(1);
            const scale = Math.min(maxWidth / width, maxHeight / height, 1);
            scaledWidth = width * scale;
            scaledHeight = height * scale;
        }

        // Initialize text details
        const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontSize = 7.5;
        const lineHeight = 10;
        
        const textLines = [];
        if (options.signerName) {
            textLines.push(`Name: ${options.signerName}`);
        }
        if (options.signerDate) {
            textLines.push(`Date: ${options.signerDate}`);
        }

        const spacing = signatureBuffer && textLines.length > 0 ? 6 : 0;
        const textBlockHeight = textLines.length * lineHeight;
        const totalBlockHeight = scaledHeight + spacing + textBlockHeight;

        // Add signature to each of the ORIGINAL pages
        const pages = pdfDoc.getPages();
        // Since sheet pages were inserted at the beginning, we start signing from sheetPagesCount
        for (let i = sheetPagesCount; i < pages.length; i++) {
            const page = pages[i];
            const { width: pageWidth, height: pageHeight } = page.getSize();

            // Position: Bottom Right with 50px margin
            const marginX = 50;
            const marginY = 50;

            // Calculate max width of the block to position it correctly at the bottom-right corner
            let maxBlockWidth = scaledWidth;
            for (const line of textLines) {
                const w = helvetica.widthOfTextAtSize(line, fontSize);
                if (w > maxBlockWidth) maxBlockWidth = w;
            }

            const x = pageWidth - maxBlockWidth - marginX;
            const blockBottomY = marginY;

            // 1. Draw text lines from bottom to top, centered relative to the block width
            let currentTextY = blockBottomY;
            for (let j = textLines.length - 1; j >= 0; j--) {
                const line = textLines[j];
                const textWidth = helvetica.widthOfTextAtSize(line, fontSize);
                const textX = x + (maxBlockWidth - textWidth) / 2;

                page.drawText(line, {
                    x: textX,
                    y: currentTextY,
                    size: fontSize,
                    font: helvetica,
                    color: rgb(0.2, 0.2, 0.2),
                });
                currentTextY += lineHeight;
            }

            // 2. Draw signature image on top of the text block, centered relative to the block width
            if (signatureBuffer) {
                const imageY = blockBottomY + textBlockHeight + spacing;
                const imageX = x + (maxBlockWidth - scaledWidth) / 2;
                page.drawImage(signatureImageEmbed, {
                    x: imageX,
                    y: imageY,
                    width: scaledWidth,
                    height: scaledHeight,
                    opacity: 0.9,
                });
            }
        }
    }

    // Serialize the PDFDocument to bytes (a Uint8Array)
    return await pdfDoc.save();
}

