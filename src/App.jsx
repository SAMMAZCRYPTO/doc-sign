import React, { useState } from 'react';
import { FileSignature } from 'lucide-react';
import FileUpload from './components/FileUpload';
import DocumentList from './components/DocumentList';
import { processSignedPDF } from './utils/pdfProcessor';

function App() {
  const [pdfFiles, setPdfFiles] = useState([]);
  const [signatureImage, setSignatureImage] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [processedFiles, setProcessedFiles] = useState([]);

  const handlePdfUpload = (files) => {
    // Append new files
    setPdfFiles(prev => [...prev, ...files]);
  };

  const removePdf = (index) => {
    setPdfFiles(prev => prev.filter((_, i) => i !== index));
    // Also remove from processed if it exists, roughly
    setProcessedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSignatureUpload = (file) => {
    setSignatureImage(file);
  };

  const handleProcess = async () => {
    if (pdfFiles.length === 0 || !signatureImage) return;

    setProcessing(true);
    const results = [];

    try {
      // Process each PDF
      for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        try {
          // Read signature image as ArrayBuffer
          const sigBuffer = await signatureImage.arrayBuffer();
          const pdfBuffer = await file.arrayBuffer();

          const signedPdfBytes = await processSignedPDF(pdfBuffer, sigBuffer, signatureImage.type);

          results.push({
            originalFile: file,
            status: 'success',
            bytes: signedPdfBytes,
            signedName: `Signed_${file.name}`
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
          />
        </div>

        <div className="flex-col gap-lg">
          <DocumentList
            files={pdfFiles}
            processedFiles={processedFiles}
            onRemove={removePdf}
            processing={processing}
          />

          <div className="glass-panel card">
            <div className="action-bar" style={{ marginTop: 0, paddingTop: 0, border: 'none' }}>
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={handleProcess}
                disabled={pdfFiles.length === 0 || !signatureImage || processing}
              >
                {processing ? (
                  <>
                    <span className="animate-pulse">Processing...</span>
                  </>
                ) : (
                  <>
                    <FileSignature size={20} />
                    Process & Sign {pdfFiles.length > 0 ? `${pdfFiles.length} Document${pdfFiles.length > 1 ? 's' : ''}` : 'Documents'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
