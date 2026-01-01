import React, { useEffect, useRef } from 'react';

// Helper: LAB to RGB conversion for display
function lab2rgb(L, a, b) {
    let y = (L + 16) / 116;
    let x = a / 500 + y;
    let z = y - b / 200;

    const x3 = x * x * x;
    const y3 = y * y * y;
    const z3 = z * z * z;

    x = 0.95047 * (x3 > 0.008856 ? x3 : (x - 16 / 116) / 7.787);
    y = 1.00000 * (y3 > 0.008856 ? y3 : (y - 16 / 116) / 7.787);
    z = 1.08883 * (z3 > 0.008856 ? z3 : (z - 16 / 116) / 7.787);

    let r = x * 3.2406 + y * -1.5372 + z * -0.4986;
    let g = x * -0.9689 + y * 1.8758 + z * 0.0415;
    let bl = x * 0.0557 + y * -0.2040 + z * 1.0570;

    r = r > 0.0031308 ? 1.055 * Math.pow(r, 1.0 / 2.4) - 0.055 : 12.92 * r;
    g = g > 0.0031308 ? 1.055 * Math.pow(g, 1.0 / 2.4) - 0.055 : 12.92 * g;
    bl = bl > 0.0031308 ? 1.055 * Math.pow(bl, 1.0 / 2.4) - 0.055 : 12.92 * bl;

    return [
        Math.max(0, Math.min(255, r * 255)),
        Math.max(0, Math.min(255, g * 255)),
        Math.max(0, Math.min(255, bl * 255))
    ];
}

export function ResultCanvas({ result }) {
    const canvasRef = useRef(null);
    const { width, height, labels, palette, numbers } = result;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        // 1. Clear
        ctx.clearRect(0, 0, width, height);

        // 2. Render SVG Outlines
        // Note: We can render paths directly to canvas2d for performance
        // But for "Paint by Numbers" style, we usually want white background + black lines
        // Text is rendered on top.

        // Background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);

        const path2D = new Path2D();

        // Optimize: Batch logic? 
        // We have 'outlines' which are SVG path strings "M...L..."
        // Canvas Path2D constructor accepts SVG path data!

        if (result.outlines) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#cbd5e1'; // slate-300 light grey lines

            for (const outline of result.outlines) {
                const p = new Path2D(outline.path);
                ctx.stroke(p);

                // Optional: Fill with light hint of color?
                // const [r,g,b] = lab2rgb(...)
                // ctx.fillStyle = `rgba(${r},${g},${b}, 0.1)`;
                // ctx.fill(p);
            }
        } else {
            // Fallback to pixel rendering if no outlines
            const imgData = ctx.createImageData(width, height);
            const data = imgData.data;
            const rgbPalette = palette.map(p => lab2rgb(p[0], p[1], p[2]));

            for (let i = 0; i < labels.length; i++) {
                const colorIdx = labels[i];
                const [r, g, b] = rgbPalette[colorIdx];
                data[i * 4] = r;
                data[i * 4 + 1] = g;
                data[i * 4 + 2] = b;
                data[i * 4 + 3] = 255;
            }
            ctx.putImageData(imgData, 0, 0);
        }

        // 3. Render Numbers
        if (numbers) {
            ctx.font = '10px sans-serif'; // Inter if loaded
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (const num of numbers) {
                // Adaptive color? No, PBN is usually black text on white.
                ctx.fillStyle = '#334155'; // Slate 700
                ctx.fillText(num.label, num.x, num.y);
            }
        }

    }, [result]);

    return (
        <div className="relative border border-slate-700 rounded-lg overflow-hidden">
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="max-w-full max-h-[70vh] w-auto h-auto block"
            />
        </div>
    );
}
