import { useState, useRef, useEffect } from 'react';
import { Upload, Sliders, Download, Palette, Image as ImageIcon, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ResultCanvas } from './components/ResultCanvas';

function App() {
    const [isProcessing, setIsProcessing] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('');
    const [result, setResult] = useState(null);

    const workerRef = useRef(null);
    const originalImageRef = useRef(null);

    useEffect(() => {
        workerRef.current = new Worker(new URL('./workers/image.worker.js', import.meta.url), { type: 'module' });

        workerRef.current.onmessage = (e) => {
            const { type, payload, status, progress, error } = e.data;
            if (type === 'STATUS') {
                setStatus(status);
            } else if (type === 'PROGRESS') {
                setProgress(progress);
            } else if (type === 'RESULT') {
                setResult(payload);
                setIsProcessing(false);
                setStatus('Done!');
            } else if (type === 'ERROR') {
                console.error(error);
                setIsProcessing(false);
                setStatus('Error occurred');
            }
        };

        return () => workerRef.current?.terminate();
    }, []);


    const downloadPNG = () => {
        const canvas = document.querySelector('#canvas-container canvas');
        if (canvas) {
            const link = document.createElement('a');
            link.download = 'paint-by-numbers.png';
            link.href = canvas.toDataURL();
            link.click();
        }
    };

    const downloadSVG = (result) => {
        const { width, height, outlines, numbers } = result;

        // Construct SVG string
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <style>
          path { fill: none; stroke: #94a3b8; stroke-width: 1px; vector-effect: non-scaling-stroke; }
          text { font-family: sans-serif; font-size: 10px; fill: #334155; text-anchor: middle; dominant-baseline: middle; }
        </style>
        <rect width="100%" height="100%" fill="white"/>
        <g id="outlines">`;

        outlines.forEach(o => {
            svg += `<path d="${o.path}" />`;
        });

        svg += `</g><g id="numbers">`;

        numbers.forEach(n => {
            svg += `<text x="${n.x}" y="${n.y}">${n.label}</text>`;
        });

        svg += `</g></svg>`;

        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'paint-by-numbers.svg';
        link.href = url;
        link.click();
    };

    const handleFileUpload = async (e) => {

        const file = e.target.files?.[0];
        if (!file) return;

        setImageLoaded(true);
        setIsProcessing(true);
        setStatus('Loading image...');
        setResult(null);

        const img = await createImageBitmap(file);
        originalImageRef.current = img;

        // Resize 
        const MAX_DIM = 1200;
        let w = img.width;
        let h = img.height;
        if (w > MAX_DIM || h > MAX_DIM) {
            const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
            w = Math.floor(w * scale);
            h = Math.floor(h * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);

        workerRef.current.postMessage({
            type: 'PROCESS_IMAGE',
            payload: {
                imageData: imageData,
                settings: { kColors: 20 }
            }
        });
    };

    return (
        <div className="app-container">
            {/* Background */}
            <div className="bg-ambience">
                <div className="blob blob-1" />
                <div className="blob blob-2" />
            </div>

            {/* Header */}
            <header className="app-header">
                <div className="logo-lockup">
                    <Palette className="icon-logo" />
                    <h1 className="title">
                        Paint by <span className="text-gradient">Numbers</span>
                    </h1>
                </div>
                <p className="subtitle">
                    Turn your photos into paint-by-number templates instantly.
                    100% private, processed in your browser.
                </p>
            </header>

            {/* Main Content */}
            <main className="app-main">
                {!imageLoaded ? (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="upload-card glass-panel group"
                    >
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleFileUpload}
                            className="hidden-input"
                        />
                        <div className="upload-icon-wrapper">
                            <Upload className="icon-logo" />
                        </div>
                        <h3 className="text-xl font-semibold mb-2" style={{ color: 'white' }}>Upload an Image</h3>
                        <p className="text-slate-400 mb-6">Drag & drop or click to browse</p>
                        <button className="btn-primary">
                            Select Photo
                        </button>
                    </motion.div>
                ) : (
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
                        {/* Progress / Status */}
                        {isProcessing && (
                            <div className="status-panel glass-panel animate-in fade-in zoom-in duration-300">
                                <Loader2 className="icon-logo animate-spin" />
                                <div style={{ textAlign: 'center' }}>
                                    <p style={{ color: 'white', fontWeight: 500, marginBottom: '0.25rem' }}>{status}</p>
                                    <div className="progress-track">
                                        <div className="progress-bar" style={{ width: `${progress}%` }} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Result View */}
                        {!isProcessing && result && (
                            <div className="result-view">
                                <div className="canvas-container" id="canvas-container">
                                    <ResultCanvas result={result} />
                                </div>

                                {/* Action Bar */}
                                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                    <button className="btn-primary" onClick={() => downloadPNG()}>
                                        <Download style={{ width: 16, height: 16, marginRight: 8, display: 'inline' }} />
                                        Download PNG
                                    </button>
                                    <button className="btn-primary" style={{ backgroundColor: '#64748b' }} onClick={() => downloadSVG(result)}>
                                        <Download style={{ width: 16, height: 16, marginRight: 8, display: 'inline' }} />
                                        Download SVG
                                    </button>
                                </div>

                                {/* Palette Legend */}
                                <div className="palette-legend">
                                    {result.palette.map((c, i) => {
                                        return (
                                            <div key={i} className="swatch">
                                                <div
                                                    className="color-dot"
                                                    style={{ backgroundColor: `lab(${c[0]}% ${c[1]} ${c[2]})` }}
                                                />
                                                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{i + 1}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        <button
                            className="btn-link"
                            onClick={() => { setImageLoaded(false); setResult(null); }}
                        >
                            Start Over
                        </button>
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="footer">
                &copy; {new Date().getFullYear()} PaintByNumbers. No AI, just Math.
            </footer>
        </div>
    );
}

export default App;
