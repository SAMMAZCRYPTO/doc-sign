import { PDFDocument } from 'pdf-lib';

/**
 * Processes a PDF buffer and appends a signature image to the bottom right of each page.
 * 
 * @param {ArrayBuffer} pdfBuffer - The original PDF file buffer
 * @param {ArrayBuffer} signatureBuffer - The signature image buffer
 * @param {string} signatureType - Mime type of the image (e.g., 'image/png' or 'image/jpeg')
 * @returns {Promise<Uint8Array>} - The signed PDF as a byte array
 */
export async function processSignedPDF(pdfBuffer, signatureBuffer, signatureType) {
    // Load the PDF
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Embed the signature image based on its type
    let signatureImageEmbed;
    if (signatureType === 'image/png') {
        signatureImageEmbed = await pdfDoc.embedPng(signatureBuffer);
    } else if (signatureType === 'image/jpeg' || signatureType === 'image/jpg') {
        signatureImageEmbed = await pdfDoc.embedJpg(signatureBuffer);
    } else {
        throw new Error(`Unsupported image type: ${signatureType}. Please use PNG or JPG.`);
    }

    // Calculate scaled dimensions for the signature
    // Assuming a max width of 150px and max height of 75px
    const maxWidth = 150;
    const maxHeight = 75;

    let { width, height } = signatureImageEmbed.scale(1);
    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    const scaledWidth = width * scale;
    const scaledHeight = height * scale;

    // Add signature to each page
    const pages = pdfDoc.getPages();
    for (const page of pages) {
        const { width: pageWidth, height: pageHeight } = page.getSize();

        // Position: Bottom Right with 50px margin
        const marginX = 50;
        const marginY = 50;

        const x = pageWidth - scaledWidth - marginX;
        const y = marginY; // 0,0 is bottom left in pdf-lib

        page.drawImage(signatureImageEmbed, {
            x,
            y,
            width: scaledWidth,
            height: scaledHeight,
            opacity: 0.9,
        });
    }

    // Serialize the PDFDocument to bytes (a Uint8Array)
    return await pdfDoc.save();
}
