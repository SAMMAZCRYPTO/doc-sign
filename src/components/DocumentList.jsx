import { FileText, CheckCircle, AlertCircle, X, Download, Archive, MessageSquare, Type, Edit3 } from 'lucide-react';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';

export default function DocumentList({ 
    files, 
    processedFiles, 
    onRemove, 
    processing, 
    detectedComments = {}, 
    onPreviewComments,
    onEditDocument
}) {

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

    const downloadAllAsZip = async () => {
        const successfulFiles = processedFiles.filter(p => p.status === 'success');
        if (successfulFiles.length === 0) return;

        const zip = new JSZip();

        successfulFiles.forEach((file) => {
            zip.file(file.signedName, file.bytes);
        });

        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, 'Signed_Documents.zip');
    };

    const successfulCount = processedFiles.filter(p => p.status === 'success').length;

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
            <div className="flex-center" style={{ justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <h2 className="card-title" style={{ marginBottom: 0 }}>
                    <FileText />
                    Documents ({files.length})
                </h2>

                {successfulCount > 1 && (
                    <button
                        className="btn btn-secondary flex-center gap-sm"
                        onClick={downloadAllAsZip}
                        style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                    >
                        <Archive size={16} />
                        Download All (ZIP)
                    </button>
                )}
            </div>

            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {files.map((file, index) => {
                    const processed = getProcessedStatus(file);

                    return (
                        <div key={`${file.name}-${index}`} className="file-item animate-fade-in" style={{ animationDelay: `${0.1 * index}s` }}>
                            <div className="file-info">
                                <FileText className="file-icon" size={24} />
                                <div style={{ overflow: 'hidden' }}>
                                    <div className="file-name" title={file.name}>{file.name}</div>
                                    <div className="file-size" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
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

                                        {detectedComments[file.name] && detectedComments[file.name].length > 0 && (
                                            <>
                                                •
                                                <button
                                                    className="status-badge comment-badge flex-center gap-xs"
                                                    onClick={(e) => { e.stopPropagation(); onPreviewComments(file); }}
                                                    title={`Click to preview ${detectedComments[file.name].length} comments`}
                                                    style={{ 
                                                        border: 'none', 
                                                        cursor: 'pointer', 
                                                        background: 'rgba(99, 102, 241, 0.15)', 
                                                        color: '#c7d2fe', 
                                                        padding: '0.25rem 0.5rem',
                                                        borderRadius: '9999px',
                                                        fontSize: '0.75rem',
                                                        fontWeight: 500,
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '0.25rem',
                                                        transition: 'var(--transition)' 
                                                    }}
                                                >
                                                    <MessageSquare size={12} />
                                                    {detectedComments[file.name].length} Comment{detectedComments[file.name].length > 1 ? 's' : ''}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex-center gap-sm">
                                {onEditDocument && (
                                    <button
                                        className="btn btn-secondary flex-center gap-xs"
                                        style={{ padding: '0.4rem 0.65rem', fontSize: '0.75rem' }}
                                        onClick={() => onEditDocument(file, index)}
                                        title="Open Visual Studio to edit words and text"
                                        disabled={processing}
                                    >
                                        <Edit3 size={14} color="var(--accent-color)" />
                                        <span>Edit Words</span>
                                    </button>
                                )}

                                {processed && processed.status === 'success' && (
                                    <button
                                        className="btn btn-primary"
                                        style={{ padding: '0.4rem 0.65rem' }}
                                        onClick={() => downloadFile(processed)}
                                        title="Download Signed PDF"
                                    >
                                        <Download size={15} />
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
