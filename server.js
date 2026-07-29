/**
 * DocSign — Local Word-to-PDF Conversion Server
 * 
 * Runs on http://localhost:3001
 * POST /convert  { multipart: file (.docx) }  →  PDF bytes
 * GET  /health   →  { ok: true, method: 'word' | 'libreoffice' | 'none' }
 *
 * Conversion priority:
 *   1. Microsoft Word via PowerShell COM automation (zero-loss, uses Word's own engine)
 *   2. LibreOffice CLI (soffice --headless --convert-to pdf)
 *   3. 503 — neither available (browser falls back to docx-preview)
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

const execAsync = promisify(exec);
const app = express();
const PORT = 3001;

// Allow any localhost/127.0.0.1 origin (Vite picks whatever port is free)
app.use(cors({ origin: /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// ─── Detect available conversion engine ─────────────────────────────────────

async function detectEngine() {
    // 1. Test if Word is available via PowerShell COM
    try {
        await execAsync(
            `powershell -NoProfile -NonInteractive -Command "` +
            `$app = New-Object -ComObject Word.Application; $app.Quit(); Write-Output 'ok'"`,
            { timeout: 8000 }
        );
        return 'word';
    } catch (_) { /* Word not available */ }

    // 2. Test if LibreOffice is installed
    const loPaths = [
        'soffice',
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
        '/usr/bin/soffice',
        '/usr/local/bin/soffice',
        '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    ];
    for (const lo of loPaths) {
        if (lo !== 'soffice' && !existsSync(lo)) continue;
        try {
            await execAsync(`"${lo}" --version`, { timeout: 5000 });
            return 'libreoffice';
        } catch (_) { /* not this path */ }
    }

    return 'none';
}

let ENGINE = null; // cached after first detection

// ─── Convert using Microsoft Word COM automation ─────────────────────────────

async function convertWithWord(inputPath, outputPath) {
    // Write a real .ps1 file — avoids ALL inline escaping issues
    // Use single-quoted PS strings so backslashes are literal
    const psContent = [
        `$ErrorActionPreference = 'Stop'`,
        `$inputFile  = '${inputPath.replace(/'/g, "''")}' `,
        `$outputFile = '${outputPath.replace(/'/g, "''")}' `,
        `$word = New-Object -ComObject Word.Application`,
        `$word.Visible = $false`,
        `$word.DisplayAlerts = 0`,
        `try {`,
        `    $doc = $word.Documents.Open($inputFile.Trim(), $false, $true)`,
        `    # ExportAsFixedFormat is more reliable than SaveAs2 for PDF`,
        `    $doc.ExportAsFixedFormat(`,
        `        $outputFile.Trim(),`,
        `        17,          # wdExportFormatPDF`,
        `        $false,      # OpenAfterExport`,
        `        0,           # OptimizeFor (print)`,
        `        0,           # Range (all)`,
        `        1,           # From`,
        `        1,           # To`,
        `        0,           # Item`,
        `        $true,       # IncludeDocProps`,
        `        $true,       # KeepIRM`,
        `        0,           # CreateBookmarks`,
        `        $true,       # DocStructureTags`,
        `        $true,       # BitmapMissingFonts`,
        `        $false       # UseISO19005_1`,
        `    )`,
        `    $doc.Close($false)`,
        `} catch {`,
        `    Write-Error $_.Exception.Message`,
        `    $word.Quit()`,
        `    exit 1`,
        `}`,
        `$word.Quit()`,
        `[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null`,
        `[System.GC]::Collect()`,
        `Write-Output 'done'`,
    ].join('\r\n');

    const psFile = inputPath.replace(/\.docx$/i, '.ps1');
    await writeFile(psFile, psContent, 'utf-8');

    try {
        const { stdout, stderr } = await execAsync(
            `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psFile}"`,
            { timeout: 120000 }
        );
        if (stderr && stderr.toLowerCase().includes('error')) {
            throw new Error(stderr.trim());
        }
    } finally {
        await unlink(psFile).catch(() => {});
    }
}

// ─── Convert using LibreOffice ────────────────────────────────────────────────

async function convertWithLibreOffice(inputPath, outputDir) {
    const loPaths = [
        'soffice',
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
        '/usr/bin/soffice',
        '/usr/local/bin/soffice',
        '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    ];

    let soffice = 'soffice';
    for (const p of loPaths) {
        if (p !== 'soffice' && existsSync(p)) { soffice = p; break; }
    }

    await execAsync(
        `"${soffice}" --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`,
        { timeout: 60000 }
    );
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
    if (!ENGINE) ENGINE = await detectEngine();
    res.json({ ok: ENGINE !== 'none', method: ENGINE });
});

app.post('/convert', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    if (!ENGINE) ENGINE = await detectEngine();

    if (ENGINE === 'none') {
        return res.status(503).json({
            error: 'No conversion engine available. Please install Microsoft Word or LibreOffice.',
            install: 'https://www.libreoffice.org/download/libreoffice/'
        });
    }

    // Write upload to temp file
    const tmpDir = await mkdtemp(join(tmpdir(), 'docsign-'));
    const inputPath  = join(tmpDir, req.file.originalname || 'document.docx');
    const outputPath = inputPath.replace(/\.docx$/i, '.pdf');

    try {
        await writeFile(inputPath, req.file.buffer);

        if (ENGINE === 'word') {
            await convertWithWord(inputPath, outputPath);
        } else {
            await convertWithLibreOffice(inputPath, tmpDir);
        }

        // Word sometimes appends .pdf to the stem, handle both paths
        let pdfPath = outputPath;
        if (!existsSync(pdfPath)) {
            // e.g. Word saved as "document.docx.pdf" instead of "document.pdf"
            const altPath = inputPath + '.pdf';
            if (existsSync(altPath)) pdfPath = altPath;
            else throw new Error(`PDF not found at expected path: ${outputPath}`);
        }

        const pdfBytes = await readFile(pdfPath);
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="${req.file.originalname?.replace(/\.docx$/i, '.pdf') || 'converted.pdf'}"`);
        res.send(pdfBytes);

        console.log(`[${ENGINE}] Converted: ${req.file.originalname} → ${(pdfBytes.length / 1024).toFixed(0)} KB`);
    } catch (err) {
        console.error('Conversion error:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        // Clean up all temp files in the temp dir
        await unlink(inputPath).catch(() => {});
        await unlink(outputPath).catch(() => {});
        await unlink(inputPath + '.pdf').catch(() => {});
    }
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, '127.0.0.1', async () => {
    ENGINE = await detectEngine();
    console.log(`\n  DocSign Conversion Server  →  http://localhost:${PORT}`);
    console.log(`  Conversion engine: ${ENGINE === 'word' ? '✓ Microsoft Word (COM)' : ENGINE === 'libreoffice' ? '✓ LibreOffice' : '✗ None detected'}`);
    if (ENGINE === 'none') {
        console.log('\n  ⚠  No engine found. Install LibreOffice (free):');
        console.log('     https://www.libreoffice.org/download/libreoffice/\n');
    }
});
