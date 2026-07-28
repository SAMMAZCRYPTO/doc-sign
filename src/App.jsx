import React, { useState } from 'react';
import { FileSignature, MessageSquare, X } from 'lucide-react';
import FileUpload from './components/FileUpload';
import DocumentList from './components/DocumentList';
import { processSignedPDF, extractCommentsFromPDF } from './utils/pdfProcessor';

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
  };

  const handleProcess = async () => {
    if (pdfFiles.length === 0 || (!signatureImage && !generateSheetEnabled && !signerName && !signerDate)) return;

    setProcessing(true);
    const results = [];

    try {
      // Process each PDF
      for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        try {
          // Read signature if available
          const sigBuffer = signatureImage ? await signatureImage.arrayBuffer() : null;
          const sigType = signatureImage ? signatureImage.type : null;
          const pdfBuffer = await file.arrayBuffer();

          const processedPdfBytes = await processSignedPDF(pdfBuffer, sigBuffer, sigType, {
            generateResolutionSheet: generateSheetEnabled,
            signerName: signerName,
            signerDate: signerDate,
            stampAlignment: stampAlignment
          });

          const hasSignatureBlock = signatureImage || signerName || signerDate;
          let namePrefix = 'Processed_';
          if (hasSignatureBlock && generateSheetEnabled) {
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

      <main className="content-grid animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <div className="flex-col gap-lg">
          <FileUpload
            onPdfUpload={handlePdfUpload}
            onSignatureUpload={handleSignatureUpload}
            signatureImage={signatureImage}
            signerName={signerName}
            onSignerNameChange={setSignerName}
            signerDate={signerDate}
            onSignerDateChange={setSignerDate}
            stampAlignment={stampAlignment}
            onStampAlignmentChange={setStampAlignment}
            generateSheetEnabled={generateSheetEnabled}
            onToggleGenerateSheet={setGenerateSheetEnabled}
          />
        </div>

        <div className="flex-col gap-lg">
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
                disabled={pdfFiles.length === 0 || (!signatureImage && !generateSheetEnabled && !signerName && !signerDate) || processing}
              >
                {processing ? (
                  <>
                    <span className="animate-pulse">Processing...</span>
                  </>
                ) : (
                  <>
                    <FileSignature size={20} />
                    {(signatureImage || signerName || signerDate) && generateSheetEnabled ? (
                      `Sign & Add Sheets (${pdfFiles.length})`
                    ) : (signatureImage || signerName || signerDate) ? (
                      `Sign Documents (${pdfFiles.length})`
                    ) : generateSheetEnabled ? (
                      `Generate Sheets (${pdfFiles.length})`
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
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
