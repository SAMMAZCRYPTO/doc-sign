import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
    X, Type, Eraser, Square, MousePointer, Plus, Trash2, 
    Undo2, Redo2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, 
    Check, Sparkles, RefreshCw, AlertCircle, Eye, Sliders, Search
} from 'lucide-react';
import { pdfjsLib } from '../utils/pdfWorkerInit';
import { applyVisualEditsToPDF } from '../utils/pdfProcessor';

export default function VisualPdfEditor({ file, onClose, onSave }) {
    const [numPages, setNumPages] = useState(1);
    const [currentPage, setCurrentPage] = useState(1);
    const [scale, setScale] = useState(1.3);
    const [loading, setLoading] = useState(true);
    const [rendering, setRendering] = useState(false);
    const [saving, setSaving] = useState(false);
    const [activeTool, setActiveTool] = useState('select'); // 'select' | 'text' | 'whiteout' | 'redact'
    const [showHighlights, setShowHighlights] = useState(true);
    
    // Edits per page { [pageNum]: [ { id, type, pdfX, pdfY, pdfWidth, pdfHeight, ... } ] }
    const [pageEdits, setPageEdits] = useState({});
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // Text items for the active page
    const [pageTextItems, setPageTextItems] = useState([]);
    const [pageDimensions, setPageDimensions] = useState({ width: 595, height: 842 });
    const [searchFilter, setSearchFilter] = useState('');

    // Active popup for editing a selected word
    const [activeWordPopup, setActiveWordPopup] = useState(null);
    const [wordInputText, setWordInputText] = useState('');
    const [wordFontFamily, setWordFontFamily] = useState('Helvetica');
    const [wordFontSize, setWordFontSize] = useState(11);
    const [wordTextColor, setWordTextColor] = useState('#000000');
    const [wordBgFill, setWordBgFill] = useState('#ffffff');

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

    // 2. Safe, queue-based page rendering
    const renderPage = useCallback(async () => {
        if (!pdfDocRef.current || !canvasRef.current) return;

        if (isRenderingRef.current) {
            // Cancel current task and flag a pending render
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

            // Extract text items for this page
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

                // Viewport coordinates
                const [x1, y1] = viewport.convertToViewportPoint(tx, ty + height);
                const [x2, y2] = viewport.convertToViewportPoint(tx + width, ty);

                items.push({
                    id: `w_${items.length}`,
                    str: item.str,
                    pdfX: tx,
                    pdfY: ty,
                    width: width,
                    height: height,
                    fontSize: fontSize,
                    fontName: item.fontName,
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
            setActiveWordPopup(null);
        } else if (historyIndex === 0) {
            setHistoryIndex(-1);
            setPageEdits({});
            setActiveWordPopup(null);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            setHistoryIndex(historyIndex + 1);
            setPageEdits(history[historyIndex + 1]);
            setActiveWordPopup(null);
        }
    };

    // Calculate PDF point coordinates from canvas overlay pixels
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

    // Click on a detected word in 'select' mode
    const handleWordClick = (item, e) => {
        if (e) e.stopPropagation();

        setActiveWordPopup({
            item,
            canvasX: item.boxX,
            canvasY: item.boxY,
            canvasW: item.boxW,
            canvasH: item.boxH
        });

        setWordInputText(item.str);
        setWordFontSize(Math.round(item.fontSize) || 11);
        setWordFontFamily(item.fontName?.toLowerCase().includes('bold') ? 'HelveticaBold' : 'Helvetica');
        setWordTextColor('#000000');
        setWordBgFill('#ffffff');
    };

    // Apply the active word replacement
    const handleApplyWordEdit = () => {
        if (!activeWordPopup || !wordInputText.trim()) return;

        const { item } = activeWordPopup;
        const editId = `edit_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

        const newEdit = {
            id: editId,
            type: 'replace_word',
            originalText: item.str,
            text: wordInputText,
            fontSize: Number(wordFontSize),
            fontFamily: wordFontFamily,
            textColor: wordTextColor,
            bgFill: wordBgFill,
            pdfX: item.pdfX,
            pdfY: item.pdfY,
            pdfWidth: item.width,
            pdfHeight: item.height,
            page: currentPage
        };

        const currentList = pageEdits[currentPage] || [];
        const nextEdits = {
            ...pageEdits,
            [currentPage]: [...currentList, newEdit]
        };

        pushHistory(nextEdits);
        setActiveWordPopup(null);
    };

    // Canvas overlay mouse events for drawing tools
    const handleOverlayMouseDown = (e) => {
        if (activeTool === 'select') {
            setActiveWordPopup(null);
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

            let newEdit = null;

            if (activeTool === 'whiteout') {
                newEdit = {
                    id: editId,
                    type: 'whiteout',
                    color: '#ffffff',
                    pdfX, pdfY, pdfWidth, pdfHeight,
                    page: currentPage
                };
            } else if (activeTool === 'redact') {
                newEdit = {
                    id: editId,
                    type: 'redact',
                    color: '#000000',
                    pdfX, pdfY, pdfWidth, pdfHeight,
                    page: currentPage
                };
            } else if (activeTool === 'text') {
                const userText = prompt('Enter text for this text box:', 'Sample Text');
                if (userText && userText.trim()) {
                    newEdit = {
                        id: editId,
                        type: 'text_box',
                        text: userText,
                        fontSize: 12,
                        fontFamily: 'Helvetica',
                        textColor: '#000000',
                        bgFill: 'transparent',
                        pdfX, pdfY, pdfWidth, pdfHeight,
                        page: currentPage
                    };
                }
            }

            if (newEdit) {
                const currentList = pageEdits[currentPage] || [];
                const nextEdits = {
                    ...pageEdits,
                    [currentPage]: [...currentList, newEdit]
                };
                pushHistory(nextEdits);
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
    };

    // Clear all edits on current page
    const handleClearCurrentPage = () => {
        if (!pageEdits[currentPage] || pageEdits[currentPage].length === 0) return;
        if (confirm(`Remove all edits on Page ${currentPage}?`)) {
            const nextEdits = { ...pageEdits };
            delete nextEdits[currentPage];
            pushHistory(nextEdits);
            setActiveWordPopup(null);
        }
    };

    // Save and compile all edits into a new PDF File
    const handleSaveDocument = async () => {
        setSaving(true);
        try {
            const totalEditsCount = Object.values(pageEdits).reduce((sum, arr) => sum + (arr ? arr.length : 0), 0);
            if (totalEditsCount === 0) {
                onClose();
                return;
            }

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

    const currentEdits = pageEdits[currentPage] || [];
    const totalEditsCount = Object.values(pageEdits).reduce((sum, arr) => sum + (arr ? arr.length : 0), 0);
    const viewport = currentViewportRef.current;

    const filteredWords = searchFilter.trim() 
        ? pageTextItems.filter(item => item.str.toLowerCase().includes(searchFilter.toLowerCase()))
        : [];

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
                            Visual Word &amp; Text Studio • {totalEditsCount} edit{totalEditsCount === 1 ? '' : 's'} staged
                        </span>
                    </div>
                </div>

                {/* Page Navigation & Zoom Controls */}
                <div className="editor-center-controls">
                    <div className="page-nav-pill">
                        <button 
                            className="btn-icon" 
                            disabled={currentPage <= 1 || rendering}
                            onClick={() => { setCurrentPage(prev => Math.max(1, prev - 1)); setActiveWordPopup(null); }}
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
                            onClick={() => { setCurrentPage(prev => Math.min(numPages, prev + 1)); setActiveWordPopup(null); }}
                            title="Next Page"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>

                    <div className="zoom-pill">
                        <button 
                            className="btn-icon" 
                            disabled={scale <= 0.8 || rendering} 
                            onClick={() => setScale(prev => Math.max(0.8, Number((prev - 0.2).toFixed(1))))}
                            title="Zoom Out"
                        >
                            <ZoomOut size={16} />
                        </button>
                        <span className="zoom-indicator">{Math.round(scale * 100)}%</span>
                        <button 
                            className="btn-icon" 
                            disabled={scale >= 2.4 || rendering} 
                            onClick={() => setScale(prev => Math.min(2.4, Number((prev + 0.2).toFixed(1))))}
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
                        className="btn btn-primary" 
                        onClick={handleSaveDocument}
                        disabled={saving || loading}
                        style={{ padding: '0.5rem 1.25rem', fontSize: '0.875rem' }}
                    >
                        {saving ? (
                            <span className="animate-pulse">Applying...</span>
                        ) : (
                            <>
                                <Check size={16} />
                                Save &amp; Apply Edits ({totalEditsCount})
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
                        onClick={() => { setActiveTool('select'); setActiveWordPopup(null); }}
                        title="Click on any word in the PDF to edit or replace it"
                    >
                        <MousePointer size={16} />
                        <span>Select &amp; Edit Words</span>
                    </button>

                    <button 
                        className={`tool-btn ${activeTool === 'text' ? 'active' : ''}`}
                        onClick={() => { setActiveTool('text'); setActiveWordPopup(null); }}
                        title="Drag a box anywhere to add a new custom text overlay"
                    >
                        <Type size={16} />
                        <span>Add Text Box</span>
                    </button>

                    <button 
                        className={`tool-btn ${activeTool === 'whiteout' ? 'active' : ''}`}
                        onClick={() => { setActiveTool('whiteout'); setActiveWordPopup(null); }}
                        title="Drag a box to cleanly whiteout / erase existing text or graphics"
                    >
                        <Eraser size={16} />
                        <span>Whiteout Mask</span>
                    </button>

                    <button 
                        className={`tool-btn ${activeTool === 'redact' ? 'active' : ''}`}
                        onClick={() => { setActiveTool('redact'); setActiveWordPopup(null); }}
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
                        <span>💡 <strong>Click any word</strong> on the page below to open the replacement popup.</span>
                    )}
                    {activeTool === 'text' && (
                        <span>💡 <strong>Click and drag a rectangle</strong> on the page to place a new text box.</span>
                    )}
                    {activeTool === 'whiteout' && (
                        <span>💡 <strong>Click and drag a rectangle</strong> to whiteout unwanted text.</span>
                    )}
                    {activeTool === 'redact' && (
                        <span>💡 <strong>Click and drag a rectangle</strong> to blackout private information.</span>
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
                            {/* 1. Detected Word Hit Boxes (Select Mode) */}
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
                                    title={`Click to edit: "${item.str}"`}
                                />
                            ))}

                            {/* 2. Rendered Active Edits for Current Page */}
                            {viewport && currentEdits.map((edit) => {
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
                                                left: `${boxX - 2}px`,
                                                top: `${boxY - 2}px`,
                                                minWidth: `${boxW + 4}px`,
                                                minHeight: `${boxH + 4}px`,
                                                backgroundColor: edit.bgFill !== 'transparent' ? (edit.bgFill || '#ffffff') : 'transparent',
                                                color: edit.textColor || '#000000',
                                                fontSize: `${(edit.fontSize || 11) * scale}px`,
                                                fontFamily: edit.fontFamily === 'Courier' ? 'monospace' : edit.fontFamily === 'TimesRoman' ? 'serif' : 'sans-serif',
                                                fontWeight: edit.fontFamily?.includes('Bold') ? 700 : 400
                                            }}
                                        >
                                            <span>{edit.text}</span>
                                            <button 
                                                className="remove-patch-btn" 
                                                onClick={(e) => handleRemoveEdit(edit.id, e)}
                                                title="Remove text edit"
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

                            {/* 4. Floating Word Edit Popover Modal */}
                            {activeWordPopup && (
                                <div 
                                    className="word-edit-popover animate-scale-up"
                                    style={{
                                        left: `${Math.min(pageDimensions.width - 280, Math.max(10, activeWordPopup.canvasX))}px`,
                                        top: `${Math.max(10, activeWordPopup.canvasY - 145)}px`
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="popover-header">
                                        <span className="popover-badge">Edit Word</span>
                                        <button className="btn-icon" onClick={() => setActiveWordPopup(null)}>
                                            <X size={14} />
                                        </button>
                                    </div>

                                    <div className="popover-body">
                                        <div className="original-label">
                                            Original: <em>"{activeWordPopup.item.str}"</em>
                                        </div>

                                        <input
                                            type="text"
                                            className="popover-input"
                                            value={wordInputText}
                                            onChange={(e) => setWordInputText(e.target.value)}
                                            placeholder="Replacement text…"
                                            autoFocus
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleApplyWordEdit(); }}
                                        />

                                        <div className="popover-row">
                                            <select 
                                                className="popover-select"
                                                value={wordFontFamily}
                                                onChange={(e) => setWordFontFamily(e.target.value)}
                                            >
                                                <option value="Helvetica">Helvetica</option>
                                                <option value="HelveticaBold">Helvetica Bold</option>
                                                <option value="TimesRoman">Times Roman</option>
                                                <option value="Courier">Courier</option>
                                            </select>

                                            <input 
                                                type="number"
                                                className="popover-num-input"
                                                min="6"
                                                max="72"
                                                value={wordFontSize}
                                                onChange={(e) => setWordFontSize(e.target.value)}
                                                title="Font size in points"
                                            />

                                            <input 
                                                type="color"
                                                className="popover-color-picker"
                                                value={wordTextColor}
                                                onChange={(e) => setWordTextColor(e.target.value)}
                                                title="Text Color"
                                            />
                                        </div>

                                        <div className="popover-row" style={{ marginTop: '0.4rem' }}>
                                            <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                                                <input 
                                                    type="checkbox"
                                                    checked={wordBgFill === '#ffffff'}
                                                    onChange={(e) => setWordBgFill(e.target.checked ? '#ffffff' : 'transparent')}
                                                />
                                                Whiteout original background
                                            </label>
                                        </div>
                                    </div>

                                    <div className="popover-footer">
                                        <button className="btn btn-secondary" onClick={() => setActiveWordPopup(null)} style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}>
                                            Cancel
                                        </button>
                                        <button className="btn btn-primary" onClick={handleApplyWordEdit} style={{ padding: '0.3rem 0.8rem', fontSize: '0.75rem' }}>
                                            Apply Edit
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
