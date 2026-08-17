import React, { useCallback, useState } from 'react';
import { ImagePlus, X, Settings, Upload, Type, Search, Plus, Trash2, Sliders, Edit3, Check, RefreshCw } from 'lucide-react';

export default function FileUpload({ 
    activeTab,
    onSignatureUpload, 
    signatureImage, 
    signerName, 
    onSignerNameChange, 
    signerDate, 
    onSignerDateChange, 
    stampAlignment, 
    onStampAlignmentChange,
    stampSize, 
    onStampSizeChange,
    pageSelectionType, 
    onPageSelectionTypeChange,
    customPageRange, 
    onCustomPageRangeChange,
    generateSheetEnabled, 
    onToggleGenerateSheet,
    compressEnabled, 
    onToggleCompress,
    signatureEnabled, 
    onToggleSignature,
    editWordsEnabled,
    onToggleEditWords,
    findReplaceRules = [],
    onFindReplaceRulesChange,
    onScanMatches,
    scannedMatches = [],
    scanningMatches = false,
    onOpenVisualEditor,
    pdfFiles = []
}) {
    const [isDraggingSig, setIsDraggingSig] = useState(false);

    // Visual scale adjustments for widescreen layout
    const previewSizes = {
        small: { boxMaxW: '200px', imgMaxH: '45px', imgMaxW: '100px', textFont: '0.65rem' },
        medium: { boxMaxW: '270px', imgMaxH: '65px', imgMaxW: '150px', textFont: '0.75rem' },
        large: { boxMaxW: '340px', imgMaxH: '85px', imgMaxW: '200px', textFont: '0.9rem' }
    };
    const activePreview = previewSizes[stampSize] || previewSizes.medium;

    const handleSigDrop = useCallback((e) => {
        e.preventDefault();
        setIsDraggingSig(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                onSignatureUpload(file);
            } else {
                alert('Please select an image file (PNG, JPG) for your signature.');
            }
        }
    }, [onSignatureUpload]);

    const handleSigUploadClick = (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            onSignatureUpload(files[0]);
        }
    };

    const handleDragOver = (e, setter) => {
        e.preventDefault();
        setter(true);
    };

    const handleDragLeave = (e, setter) => {
        e.preventDefault();
        setter(false);
    };

    if (activeTab === 'signature') {
        return (
            <div className="glass-panel card animate-fade-in" style={{ animationDelay: '0.1s' }}>
                <h2 className="card-title">
                    <ImagePlus />
                    Signature & Stamp Setup
                </h2>

                {/* Master Toggle */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderBottom: '1px solid var(--card-border)', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', paddingRight: '1rem' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Enable Signature & Stamp</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Apply signature image and stamp details to documents</span>
                        </div>
                        <div className="toggle-switch-wrapper">
                            <input
                                type="checkbox"
                                id="toggle-signature"
                                checked={signatureEnabled}
                                onChange={(e) => onToggleSignature(e.target.checked)}
                                className="toggle-checkbox"
                            />
                            <span className="toggle-slider"></span>
                        </div>
                    </label>
                </div>

                <div style={{ opacity: signatureEnabled ? 1 : 0.45, pointerEvents: signatureEnabled ? 'auto' : 'none', transition: 'var(--transition)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
                    <div className="input-group">
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '0.25rem' }}>Signer Name</label>
                        <input
                            type="text"
                            placeholder="Enter name to display below signature"
                            value={signerName}
                            onChange={(e) => onSignerNameChange(e.target.value)}
                            className="input-field"
                        />
                    </div>

                    <div className="input-group">
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '0.25rem' }}>Signature Date</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                                type="date"
                                value={signerDate}
                                onChange={(e) => onSignerDateChange(e.target.value)}
                                className="input-field"
                                style={{ flex: 1 }}
                            />
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '0 0.75rem', fontSize: '0.85rem' }}
                                onClick={() => {
                                    const today = new Date().toISOString().split('T')[0];
                                    onSignerDateChange(today);
                                }}
                            >
                                Today
                            </button>
                        </div>
                    </div>

                    <div className="input-group">
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '0.25rem' }}>Stamp Alignment</label>
                        <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.03)', padding: '0.2rem', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--card-border)' }}>
                            {['left', 'center', 'right'].map((align) => (
                                <button
                                    key={align}
                                    type="button"
                                    onClick={() => onStampAlignmentChange(align)}
                                    style={{
                                        flex: 1,
                                        padding: '0.4rem',
                                        background: stampAlignment === align ? 'var(--accent-gradient)' : 'transparent',
                                        color: stampAlignment === align ? 'white' : 'var(--text-secondary)',
                                        border: 'none',
                                        borderRadius: 'var(--border-radius-sm)',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem',
                                        textTransform: 'capitalize',
                                        fontWeight: 500,
                                        transition: 'var(--transition)'
                                    }}
                                >
                                    {align}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="input-group">
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '0.25rem' }}>Stamp Size</label>
                        <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.03)', padding: '0.2rem', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--card-border)' }}>
                            {['small', 'medium', 'large'].map((size) => (
                                <button
                                    key={size}
                                    type="button"
                                    onClick={() => onStampSizeChange(size)}
                                    style={{
                                        flex: 1,
                                        padding: '0.4rem',
                                        background: stampSize === size ? 'var(--accent-gradient)' : 'transparent',
                                        color: stampSize === size ? 'white' : 'var(--text-secondary)',
                                        border: 'none',
                                        borderRadius: 'var(--border-radius-sm)',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem',
                                        textTransform: 'capitalize',
                                        fontWeight: 500,
                                        transition: 'var(--transition)'
                                    }}
                                >
                                    {size}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '0.5rem' }}>
                        Signature/Stamp Image (Optional)
                    </label>
                    {signatureImage ? (
                        <div className="flex-center" style={{ justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--card-border)' }}>
                            <span className="file-name" style={{ fontSize: '0.85rem', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis' }} title={signatureImage.name}>
                                {signatureImage.name}
                            </span>
                            <button
                                className="file-remove"
                                onClick={() => onSignatureUpload(null)}
                                title="Remove signature image"
                                style={{ padding: '0.25rem' }}
                            >
                                <X size={16} />
                            </button>
                        </div>
                    ) : (
                        <div
                            className={`dropzone ${isDraggingSig ? 'active' : ''}`}
                            onDragOver={(e) => handleDragOver(e, setIsDraggingSig)}
                            onDragLeave={(e) => handleDragLeave(e, setIsDraggingSig)}
                            onDrop={handleSigDrop}
                            onClick={() => document.getElementById('sig-upload').click()}
                            style={{ padding: '1.5rem 1rem' }}
                        >
                            <Upload className="dropzone-icon" style={{ width: '32px', height: '32px', marginBottom: '0.25rem' }} />
                            <p className="dropzone-subtitle" style={{ margin: 0, fontSize: '0.8rem' }}>Drag & drop image here or click to browse</p>
                            <input
                                type="file"
                                id="sig-upload"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={handleSigUploadClick}
                            />
                        </div>
                    )}
                </div>

                <div style={{ borderTop: '1px solid var(--card-border)', paddingTop: '1.25rem', marginTop: '0.5rem', marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '0.75rem' }}>
                        Target Pages
                    </label>
                    <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.03)', padding: '0.2rem', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--card-border)', marginBottom: pageSelectionType === 'custom' ? '0.75rem' : '0' }}>
                        {['all', 'odd', 'even', 'custom'].map((type) => (
                            <button
                                key={type}
                                type="button"
                                onClick={() => onPageSelectionTypeChange(type)}
                                style={{
                                    flex: 1,
                                    padding: '0.4rem',
                                    background: pageSelectionType === type ? 'var(--accent-gradient)' : 'transparent',
                                    color: pageSelectionType === type ? 'white' : 'var(--text-secondary)',
                                    border: 'none',
                                    borderRadius: 'var(--border-radius-sm)',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    textTransform: 'capitalize',
                                    fontWeight: 500,
                                    transition: 'var(--transition)'
                                }}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                    {pageSelectionType === 'custom' && (
                        <div className="input-group animate-fade-in" style={{ marginTop: '0.5rem' }}>
                            <input
                                type="text"
                                placeholder="e.g. 1-3, 5, 7-9"
                                value={customPageRange}
                                onChange={(e) => onCustomPageRangeChange(e.target.value)}
                                className="input-field"
                                style={{ width: '100%' }}
                            />
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                Specify pages (1-based) from original documents. Separate groups with commas.
                            </span>
                        </div>
                    )}
                </div>

                <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '0.5rem' }}>
                        Signature Block Preview
                    </label>
                    <div className="stamp-preview-box" style={{ maxWidth: activePreview.boxMaxW }}>
                        {signatureImage ? (
                            <img src={URL.createObjectURL(signatureImage)} alt="Signature Image" className="stamp-preview-image" style={{ maxHeight: activePreview.imgMaxH, maxWidth: activePreview.imgMaxW }} />
                        ) : (
                            (!signerName && !signerDate) && (
                                <div style={{ opacity: 0.4, fontSize: '0.85rem', fontStyle: 'italic', width: '100%', textAlign: 'center', margin: 'auto' }}>
                                    No signature image or details entered.
                                </div>
                            )
                        )}
                        {(signerName || signerDate) && (
                            <div className="stamp-preview-text" style={{ fontSize: activePreview.textFont }}>
                                {signerName && <div style={{ fontWeight: 600 }}>{signerName}</div>}
                                {signerDate && <div>Date: {signerDate}</div>}
                            </div>
                        )}
                    </div>
                </div>
                </div>
            </div>
        );
    }

    if (activeTab === 'comments') {
        return (
            <div className="glass-panel card animate-fade-in" style={{ animationDelay: '0.1s' }}>
                <h2 className="card-title">
                    <Settings />
                    Processing Options
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', paddingRight: '1rem' }}>
                            <span style={{ fontWeight: 500, fontSize: '0.95rem' }}>Comment Resolution Sheet</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Scan for comments and prepend a resolution table page</span>
                        </div>
                        <div className="toggle-switch-wrapper">
                            <input
                                type="checkbox"
                                id="toggle-sheet"
                                checked={generateSheetEnabled}
                                onChange={(e) => onToggleGenerateSheet(e.target.checked)}
                                className="toggle-checkbox"
                            />
                            <span className="toggle-slider"></span>
                        </div>
                    </label>
                </div>
            </div>
        );
    }

    const handleAddRule = () => {
        const newRule = {
            id: Date.now(),
            findText: '',
            replaceText: '',
            matchCase: false,
            matchWholeWord: false,
            fontFamily: 'Helvetica',
            fontSize: '',
            textColor: '#000000',
            bgFill: '#ffffff',
            targetPages: 'all',
            showOptions: false
        };
        onFindReplaceRulesChange([...findReplaceRules, newRule]);
    };

    const handleUpdateRule = (id, field, value) => {
        const updated = findReplaceRules.map(r => r.id === id ? { ...r, [field]: value } : r);
        onFindReplaceRulesChange(updated);
    };

    const handleRemoveRule = (id) => {
        const updated = findReplaceRules.filter(r => r.id !== id);
        onFindReplaceRulesChange(updated.length > 0 ? updated : [{
            id: Date.now(),
            findText: '',
            replaceText: '',
            matchCase: false,
            matchWholeWord: false,
            fontFamily: 'Helvetica',
            fontSize: '',
            textColor: '#000000',
            bgFill: '#ffffff',
            targetPages: 'all',
            showOptions: false
        }]);
    };

    if (activeTab === 'edit') {
        return (
            <div className="glass-panel card animate-fade-in" style={{ animationDelay: '0.1s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                    <h2 className="card-title" style={{ margin: 0 }}>
                        <Type />
                        Edit Words &amp; Text
                    </h2>

                    {pdfFiles.length > 0 && onOpenVisualEditor && (
                        <button
                            type="button"
                            className="btn btn-secondary flex-center gap-xs"
                            onClick={() => onOpenVisualEditor(pdfFiles[0])}
                            style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem', background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-color)', borderColor: 'rgba(59, 130, 246, 0.3)' }}
                        >
                            <Edit3 size={14} />
                            Launch Visual Editor
                        </button>
                    )}
                </div>

                {/* Master Toggle */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '1.25rem', marginBottom: '1.25rem' }}>
                    <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', paddingRight: '1rem' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Enable Batch Find &amp; Replace</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Automatically find words or dates and replace them across documents</span>
                        </div>
                        <div className="toggle-switch-wrapper">
                            <input
                                type="checkbox"
                                id="toggle-edit-words"
                                checked={editWordsEnabled}
                                onChange={(e) => onToggleEditWords(e.target.checked)}
                                className="toggle-checkbox"
                            />
                            <span className="toggle-slider"></span>
                        </div>
                    </label>
                </div>

                <div style={{ opacity: editWordsEnabled ? 1 : 0.45, pointerEvents: editWordsEnabled ? 'auto' : 'none', transition: 'var(--transition)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
                        {findReplaceRules.map((rule, index) => (
                            <div key={rule.id} className="find-replace-rule-card glass-panel" style={{ padding: '1rem', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--border-radius-md)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr)) 40px', gap: '0.75rem', alignItems: 'center' }}>
                                    <div className="input-group">
                                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Find Word / Text</label>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="e.g. 2024 or Acme Corp"
                                            value={rule.findText}
                                            onChange={(e) => handleUpdateRule(rule.id, 'findText', e.target.value)}
                                            style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
                                        />
                                    </div>

                                    <div className="input-group">
                                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Replace With</label>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="e.g. 2025 or Summit Global"
                                            value={rule.replaceText}
                                            onChange={(e) => handleUpdateRule(rule.id, 'replaceText', e.target.value)}
                                            style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
                                        />
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%', paddingBottom: '2px' }}>
                                        <button
                                            type="button"
                                            className="btn-icon"
                                            onClick={() => handleRemoveRule(rule.id)}
                                            disabled={findReplaceRules.length === 1}
                                            title="Delete rule"
                                            style={{ opacity: findReplaceRules.length === 1 ? 0.3 : 0.8, color: 'var(--error-color)' }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>

                                {/* Options Accordion Toggle */}
                                <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <button
                                        type="button"
                                        className="btn-text flex-center gap-xs"
                                        onClick={() => handleUpdateRule(rule.id, 'showOptions', !rule.showOptions)}
                                        style={{ fontSize: '0.75rem', color: 'var(--accent-color)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                    >
                                        <Sliders size={12} />
                                        {rule.showOptions ? 'Hide Styling & Matching Options' : 'Customize Font, Color & Target Pages'}
                                    </button>
                                </div>

                                {rule.showOptions && (
                                    <div className="animate-fade-in" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--card-border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                                        <div className="input-group">
                                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Font Family</label>
                                            <select
                                                className="input"
                                                value={rule.fontFamily || 'Helvetica'}
                                                onChange={(e) => handleUpdateRule(rule.id, 'fontFamily', e.target.value)}
                                                style={{ padding: '0.4rem', fontSize: '0.75rem' }}
                                            >
                                                <option value="Helvetica">Helvetica</option>
                                                <option value="HelveticaBold">Helvetica Bold</option>
                                                <option value="TimesRoman">Times Roman</option>
                                                <option value="TimesRomanBold">Times Bold</option>
                                                <option value="Courier">Courier</option>
                                            </select>
                                        </div>

                                        <div className="input-group">
                                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Text Color</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input
                                                    type="color"
                                                    value={rule.textColor || '#000000'}
                                                    onChange={(e) => handleUpdateRule(rule.id, 'textColor', e.target.value)}
                                                    style={{ width: '32px', height: '32px', padding: '0', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none' }}
                                                />
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{rule.textColor || '#000000'}</span>
                                            </div>
                                        </div>

                                        <div className="input-group">
                                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Pages</label>
                                            <input
                                                type="text"
                                                className="input"
                                                placeholder="all, or 1, 3-5"
                                                value={rule.targetPages || 'all'}
                                                onChange={(e) => handleUpdateRule(rule.id, 'targetPages', e.target.value)}
                                                style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}
                                            />
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', justifyContent: 'center' }}>
                                            <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={rule.matchCase}
                                                    onChange={(e) => handleUpdateRule(rule.id, 'matchCase', e.target.checked)}
                                                />
                                                Match Case
                                            </label>
                                            <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={rule.matchWholeWord}
                                                    onChange={(e) => handleUpdateRule(rule.id, 'matchWholeWord', e.target.checked)}
                                                />
                                                Whole Word
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="btn btn-secondary flex-center gap-xs"
                            onClick={handleAddRule}
                            style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem' }}
                        >
                            <Plus size={14} />
                            Add Another Word Rule
                        </button>

                        {pdfFiles.length > 0 && onScanMatches && (
                            <button
                                type="button"
                                className="btn btn-secondary flex-center gap-xs"
                                onClick={onScanMatches}
                                disabled={scanningMatches}
                                style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem' }}
                            >
                                {scanningMatches ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                                {scanningMatches ? 'Scanning Documents…' : 'Scan & Preview Matches'}
                            </button>
                        )}
                    </div>

                    {/* Scanned Matches Preview Box */}
                    {scannedMatches && scannedMatches.length > 0 && (
                        <div className="scanned-matches-panel glass-panel animate-fade-in" style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: 'var(--border-radius-md)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--accent-color)' }}>
                                    Found {scannedMatches.length} match{scannedMatches.length === 1 ? '' : 'es'} across uploaded documents:
                                </span>
                            </div>
                            <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                {scannedMatches.map((m, idx) => (
                                    <div key={idx} style={{ fontSize: '0.75rem', padding: '0.35rem 0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>Page {m.page}: <em>"{m.snippet}"</em></span>
                                        <span style={{ color: 'var(--accent-color)', fontWeight: 500 }}>➔ "{m.replaceText}"</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return null;
}

