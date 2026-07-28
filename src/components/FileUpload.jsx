import React, { useCallback, useState } from 'react';
import { Upload, FilePlus, ImagePlus, X, Settings } from 'lucide-react';

export default function FileUpload({ 
    onPdfUpload, 
    onSignatureUpload, 
    signatureImage, 
    signerName, 
    onSignerNameChange, 
    signerDate, 
    onSignerDateChange, 
    stampAlignment,
    onStampAlignmentChange,
    generateSheetEnabled, 
    onToggleGenerateSheet 
}) {
    const [isDraggingPdf, setIsDraggingPdf] = useState(false);
    const [isDraggingSig, setIsDraggingSig] = useState(false);

    const handlePdfDrop = useCallback((e) => {
        e.preventDefault();
        setIsDraggingPdf(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files).filter(file => file.type === 'application/pdf');
            if (files.length > 0) {
                onPdfUpload(files);
            } else {
                alert('Please select valid PDF files.');
            }
        }
    }, [onPdfUpload]);

    const handlePdfUploadClick = (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            onPdfUpload(files);
        }
        // reset input
        e.target.value = null;
    };

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

    return (
        <>
            <div className="glass-panel card animate-fade-in" style={{ animationDelay: '0.2s' }}>
                <h2 className="card-title">
                    <FilePlus />
                    Upload PDFs
                </h2>
                <div
                    className={`dropzone ${isDraggingPdf ? 'active' : ''}`}
                    onDragOver={(e) => handleDragOver(e, setIsDraggingPdf)}
                    onDragLeave={(e) => handleDragLeave(e, setIsDraggingPdf)}
                    onDrop={handlePdfDrop}
                    onClick={() => document.getElementById('pdf-upload').click()}
                >
                    <Upload className="dropzone-icon" />
                    <h3 className="dropzone-title">Drag & drop PDFs here</h3>
                    <p className="dropzone-subtitle">or click to browse from your computer. You can select multiple files.</p>
                    <input
                        type="file"
                        id="pdf-upload"
                        accept="application/pdf"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handlePdfUploadClick}
                    />
                </div>
            </div>

            <div className="glass-panel card animate-fade-in" style={{ animationDelay: '0.3s' }}>
                <h2 className="card-title">
                    <ImagePlus />
                    Signature & Stamp Setup
                </h2>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
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
                                style={{ padding: '0 1rem', fontSize: '0.85rem' }}
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

                <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '0.5rem' }}>
                        Signature Block Preview
                    </label>
                    <div className="stamp-preview-box">
                        {signatureImage ? (
                            <img src={URL.createObjectURL(signatureImage)} alt="Signature Image" className="stamp-preview-image" />
                        ) : (
                            (!signerName && !signerDate) && (
                                <div style={{ opacity: 0.4, fontSize: '0.85rem', fontStyle: 'italic', width: '100%', textAlign: 'center', margin: 'auto' }}>
                                    No signature image or details entered.
                                </div>
                            )
                        )}
                        {(signerName || signerDate) && (
                            <div className="stamp-preview-text">
                                {signerName && <div style={{ fontWeight: 600 }}>{signerName}</div>}
                                {signerDate && <div>Date: {signerDate}</div>}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="glass-panel card animate-fade-in" style={{ animationDelay: '0.35s' }}>
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
        </>
    );
}
