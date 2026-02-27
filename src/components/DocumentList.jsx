import React from 'react';
import { FileText, CheckCircle, AlertCircle, X, Download } from 'lucide-react';
import { saveAs } from 'file-saver';

export default function DocumentList({ files, processedFiles, onRemove, processing }) {

    const getProcessedStatus = (file) => {
        // A super simple matcher based on file name or instance for demo purposes.
        // For complete robustness, you'd match by unique file IDs.
        return processedFiles.find(p => p.originalFile === file);
    };

    const downloadFile = (processed) => {
        if (!processed || processed.status !== 'success') return;
        const blob = new Blob([processed.bytes], { type: 'application/pdf' });
        saveAs(blob, processed.signedName);
    };

    if (files.length === 0) {
        return (
            <div className="glass-panel card animate-fade-in" style={{ animationDelay: '0.4s' }}>
                <h2 className="card-title" style={{ marginBottom: 0 }}>
                    Uploaded Documents
                </h2>
                <div className="flex-center flex-col" style={{ padding: '3rem 0', opacity: 0.5 }}>
                    <FileText size={48} style={{ marginBottom: '1rem' }} />
                    <p>No documents uploaded yet</p>
                </div>
            </div>
        );
    }

    return (
        <div className="glass-panel card animate-fade-in" style={{ animationDelay: '0.4s' }}>
            <h2 className="card-title">
                <FileText />
                Documents ({files.length})
            </h2>

            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {files.map((file, index) => {
                    const processed = getProcessedStatus(file);

                    return (
                        <div key={`${file.name}-${index}`} className="file-item animate-fade-in" style={{ animationDelay: `${0.1 * index}s` }}>
                            <div className="file-info">
                                <FileText className="file-icon" size={24} />
                                <div style={{ overflow: 'hidden' }}>
                                    <div className="file-name" title={file.name}>{file.name}</div>
                                    <div className="file-size" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        {(file.size / 1024 / 1024).toFixed(2)} MB •

                                        {!processed && !processing && (
                                            <span className="status-badge status-pending">Ready</span>
                                        )}
                                        {processing && !processed && (
                                            <span className="status-badge status-processing">Processing...</span>
                                        )}
                                        {processed && processed.status === 'success' && (
                                            <span className="status-badge status-success flex-center gap-sm">
                                                <CheckCircle size={12} />
                                                Signed
                                            </span>
                                        )}
                                        {processed && processed.status === 'error' && (
                                            <span className="status-badge status-error flex-center gap-sm" title={processed.error}>
                                                <AlertCircle size={12} />
                                                Error
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex-center gap-md">
                                {processed && processed.status === 'success' && (
                                    <button
                                        className="btn btn-primary"
                                        style={{ padding: '0.5rem' }}
                                        onClick={() => downloadFile(processed)}
                                        title="Download Signed PDF"
                                    >
                                        <Download size={16} />
                                    </button>
                                )}

                                <button
                                    className="file-remove"
                                    onClick={() => onRemove(index)}
                                    title="Remove document"
                                    disabled={processing}
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
