import React, { useState, useCallback } from 'react';
import { FileSignature, MessageSquare, X, Upload, FilePlus, Settings, Minimize2 } from 'lucide-react';
import FileUpload from './components/FileUpload';
import DocumentList from './components/DocumentList';
import { processSignedPDF, extractCommentsFromPDF, compressPDF } from './utils/pdfProcessor';

function App() {
  const [pdfFiles, setPdfFiles] = useState([]);
  const [signatureImage, setSignatureImage] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [processedFiles, setProcessedFiles] = useState([]);
  const [detectedComments, setDetectedComments] = useState({});
  const [generateSheetEnabled, setGenerateSheetEnabled] = useState(false);
  const [previewCommentsFile, setPreviewCommentsFile] = useState(null);
  const [signerName, setSignerName] = useState('');
  const [signerDate, setSignerDate] = useState('');
  const [stampAlignment, setStampAlignment] = useState('right');
  const [stampSize, setStampSize] = useState('medium');
  const [activeTab, setActiveTab] = useState('signature');
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);
  const [pageSelectionType, setPageSelectionType] = useState('all');
  const [customPageRange, setCustomPageRange] = useState('');
  const [compressEnabled, setCompressEnabled] = useState(false);
  const [signatureEnabled, setSignatureEnabled] = useState(false);

  const changeSignerName = (name) => {
    setSignerName(name);
    if (name.trim()) {
      setSignatureEnabled(true);
    }
  };

  const changeSignerDate = (date) => {
    setSignerDate(date);
    if (date) {
      setSignatureEnabled(true);
    }
  };

  const handlePdfUpload = async (files) => {
    // Append new files
    setPdfFiles(prev => [...prev, ...files]);

    // Asynchronously extract comments for preview and default-toggle settings
    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        const comments = await extractCommentsFromPDF(buffer);
        setDetectedComments(prev => ({
          ...prev,
          [file.name]: comments
        }));
        if (comments.length > 0) {
          setGenerateSheetEnabled(true);
        }
      } catch (error) {
        console.error(`Error scanning comments for ${file.name}:`, error);
      }
    }
  };

  const removePdf = (index) => {
    const fileToRemove = pdfFiles[index];
    if (fileToRemove) {
      setDetectedComments(prev => {
        const next = { ...prev };
        delete next[fileToRemove.name];
        return next;
      });
    }
    setPdfFiles(prev => prev.filter((_, i) => i !== index));
    setProcessedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSignatureUpload = (file) => {
    setSignatureImage(file);
    setSignatureEnabled(true);
  };

  const handleProcess = async () => {
    if (pdfFiles.length === 0 || (!signatureEnabled && !generateSheetEnabled && !compressEnabled)) return;

    setProcessing(true);
    const results = [];

    try {
      // Process each PDF
      for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        try {
          // Read signature if available
          const sigBuffer = signatureEnabled && signatureImage ? await signatureImage.arrayBuffer() : null;
          const sigType = signatureEnabled && signatureImage ? signatureImage.type : null;
          const pdfBuffer = await file.arrayBuffer();

          let processedPdfBytes = await processSignedPDF(pdfBuffer, sigBuffer, sigType, {
            generateResolutionSheet: generateSheetEnabled,
            signerName: signatureEnabled ? signerName : '',
            signerDate: signatureEnabled ? signerDate : '',
            stampAlignment: stampAlignment,
            stampSize: stampSize,
            pageSelectionType: pageSelectionType,
            customPageRange: customPageRange
          });

          if (compressEnabled) {
            processedPdfBytes = await compressPDF(processedPdfBytes);
          }

          const hasSignatureBlock = signatureEnabled && (signatureImage || signerName || signerDate);
          let namePrefix = 'Processed_';
          if (compressEnabled && hasSignatureBlock && generateSheetEnabled) {
            namePrefix = 'Compressed_Signed_CRS_';
          } else if (compressEnabled && hasSignatureBlock) {
            namePrefix = 'Compressed_Signed_';
          } else if (compressEnabled && generateSheetEnabled) {
            namePrefix = 'Compressed_CRS_';
          } else if (compressEnabled) {
            namePrefix = 'Compressed_';
          } else if (hasSignatureBlock && generateSheetEnabled) {
            namePrefix = 'Signed_CRS_';
          } else if (hasSignatureBlock) {
            namePrefix = 'Signed_';
          } else if (generateSheetEnabled) {
            namePrefix = 'CRS_';
          }

          results.push({
            originalFile: file,
            status: 'success',
            bytes: processedPdfBytes,
            signedName: `${namePrefix}${file.name}`
          });
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error);
          results.push({
            originalFile: file,
            status: 'error',
            error: error.message
          });
        }
      }
      setProcessedFiles(results);
    } catch (err) {
      console.error('Master processing error:', err);
    } finally {
      setProcessing(false);
    }
  };

  const handlePdfDrop = useCallback((e) => {
    e.preventDefault();
    setIsDraggingPdf(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(file => file.type === 'application/pdf');
      if (files.length > 0) {
        handlePdfUpload(files);
      } else {
        alert('Please upload PDF documents only.');
      }
    }
  }, [handlePdfUpload]);

  const handlePdfUploadClick = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      handlePdfUpload(files);
    }
    e.target.value = null;
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDraggingPdf(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDraggingPdf(false);
  };

  const hasSignatureBlock = !!(signatureImage || signerName || signerDate);

  return (
    <div className="container">
      <header className="header animate-fade-in">
        <div className="flex-center gap-md" style={{ marginBottom: '1rem' }}>
          <div style={{ background: 'var(--card-bg)', padding: '1rem', borderRadius: '50%', border: '1px solid var(--card-border)' }}>
            <FileSignature size={48} className="text-gradient" color="var(--accent-color)" />
          </div>
        </div>
        <h1>
          Doc<span className="text-gradient">Sign</span>
        </h1>
        <p>Batch sign multiple PDFs instantly. Upload your documents, add your signature securely in the browser, and download the signed files.</p>
      </header>

      <div className="workspace-container">
        <aside className="workspace-sidebar animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <button
            className={`sidebar-tab ${activeTab === 'signature' ? 'active' : ''}`}
            onClick={() => setActiveTab('signature')}
          >
            <FileSignature size={18} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Signature & Stamp</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Configure details & size</span>
            </div>
            <span className={`tab-indicator ${signatureEnabled ? 'enabled' : ''}`}></span>
          </button>

          <button
            className={`sidebar-tab ${activeTab === 'comments' ? 'active' : ''}`}
            onClick={() => setActiveTab('comments')}
          >
            <MessageSquare size={18} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Comment Resolution</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Scan & prepend table sheets</span>
            </div>
            <span className={`tab-indicator ${generateSheetEnabled ? 'enabled' : ''}`}></span>
          </button>

          <button
            className={`sidebar-tab ${activeTab === 'compress' ? 'active' : ''}`}
            onClick={() => setActiveTab('compress')}
          >
            <Minimize2 size={18} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Compress PDF</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Reduce file size drastically</span>
            </div>
            <span className={`tab-indicator ${compressEnabled ? 'enabled' : ''}`}></span>
          </button>
        </aside>

        <main className="workspace-content animate-fade-in" style={{ animationDelay: '0.15s' }}>
          <div className="flex-col gap-lg">
            <FileUpload
              activeTab={activeTab}
              onSignatureUpload={handleSignatureUpload}
              signatureImage={signatureImage}
              signerName={signerName}
              onSignerNameChange={changeSignerName}
              signerDate={signerDate}
              onSignerDateChange={changeSignerDate}
              stampAlignment={stampAlignment}
              onStampAlignmentChange={setStampAlignment}
              stampSize={stampSize}
              onStampSizeChange={setStampSize}
              pageSelectionType={pageSelectionType}
              onPageSelectionTypeChange={setPageSelectionType}
              customPageRange={customPageRange}
              onCustomPageRangeChange={setCustomPageRange}
              generateSheetEnabled={generateSheetEnabled}
              onToggleGenerateSheet={setGenerateSheetEnabled}
              compressEnabled={compressEnabled}
              onToggleCompress={setCompressEnabled}
              signatureEnabled={signatureEnabled}
              onToggleSignature={setSignatureEnabled}
            />
          </div>

          <div className="flex-col gap-lg">
            {/* Upload PDFs Card */}
            <div className="glass-panel card animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <h2 className="card-title">
                <FilePlus />
                Upload PDFs
              </h2>
              <div
                className={`dropzone ${isDraggingPdf ? 'active' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handlePdfDrop}
                onClick={() => document.getElementById('pdf-upload').click()}
              >
                <Upload className="dropzone-icon" />
                <h3 className="dropzone-title">Drag & drop PDFs here</h3>
                <p className="dropzone-subtitle">or click to browse. Multiple files supported.</p>
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

            <DocumentList
              files={pdfFiles}
              processedFiles={processedFiles}
              onRemove={removePdf}
              processing={processing}
              detectedComments={detectedComments}
              onPreviewComments={setPreviewCommentsFile}
            />

            <div className="glass-panel card">
              <div className="action-bar" style={{ marginTop: 0, paddingTop: 0, border: 'none' }}>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={handleProcess}
                  disabled={pdfFiles.length === 0 || (!signatureEnabled && !generateSheetEnabled && !compressEnabled) || processing}
                >
                  {processing ? (
                    <>
                      <span className="animate-pulse">Processing...</span>
                    </>
                  ) : (
                    <>
                      <FileSignature size={20} />
                      {signatureEnabled && generateSheetEnabled && compressEnabled ? (
                        `Sign, Add Sheets & Compress (${pdfFiles.length})`
                      ) : signatureEnabled && generateSheetEnabled ? (
                        `Sign & Add Sheets (${pdfFiles.length})`
                      ) : signatureEnabled && compressEnabled ? (
                        `Sign & Compress (${pdfFiles.length})`
                      ) : signatureEnabled ? (
                        `Sign Documents (${pdfFiles.length})`
                      ) : generateSheetEnabled && compressEnabled ? (
                        `Add Sheets & Compress (${pdfFiles.length})`
                      ) : generateSheetEnabled ? (
                        `Generate Sheets (${pdfFiles.length})`
                      ) : compressEnabled ? (
                        `Compress Documents (${pdfFiles.length})`
                      ) : (
                        `Process Documents (${pdfFiles.length})`
                      )}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {previewCommentsFile && (
        <div className="modal-overlay flex-center animate-fade-in" onClick={() => setPreviewCommentsFile(null)}>
          <div className="modal-content glass-panel animate-scale-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px', width: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--card-border)' }}>
              <h3 className="modal-title" style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <MessageSquare size={20} color="var(--accent-color)" />
                Comments in {previewCommentsFile.name}
              </h3>
              <button className="file-remove" onClick={() => setPreviewCommentsFile(null)} style={{ padding: '0.25rem' }}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
              <div className="comments-table-wrapper" style={{ overflowX: 'auto', borderRadius: 'var(--border-radius-md)', border: '1px solid var(--card-border)' }}>
                <table className="comments-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255, 255, 255, 0.05)', borderBottom: '1px solid var(--card-border)' }}>
                      <th style={{ padding: '0.75rem 1rem', fontWeight: 600, width: '15%' }}>Page</th>
                      <th style={{ padding: '0.75rem 1rem', fontWeight: 600, width: '25%' }}>Author</th>
                      <th style={{ padding: '0.75rem 1rem', fontWeight: 600, width: '60%' }}>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detectedComments[previewCommentsFile.name] || []).map((comment, index) => (
                      <tr key={index} style={{ borderBottom: index === (detectedComments[previewCommentsFile.name].length - 1) ? 'none' : '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)' }}>Page {comment.page}</td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--text-primary)' }}>{comment.author}</td>
                        <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{comment.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="modal-footer" style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--card-border)', display: 'flex', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.1)', borderRadius: '0 0 var(--border-radius-lg) var(--border-radius-lg)' }}>
              <button className="btn btn-secondary" onClick={() => setPreviewCommentsFile(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
