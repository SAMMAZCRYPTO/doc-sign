import React, { useCallback, useState } from 'react';
import { Upload, FilePlus, ImagePlus, X, Settings } from 'lucide-react';

export default function FileUpload({ onPdfUpload, onSignatureUpload, signatureImage, generateSheetEnabled, onToggleGenerateSheet }) {
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
                    {signatureImage ? 'Your Signature' : 'Upload Signature'}
                </h2>

                {signatureImage ? (
                    <div className="signature-preview glass-panel">
                        <div className="flex-center" style={{ justifyContent: 'space-between', padding: '0.5rem 1rem', borderBottom: '1px solid var(--card-border)' }}>
                            <span className="file-name" style={{ fontSize: '0.875rem' }}>{signatureImage.name}</span>
                            <button
                                className="file-remove"
                                onClick={() => onSignatureUpload(null)}
                                title="Remove signature"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div style={{ padding: '1.5rem' }}>
                            <img src={URL.createObjectURL(signatureImage)} alt="Signature Preview" />
                        </div>
                    </div>
                ) : (
                    <div
                        className={`dropzone ${isDraggingSig ? 'active' : ''}`}
                        onDragOver={(e) => handleDragOver(e, setIsDraggingSig)}
                        onDragLeave={(e) => handleDragLeave(e, setIsDraggingSig)}
                        onDrop={handleSigDrop}
                        onClick={() => document.getElementById('sig-upload').click()}
                    >
                        <Upload className="dropzone-icon" />
                        <h3 className="dropzone-title">Drop signature image</h3>
                        <p className="dropzone-subtitle">PNG format recommended for transparency</p>
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
