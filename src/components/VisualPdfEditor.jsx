import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
    X, Type, Eraser, Square, MousePointer, Plus, Minus, Trash2, 
    Undo2, Redo2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, 
    Check, Download, RefreshCw, Eye, Sparkles
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { pdfjsLib } from '../utils/pdfWorkerInit';
import { applyVisualEditsToPDF, matchPdfStandardFont } from '../utils/pdfProcessor';

export default function VisualPdfEditor({ file, onClose, onSave }) {
    const [numPages, setNumPages] = useState(1);
    const [currentPage, setCurrentPage] = useState(1);
    const [scale, setScale] = useState(1.3);
    const [loading, setLoading] = useState(true);
    const [rendering, setRendering] = useState(false);
    const [saving, setSaving] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [activeTool, setActiveTool] = useState('select'); // 'select' | 'text' | 'whiteout' | 'redact'
    const [showHighlights, setShowHighlights] = useState(true);
    
    // Edits per page { [pageNum]: [ { id, type, pdfX, pdfY, pdfWidth, pdfHeight, ... } ] }
    const [pageEdits, setPageEdits] = useState({});
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // Text items on active page
    const [pageTextItems, setPageTextItems] = useState([]);
    const [pageDimensions, setPageDimensions] = useState({ width: 595, height: 842 });

    // Active INLINE editing item (rendered directly on the canvas)
    const [activeInlineEdit, setActiveInlineEdit] = useState(null);
    // { editId, isNew, originalText, text, fontSize, fontFamily, fontName, textColor, bgFill, pdfX, pdfY, pdfWidth, pdfHeight, boxX, boxY, boxW, boxH }
    const [inlineInputWidth, setInlineInputWidth] = useState(80);
    const inlineSizerRef = useRef(null);

    // Drawing state for drag-to-create rectangles
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawStart, setDrawStart] = useState(null);
    const [currentDrawBox, setCurrentDrawBox] = useState(null);

    const canvasRef = useRef(null);
    const overlayRef = useRef(null);
    const pdfDocRef = useRef(null);
    const originalPdfBytesRef = useRef(null);
    const renderTaskRef = useRef(null);
    const currentViewportRef = useRef(null);
    const isRenderingRef = useRef(false);
    const pendingRenderRef = useRef(false);
    const inlineInputRef = useRef(null);

    // 1. Load PDF Document once on mount
    useEffect(() => {
        let isMounted = true;
        async function loadPdf() {
            setLoading(true);
            try {
                const buffer = await file.arrayBuffer();
                originalPdfBytesRef.current = new Uint8Array(buffer);
                
                const loadingTask = pdfjsLib.getDocument({ 
                    data: originalPdfBytesRef.current.slice(),
                    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
                    cMapPacked: true,
                    standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
                });
                
                const pdf = await loadingTask.promise;
                if (!isMounted) return;

                pdfDocRef.current = pdf;
                setNumPages(pdf.numPages || 1);
            } catch (err) {
                console.error('Failed to load PDF for visual editor:', err);
                alert('Could not open PDF in editor: ' + err.message);
                onClose();
            } finally {
                if (isMounted) setLoading(false);
            }
        }
        loadPdf();
        return () => { 
            isMounted = false; 
            if (renderTaskRef.current) {
                try { renderTaskRef.current.cancel(); } catch (_) {}
            }
        };
    }, [file, onClose]);

    // 2. Safe page rendering
    const renderPage = useCallback(async () => {
        if (!pdfDocRef.current || !canvasRef.current) return;

        if (isRenderingRef.current) {
            if (renderTaskRef.current) {
                try { renderTaskRef.current.cancel(); } catch (_) {}
            }
            pendingRenderRef.current = true;
            return;
        }

        isRenderingRef.current = true;
        setRendering(true);

        try {
            const page = await pdfDocRef.current.getPage(currentPage);
            const viewport = page.getViewport({ scale: scale });
            currentViewportRef.current = viewport;

            const outputScale = window.devicePixelRatio || 1;
            const canvas = canvasRef.current;
            if (!canvas) return;

            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            canvas.style.width = Math.floor(viewport.width) + 'px';
            canvas.style.height = Math.floor(viewport.height) + 'px';

            setPageDimensions({ width: viewport.width, height: viewport.height });

            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
            const renderContext = {
                canvasContext: ctx,
                viewport: viewport,
                transform: transform
            };

            const renderTask = page.render(renderContext);
            renderTaskRef.current = renderTask;
            await renderTask.promise;
            renderTaskRef.current = null;

            // Extract text items
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

                const [x1, y1] = viewport.convertToViewportPoint(tx, ty + height);
                const [x2, y2] = viewport.convertToViewportPoint(tx + width, ty);

                // Auto-detect matching PDF Standard Font
                const matchedFont = matchPdfStandardFont(item.fontName);

                items.push({
                    id: `w_${items.length}`,
                    str: item.str,
                    pdfX: tx,
                    pdfY: ty,
                    width: width,
                    height: height,
                    fontSize: fontSize,
                    fontName: item.fontName,
                    matchedFont: matchedFont,
                    boxX: Math.min(x1, x2),
                    boxY: Math.min(y1, y2),
                    boxW: Math.max(8, Math.abs(x2 - x1)),
                    boxH: Math.max(10, Math.abs(y2 - y1))
                });
            }

            setPageTextItems(items);
        } catch (err) {
            if (err?.name !== 'RenderingCancelledException') {
                console.error('Error rendering page:', err);
            }
        } finally {
            isRenderingRef.current = false;
            setRendering(false);

            if (pendingRenderRef.current) {
                pendingRenderRef.current = false;
                renderPage();
            }
        }
    }, [currentPage, scale]);

    useEffect(() => {
        if (!loading && pdfDocRef.current) {
            renderPage();
        }
    }, [loading, currentPage, scale, renderPage]);

    // Auto-focus and select all text in the inline input when opened
    useEffect(() => {
        if (activeInlineEdit && inlineInputRef.current) {
            inlineInputRef.current.focus();
            inlineInputRef.current.select();
        }
        // Also reset width to sizer width when edit opens
        if (activeInlineEdit && inlineSizerRef.current) {
            setInlineInputWidth(Math.max(inlineSizerRef.current.offsetWidth + 20, activeInlineEdit.boxW + 4));
        }
    }, [activeInlineEdit]);

    // Grow the input width as the user types using hidden sizer
    useEffect(() => {
        if (activeInlineEdit && inlineSizerRef.current) {
            const sizerW = inlineSizerRef.current.offsetWidth;
            setInlineInputWidth(Math.max(sizerW + 20, activeInlineEdit.boxW + 4));
        }
    }, [activeInlineEdit?.text, activeInlineEdit?.fontSize, activeInlineEdit?.fontFamily, scale]);

    // Push state to undo history
    const pushHistory = (newEdits) => {
        const nextHistory = history.slice(0, historyIndex + 1);
        nextHistory.push(newEdits);
        setHistory(nextHistory);
        setHistoryIndex(nextHistory.length - 1);
        setPageEdits(newEdits);
    };

    const handleUndo = () => {
        if (historyIndex > 0) {
            setHistoryIndex(historyIndex - 1);
            setPageEdits(history[historyIndex - 1]);
            setActiveInlineEdit(null);
        } else if (historyIndex === 0) {
            setHistoryIndex(-1);
            setPageEdits({});
            setActiveInlineEdit(null);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            setHistoryIndex(historyIndex + 1);
            setPageEdits(history[historyIndex + 1]);
            setActiveInlineEdit(null);
        }
    };

    const canvasToPdfCoords = (cx, cy, cWidth, cHeight) => {
        const viewport = currentViewportRef.current;
        if (!viewport) return { pdfX: cx, pdfY: cy, pdfWidth: cWidth, pdfHeight: cHeight };
        
        const [pdfX1, pdfY1] = viewport.convertToPdfPoint(cx, cy);
        const [pdfX2, pdfY2] = viewport.convertToPdfPoint(cx + cWidth, cy + cHeight);

        return {
            pdfX: Math.min(pdfX1, pdfX2),
            pdfY: Math.min(pdfY1, pdfY2),
            pdfWidth: Math.abs(pdfX2 - pdfX1),
            pdfHeight: Math.abs(pdfY2 - pdfY1)
        };
    };

    // Click on a word -> open INLINE editor with auto-detected matching font & size
    const handleWordClick = (item, e) => {
        if (e) e.stopPropagation();

        // Commit any previous inline edit
        if (activeInlineEdit) {
            commitInlineEdit();
        }

        // Check if there is already an applied edit at this word
        const existingEdit = (pageEdits[currentPage] || []).find(ed => 
            Math.abs(ed.pdfX - item.pdfX) < 3 && Math.abs(ed.pdfY - item.pdfY) < 3
        );

        const detectedFont = item.matchedFont || matchPdfStandardFont(item.fontName);
        const preciseSize = item.fontSize ? Number(item.fontSize.toFixed(1)) : 11;

        setActiveInlineEdit({
            editId: existingEdit ? existingEdit.id : `edit_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            isNew: !existingEdit,
            originalText: item.str,
            text: existingEdit ? existingEdit.text : item.str,
            fontSize: existingEdit ? existingEdit.fontSize : preciseSize,
            fontFamily: existingEdit ? existingEdit.fontFamily : detectedFont,
            fontName: item.fontName,
            textColor: existingEdit ? existingEdit.textColor : '#000000',
            bgFill: '#ffffff',
            pdfX: item.pdfX,
            pdfY: item.pdfY,
            pdfWidth: item.width,
            pdfHeight: item.height,
            boxX: item.boxX,
            boxY: item.boxY,
            boxW: item.boxW,
            boxH: item.boxH
        });
    };

    // Commit current inline edit
    const commitInlineEdit = () => {
        if (!activeInlineEdit) return;

        const { editId, text, originalText, fontSize, fontFamily, fontName, textColor, bgFill, pdfX, pdfY, pdfWidth, pdfHeight } = activeInlineEdit;

        if (text && text.trim()) {
            const newEdit = {
                id: editId,
                type: 'replace_word',
                originalText: originalText,
                text: text,
                fontSize: Number(fontSize) || 11,
                fontFamily: fontFamily || matchPdfStandardFont(fontName),
                fontName: fontName,
                textColor: textColor || '#000000',
                bgFill: bgFill || '#ffffff',
                pdfX: pdfX,
                pdfY: pdfY,
                pdfWidth: pdfWidth,
                pdfHeight: pdfHeight,
                page: currentPage
            };

            const currentList = (pageEdits[currentPage] || []).filter(item => item.id !== editId);
            const nextEdits = {
                ...pageEdits,
                [currentPage]: [...currentList, newEdit]
            };

            pushHistory(nextEdits);
        }

        setActiveInlineEdit(null);
    };

    // Click on canvas overlay
    const handleOverlayMouseDown = (e) => {
        if (activeTool === 'select') {
            if (activeInlineEdit) {
                commitInlineEdit();
            }
            return;
        }

        const rect = overlayRef.current.getBoundingClientRect();
        const startX = e.clientX - rect.left;
        const startY = e.clientY - rect.top;

        setIsDrawing(true);
        setDrawStart({ x: startX, y: startY });
        setCurrentDrawBox({ x: startX, y: startY, width: 0, height: 0 });
    };

    const handleOverlayMouseMove = (e) => {
        if (!isDrawing || !drawStart) return;
        const rect = overlayRef.current.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        const x = Math.min(drawStart.x, currentX);
        const y = Math.min(drawStart.y, currentY);
        const width = Math.abs(currentX - drawStart.x);
        const height = Math.abs(currentY - drawStart.y);

        setCurrentDrawBox({ x, y, width, height });
    };

    const handleOverlayMouseUp = () => {
        if (!isDrawing || !currentDrawBox) {
            setIsDrawing(false);
            setDrawStart(null);
            setCurrentDrawBox(null);
            return;
        }

        const { x, y, width, height } = currentDrawBox;

        if (width >= 8 && height >= 8) {
            const { pdfX, pdfY, pdfWidth, pdfHeight } = canvasToPdfCoords(x, y, width, height);
            const editId = `edit_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

            if (activeTool === 'whiteout') {
                const newEdit = {
                    id: editId,
                    type: 'whiteout',
                    color: '#ffffff',
                    pdfX, pdfY, pdfWidth, pdfHeight,
                    page: currentPage
                };
                const currentList = pageEdits[currentPage] || [];
                pushHistory({ ...pageEdits, [currentPage]: [...currentList, newEdit] });
            } else if (activeTool === 'redact') {
                const newEdit = {
                    id: editId,
                    type: 'redact',
                    color: '#000000',
                    pdfX, pdfY, pdfWidth, pdfHeight,
                    page: currentPage
                };
                const currentList = pageEdits[currentPage] || [];
                pushHistory({ ...pageEdits, [currentPage]: [...currentList, newEdit] });
            } else if (activeTool === 'text') {
                // Drop inline editable text box directly on page
                setActiveInlineEdit({
                    editId: editId,
                    isNew: true,
                    originalText: '',
                    text: 'Type text here',
                    fontSize: 12,
                    fontFamily: 'Helvetica',
                    textColor: '#000000',
                    bgFill: 'transparent',
                    pdfX, pdfY, pdfWidth, pdfHeight,
                    boxX: x, boxY: y, boxW: width, boxH: height
                });
            }
        }

        setIsDrawing(false);
        setDrawStart(null);
        setCurrentDrawBox(null);
    };

    // Remove a specific edit
    const handleRemoveEdit = (editId, e) => {
        if (e) e.stopPropagation();
        const currentList = pageEdits[currentPage] || [];
        const nextList = currentList.filter(item => item.id !== editId);
        const nextEdits = {
            ...pageEdits,
            [currentPage]: nextList
        };
        pushHistory(nextEdits);
        if (activeInlineEdit && activeInlineEdit.editId === editId) {
            setActiveInlineEdit(null);
        }
    };

    // Clear all edits on current page
    const handleClearCurrentPage = () => {
        if (!pageEdits[currentPage] || pageEdits[currentPage].length === 0) return;
        if (confirm(`Remove all edits on Page ${currentPage}?`)) {
            const nextEdits = { ...pageEdits };
            delete nextEdits[currentPage];
            pushHistory(nextEdits);
            setActiveInlineEdit(null);
        }
    };

    // Save and compile all edits into a new PDF File
    const handleSaveDocument = async () => {
        if (activeInlineEdit) {
            commitInlineEdit();
        }

        setSaving(true);
        try {
            const totalEditsCount = Object.values(pageEdits).reduce((sum, arr) => sum + (arr ? arr.length : 0), 0);
            const updatedBytes = await applyVisualEditsToPDF(originalPdfBytesRef.current, pageEdits);
            const updatedFile = new File([updatedBytes], file.name, { type: 'application/pdf' });
            
            onSave(updatedFile, totalEditsCount);
            onClose();
        } catch (err) {
            console.error('Error saving edited PDF:', err);
            alert('Failed to apply edits: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    // Direct Download Button
    const handleDirectDownload = async () => {
        if (activeInlineEdit) {
            commitInlineEdit();
        }

        setDownloading(true);
        try {
            const updatedBytes = await applyVisualEditsToPDF(originalPdfBytesRef.current, pageEdits);
            const blob = new Blob([updatedBytes], { type: 'application/pdf' });
            const outName = file.name.replace(/\.pdf$/i, '') + '_Edited.pdf';
            saveAs(blob, outName);
        } catch (err) {
            console.error('Download error:', err);
            alert('Could not generate PDF download: ' + err.message);
        } finally {
            setDownloading(false);
        }
    };

    // Helper for CSS font styling — maps PDF standard font names to CSS equivalents
    const getCssFontFamily = (fontFamily) => {
        if (!fontFamily) return 'Arial, Helvetica, sans-serif';
        const f = fontFamily.toLowerCase();
        if (f.includes('times') || f.includes('roman') || f.includes('serif')) return '"Times New Roman", Times, serif';
        if (f.includes('courier') || f.includes('mono')) return '"Courier New", Courier, monospace';
        return 'Arial, Helvetica, sans-serif';
    };

    const getCssFontWeight = (fontFamily) => {
        if (!fontFamily) return 400;
        const f = fontFamily.toLowerCase();
        return (f.includes('bold') || f.includes('heavy') || f.includes('black')) ? 700 : 400;
    };

    const getCssFontStyle = (fontFamily) => {
        if (!fontFamily) return 'normal';
        const f = fontFamily.toLowerCase();
        return (f.includes('italic') || f.includes('oblique')) ? 'italic' : 'normal';
    };

    const currentEdits = pageEdits[currentPage] || [];
    const totalEditsCount = Object.values(pageEdits).reduce((sum, arr) => sum + (arr ? arr.length : 0), 0);
    const viewport = currentViewportRef.current;

    return (
        <div className="visual-editor-overlay animate-fade-in">
            {/* Top Navigation Bar */}
            <div className="visual-editor-header">
                <div className="editor-brand">
                    <div className="brand-badge">
                        <Type size={18} color="var(--accent-color)" />
                    </div>
                    <div>
                        <h2 className="editor-title">{file.name}</h2>
                        <span className="editor-subtitle">
                            Pixel-Perfect PDF Studio • {totalEditsCount} change{totalEditsCount === 1 ? '' : 's'} staged
                        </span>
                    </div>
                </div>

                {/* Page Navigation & Zoom Controls */}
                <div className="editor-center-controls">
                    <div className="page-nav-pill">
                        <button 
                            className="btn-icon" 
                            disabled={currentPage <= 1 || rendering}
                            onClick={() => { 
                                if (activeInlineEdit) commitInlineEdit();
                                setCurrentPage(prev => Math.max(1, prev - 1)); 
                            }}
                            title="Previous Page"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <span className="page-indicator">
                            Page {currentPage} of {numPages}
                        </span>
                        <button 
                            className="btn-icon" 
                            disabled={currentPage >= numPages || rendering}
                            onClick={() => { 
                                if (activeInlineEdit) commitInlineEdit();
                                setCurrentPage(prev => Math.min(numPages, prev + 1)); 
                            }}
                            title="Next Page"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>

                    <div className="zoom-pill">
                        <button 
                            className="btn-icon" 
                            disabled={scale <= 0.8 || rendering} 
                            onClick={() => {
                                if (activeInlineEdit) commitInlineEdit();
                                setScale(prev => Math.max(0.8, Number((prev - 0.2).toFixed(1))));
                            }}
                            title="Zoom Out"
                        >
                            <ZoomOut size={16} />
                        </button>
                        <span className="zoom-indicator">{Math.round(scale * 100)}%</span>
                        <button 
                            className="btn-icon" 
                            disabled={scale >= 2.4 || rendering} 
                            onClick={() => {
                                if (activeInlineEdit) commitInlineEdit();
                                setScale(prev => Math.min(2.4, Number((prev + 0.2).toFixed(1))));
                            }}
                            title="Zoom In"
                        >
                            <ZoomIn size={16} />
                        </button>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="editor-header-actions">
                    <button 
                        className="btn-icon" 
                        disabled={historyIndex < 0}
                        onClick={handleUndo}
                        title="Undo"
                    >
                        <Undo2 size={18} />
                    </button>
                    <button 
                        className="btn-icon" 
                        disabled={historyIndex >= history.length - 1}
                        onClick={handleRedo}
                        title="Redo"
                    >
                        <Redo2 size={18} />
                    </button>

                    <button 
                        className="btn btn-secondary flex-center gap-xs" 
                        onClick={handleDirectDownload}
                        disabled={downloading || loading}
                        style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}
                        title="Download modified PDF directly to your computer"
                    >
                        {downloading ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
                        <span>Download PDF</span>
                    </button>

                    <button 
                        className="btn btn-primary flex-center gap-xs" 
                        onClick={handleSaveDocument}
                        disabled={saving || loading}
                        style={{ padding: '0.45rem 1.1rem', fontSize: '0.85rem' }}
                    >
                        {saving ? (
                            <span className="animate-pulse">Applying...</span>
                        ) : (
                            <>
                                <Check size={16} />
                                <span>Save &amp; Close</span>
                            </>
                        )}
                    </button>

                    <button className="btn-icon close-btn" onClick={onClose} title="Close Editor">
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Secondary Toolbar (Editing Tools) */}
            <div className="visual-editor-toolbar">
                <div className="tools-group">
                    <button 
                        className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`}
                        onClick={() => { setActiveTool('select'); if (activeInlineEdit) commitInlineEdit(); }}
                        title="Click on any word on the document to edit it directly in place"
                    >
                        <MousePointer size={16} />
                        <span>Click to Edit Word</span>
                    </button>

                    <button 
                        className={`tool-btn ${activeTool === 'text' ? 'active' : ''}`}
                        onClick={() => { setActiveTool('text'); if (activeInlineEdit) commitInlineEdit(); }}
                        title="Drag a box to place a new text box"
                    >
                        <Type size={16} />
                        <span>Add Text Box</span>
                    </button>

                    <button 
                        className={`tool-btn ${activeTool === 'whiteout' ? 'active' : ''}`}
                        onClick={() => { setActiveTool('whiteout'); if (activeInlineEdit) commitInlineEdit(); }}
                        title="Drag a box to cleanly whiteout / erase existing text"
                    >
                        <Eraser size={16} />
                        <span>Whiteout Mask</span>
                    </button>

                    <button 
                        className={`tool-btn ${activeTool === 'redact' ? 'active' : ''}`}
                        onClick={() => { setActiveTool('redact'); if (activeInlineEdit) commitInlineEdit(); }}
                        title="Drag a box to blackout sensitive confidential data"
                    >
                        <Square size={16} />
                        <span>Redact (Blackout)</span>
                    </button>

                    <label style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                        <input 
                            type="checkbox"
                            checked={showHighlights}
                            onChange={(e) => setShowHighlights(e.target.checked)}
                        />
                        Word Outlines
                    </label>
                </div>

                <div className="toolbar-hint">
                    {activeTool === 'select' && (
                        <span>✨ <strong>Click directly on any word</strong> on the document below to edit it in matching font and size.</span>
                    )}
                    {activeTool === 'text' && (
                        <span>✨ <strong>Drag a rectangle</strong> on the document to place a new text box.</span>
                    )}
                    {activeTool === 'whiteout' && (
                        <span>✨ <strong>Drag a rectangle</strong> to whiteout / erase unwanted content.</span>
                    )}
                    {activeTool === 'redact' && (
                        <span>✨ <strong>Drag a rectangle</strong> to blackout private information.</span>
                    )}
                </div>

                {currentEdits.length > 0 && (
                    <button 
                        className="btn btn-secondary" 
                        onClick={handleClearCurrentPage}
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', color: 'var(--error-color)' }}
                    >
                        <Trash2 size={14} />
                        Clear Page {currentPage} ({currentEdits.length})
                    </button>
                )}
            </div>

            {/* Main Canvas Workspace */}
            <div className="visual-editor-workspace">
                {loading ? (
                    <div className="flex-center flex-col gap-md" style={{ padding: '4rem', opacity: 0.7 }}>
                        <RefreshCw size={36} className="animate-spin" color="var(--accent-color)" />
                        <p>Loading document in High Resolution…</p>
                    </div>
                ) : (
                    <div className="canvas-wrapper">
                        {/* High-DPI PDF Page Canvas */}
                        <canvas ref={canvasRef} className="pdf-render-canvas" />

                        {/* Interactive Vector / Text Hit Overlay */}
                        <div 
                            ref={overlayRef}
                            className={`canvas-interactive-overlay tool-${activeTool}`}
                            style={{
                                width: `${pageDimensions.width}px`,
                                height: `${pageDimensions.height}px`
                            }}
                            onMouseDown={handleOverlayMouseDown}
                            onMouseMove={handleOverlayMouseMove}
                            onMouseUp={handleOverlayMouseUp}
                        >
                            {/* 1. Word Hit Targets (Select Mode) */}
                            {activeTool === 'select' && showHighlights && pageTextItems.map((item) => (
                                <div
                                    key={item.id}
                                    className="word-hit-box"
                                    style={{
                                        left: `${item.boxX}px`,
                                        top: `${item.boxY}px`,
                                        width: `${item.boxW}px`,
                                        height: `${item.boxH}px`
                                    }}
                                    onClick={(e) => handleWordClick(item, e)}
                                    title={`Click to edit: "${item.str}" (Font: ${item.matchedFont})`}
                                />
                            ))}

                            {/* 2. Committed Active Edits on this page */}
                            {viewport && currentEdits.map((edit) => {
                                // If currently being edited inline, hide the static box
                                if (activeInlineEdit && activeInlineEdit.editId === edit.id) return null;

                                const [x1, y1] = viewport.convertToViewportPoint(edit.pdfX, edit.pdfY + edit.pdfHeight);
                                const [x2, y2] = viewport.convertToViewportPoint(edit.pdfX + edit.pdfWidth, edit.pdfY);
                                const boxX = Math.min(x1, x2);
                                const boxY = Math.min(y1, y2);
                                const boxW = Math.max(10, Math.abs(x2 - x1));
                                const boxH = Math.max(10, Math.abs(y2 - y1));

                                if (edit.type === 'whiteout') {
                                    return (
                                        <div
                                            key={edit.id}
                                            className="applied-edit-box whiteout-patch"
                                            style={{
                                                left: `${boxX}px`,
                                                top: `${boxY}px`,
                                                width: `${boxW}px`,
                                                height: `${boxH}px`,
                                                backgroundColor: edit.color || '#ffffff'
                                            }}
                                        >
                                            <button 
                                                className="remove-patch-btn" 
                                                onClick={(e) => handleRemoveEdit(edit.id, e)}
                                                title="Remove whiteout patch"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    );
                                }

                                if (edit.type === 'redact') {
                                    return (
                                        <div
                                            key={edit.id}
                                            className="applied-edit-box redact-patch"
                                            style={{
                                                left: `${boxX}px`,
                                                top: `${boxY}px`,
                                                width: `${boxW}px`,
                                                height: `${boxH}px`,
                                                backgroundColor: edit.color || '#000000'
                                            }}
                                        >
                                            <button 
                                                className="remove-patch-btn" 
                                                onClick={(e) => handleRemoveEdit(edit.id, e)}
                                                title="Remove redaction"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    );
                                }

                                if (edit.type === 'replace_word' || edit.type === 'text_box') {
                                    return (
                                        <div
                                            key={edit.id}
                                            className="applied-edit-box text-patch"
                                            style={{
                                                left: `${boxX - 1}px`,
                                                top: `${boxY - 1}px`,
                                                minWidth: `${boxW + 2}px`,
                                                minHeight: `${boxH + 2}px`,
                                                backgroundColor: edit.bgFill !== 'transparent' ? (edit.bgFill || '#ffffff') : 'transparent',
                                                color: edit.textColor || '#000000',
                                                fontSize: `${(edit.fontSize || 11) * scale}px`,
                                                fontFamily: getCssFontFamily(edit.fontFamily),
                                                fontWeight: getCssFontWeight(edit.fontFamily),
                                                fontStyle: getCssFontStyle(edit.fontFamily),
                                                lineHeight: 1,
                                                cursor: 'pointer',
                                                whiteSpace: 'nowrap',
                                                overflow: 'visible'
                                            }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleWordClick({
                                                    str: edit.text,
                                                    pdfX: edit.pdfX,
                                                    pdfY: edit.pdfY,
                                                    width: edit.pdfWidth,
                                                    height: edit.pdfHeight,
                                                    fontSize: edit.fontSize,
                                                    fontName: edit.fontName || edit.fontFamily,
                                                    matchedFont: edit.fontFamily,
                                                    boxX, boxY, boxW, boxH
                                                }, e);
                                            }}
                                        >
                                            <span style={{ whiteSpace: 'nowrap' }}>{edit.text}</span>
                                            <button 
                                                className="remove-patch-btn" 
                                                onClick={(e) => handleRemoveEdit(edit.id, e)}
                                                title="Remove edit"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    );
                                }

                                return null;
                            })}

                            {/* 3. Drag Selection Box Preview */}
                            {isDrawing && currentDrawBox && (
                                <div
                                    className={`drag-selection-box tool-${activeTool}`}
                                    style={{
                                        left: `${currentDrawBox.x}px`,
                                        top: `${currentDrawBox.y}px`,
                                        width: `${currentDrawBox.width}px`,
                                        height: `${currentDrawBox.height}px`
                                    }}
                                />
                            )}

                            {/* 4. TRUE IN-PLACE INLINE EDITING ELEMENT (DIRECT ON DOCUMENT) */}
                            {activeInlineEdit && (
                                <div 
                                    className="inline-edit-wrapper animate-scale-up"
                                    style={{
                                        left: `${activeInlineEdit.boxX - 2}px`,
                                        top: `${activeInlineEdit.boxY - 2}px`,
                                        zIndex: 200
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {/* Mini Attached Floating Format Toolbar */}
                                    <div className="inline-micro-toolbar" onMouseDown={(e) => e.stopPropagation()}>
                                        <select
                                            className="micro-select"
                                            value={activeInlineEdit.fontFamily}
                                            onChange={(e) => setActiveInlineEdit(prev => ({ ...prev, fontFamily: e.target.value }))}
                                            title="Font Family"
                                        >
                                            <option value="Helvetica">Helvetica (Arial / Sans)</option>
                                            <option value="HelveticaBold">Helvetica Bold</option>
                                            <option value="HelveticaOblique">Helvetica Italic</option>
                                            <option value="HelveticaBoldOblique">Helvetica Bold Italic</option>
                                            <option value="TimesRoman">Times Roman (Serif)</option>
                                            <option value="TimesRomanBold">Times Roman Bold</option>
                                            <option value="TimesRomanItalic">Times Roman Italic</option>
                                            <option value="TimesRomanBoldItalic">Times Bold Italic</option>
                                            <option value="Courier">Courier (Monospace)</option>
                                            <option value="CourierBold">Courier Bold</option>
                                        </select>

                                        {/* Font Size Step Controls */}
                                        <button 
                                            className="micro-btn" 
                                            onClick={() => setActiveInlineEdit(prev => ({ ...prev, fontSize: Math.max(6, Number((prev.fontSize - 0.5).toFixed(1))) }))}
                                            title="Decrease Font Size (-0.5pt)"
                                        >
                                            <Minus size={12} />
                                        </button>

                                        <input
                                            type="number"
                                            step="0.5"
                                            className="micro-number"
                                            min="6"
                                            max="72"
                                            value={activeInlineEdit.fontSize}
                                            onChange={(e) => setActiveInlineEdit(prev => ({ ...prev, fontSize: Number(e.target.value) }))}
                                            title="Font Size (Points)"
                                        />

                                        <button 
                                            className="micro-btn" 
                                            onClick={() => setActiveInlineEdit(prev => ({ ...prev, fontSize: Math.min(72, Number((prev.fontSize + 0.5).toFixed(1))) }))}
                                            title="Increase Font Size (+0.5pt)"
                                        >
                                            <Plus size={12} />
                                        </button>

                                        <input
                                            type="color"
                                            className="micro-color"
                                            value={activeInlineEdit.textColor}
                                            onChange={(e) => setActiveInlineEdit(prev => ({ ...prev, textColor: e.target.value }))}
                                            title="Text Color"
                                        />

                                        <button 
                                            className="micro-btn commit-btn"
                                            onClick={commitInlineEdit}
                                            title="Commit Change (Enter)"
                                        >
                                            <Check size={13} />
                                        </button>

                                        <button 
                                            className="micro-btn delete-btn"
                                            onClick={() => {
                                                handleRemoveEdit(activeInlineEdit.editId);
                                                setActiveInlineEdit(null);
                                            }}
                                            title="Discard (Esc)"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>

                                    {/* Hidden sizer span — mirrors the input text to measure true pixel width */}
                                    <span
                                        ref={inlineSizerRef}
                                        aria-hidden="true"
                                        style={{
                                            position: 'absolute',
                                            visibility: 'hidden',
                                            whiteSpace: 'pre',
                                            pointerEvents: 'none',
                                            fontSize: `${(activeInlineEdit.fontSize || 11) * scale}px`,
                                            fontFamily: getCssFontFamily(activeInlineEdit.fontFamily),
                                            fontWeight: getCssFontWeight(activeInlineEdit.fontFamily),
                                            fontStyle: getCssFontStyle(activeInlineEdit.fontFamily),
                                            letterSpacing: 'normal',
                                            padding: '0 4px'
                                        }}
                                    >
                                        {activeInlineEdit.text || ' '}
                                    </span>

                                    {/* Direct In-Place Input Box — auto-grows with text, matches PDF font exactly */}
                                    <input
                                        ref={inlineInputRef}
                                        type="text"
                                        className="direct-inline-input"
                                        value={activeInlineEdit.text}
                                        autoComplete="off"
                                        spellCheck="false"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => setActiveInlineEdit(prev => ({ ...prev, text: e.target.value }))}
                                        onKeyDown={(e) => {
                                            e.stopPropagation();
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                commitInlineEdit();
                                            } else if (e.key === 'Escape') {
                                                setActiveInlineEdit(null);
                                            }
                                        }}
                                        style={{
                                            fontSize: `${(activeInlineEdit.fontSize || 11) * scale}px`,
                                            fontFamily: getCssFontFamily(activeInlineEdit.fontFamily),
                                            fontWeight: getCssFontWeight(activeInlineEdit.fontFamily),
                                            fontStyle: getCssFontStyle(activeInlineEdit.fontFamily),
                                            color: activeInlineEdit.textColor,
                                            width: `${inlineInputWidth}px`,
                                            minWidth: `${activeInlineEdit.boxW + 4}px`,
                                            height: `${Math.max(activeInlineEdit.boxH + 4, (activeInlineEdit.fontSize || 11) * scale + 8)}px`,
                                            lineHeight: 1
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
