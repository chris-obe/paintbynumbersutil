/* eslint-disable no-restricted-globals */
import polylabel from 'polylabel';
import { contours } from 'd3-contour';
import { geoPath } from 'd3-geo';


// Constants
const LAB_EPSILON = 0.008856;
const LAB_KAPPA = 903.3;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    try {
        switch (type) {
            case 'PROCESS_IMAGE':
                processImage(payload);
                break;
            default:
                console.warn('Unknown message type:', type);
        }
    } catch (error) {
        self.postMessage({ type: 'ERROR', error: error.message });
    }
};

/**
 * Main processing pipeline
 */

// Helper: Square of Euclidean distance (no sqrt needed for comparison)
function distSq(a, b) {
    const dL = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return dL * dL + da * da + db * db;
}

/**
 * Main processing pipeline
 */
function processImage({ imageData, settings }) {
    const { width, height, data } = imageData; // data is Uint8ClampedArray (RGBA)
    const { kColors = 20 } = settings; // User can tune this

    self.postMessage({ type: 'STATUS', status: 'Converting to LAB...' });

    // 1. Convert all pixels to LAB
    const pixelCount = width * height;
    const labPixels = new Float32Array(pixelCount * 3);

    for (let i = 0; i < pixelCount; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const [L, a, bb] = rgb2lab(r, g, b);
        labPixels[i * 3] = L;
        labPixels[i * 3 + 1] = a;
        labPixels[i * 3 + 2] = bb;
    }

    self.postMessage({ type: 'STATUS', status: 'Clustering Colors...' });
    self.postMessage({ type: 'PROGRESS', progress: 20 });

    // 2. K-Means Clustering
    // Optimization: Train on a subset
    const SAMPLE_SIZE = 50000;
    const stride = Math.max(1, Math.floor(pixelCount / SAMPLE_SIZE));

    // Initialize centroids randomly from the data
    let centroids = [];
    for (let i = 0; i < kColors; i++) {
        const idx = Math.floor(Math.random() * pixelCount) * 3;
        centroids.push([labPixels[idx], labPixels[idx + 1], labPixels[idx + 2]]);
    }

    // K-Means Iterations
    const MAX_ITER = 10;
    for (let iter = 0; iter < MAX_ITER; iter++) {
        const sums = new Float32Array(kColors * 3);
        const counts = new Int32Array(kColors);

        // Assign pixels to nearest centroid (using stride)
        for (let i = 0; i < pixelCount; i += stride) {
            const px = [labPixels[i * 3], labPixels[i * 3 + 1], labPixels[i * 3 + 2]];

            let minDist = Infinity;
            let clusterIdx = -1;

            for (let k = 0; k < kColors; k++) {
                const d = distSq(px, centroids[k]);
                if (d < minDist) {
                    minDist = d;
                    clusterIdx = k;
                }
            }

            if (clusterIdx !== -1) {
                sums[clusterIdx * 3] += px[0];
                sums[clusterIdx * 3 + 1] += px[1];
                sums[clusterIdx * 3 + 2] += px[2];
                counts[clusterIdx]++;
            }
        }

        // Update centroids
        let change = 0;
        for (let k = 0; k < kColors; k++) {
            if (counts[k] > 0) {
                const newC = [
                    sums[k * 3] / counts[k],
                    sums[k * 3 + 1] / counts[k],
                    sums[k * 3 + 2] / counts[k]
                ];
                change += distSq(centroids[k], newC);
                centroids[k] = newC;
            }
        }

        if (change < 0.01) break; // Converged
    }

    self.postMessage({ type: 'STATUS', status: 'Applying Palette...' });
    self.postMessage({ type: 'PROGRESS', progress: 50 });

    // 3. Map all pixels to final centroids
    // We'll return an Uint8Array of cluster indices for each pixel
    const labels = new Uint8Array(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
        const px = [labPixels[i * 3], labPixels[i * 3 + 1], labPixels[i * 3 + 2]];
        let minDist = Infinity;
        let clusterIdx = 0;

        for (let k = 0; k < kColors; k++) {
            const d = distSq(px, centroids[k]);
            if (d < minDist) {
                minDist = d;
                clusterIdx = k;
            }
        }
        labels[i] = clusterIdx;
    }

    // 4. Cleanup: Remove small regions (Speckle Removal)
    // We need to run Connected Components first to find regions
    // Then merge small ones, then re-run to get final regions

    self.postMessage({ type: 'STATUS', status: 'Removing Noise...' });
    self.postMessage({ type: 'PROGRESS', progress: 60 });

    // Iterative cleanup (do it a couple of times to ensure clean results)
    let cleanLabels = new Int32Array(labels); // Copy
    cleanLabels = cleanupRegions(cleanLabels, width, height, 20); // Threshold 20px

    self.postMessage({ type: 'STATUS', status: 'Tracing Shapes...' });
    self.postMessage({ type: 'PROGRESS', progress: 80 });

    // 5. Final Region Extraction & Contours
    const { regions, outlines } = extractRegionsAndOutlines(cleanLabels, width, height, centroids.length);

    // 6. Calculate Centroids (Number Placement)
    self.postMessage({ type: 'STATUS', status: 'Placing Numbers...' });
    const labelPositions = calculateLabelPositions(regions, width);

    // Return the raw processing data
    self.postMessage({
        type: 'RESULT',
        payload: {
            palette: centroids, // LAB colors
            labels: cleanLabels,
            width,
            height,
            outlines: outlines, // SVG path data
            numbers: labelPositions // { x, y, labelIndex }
        }
    });
}

// --- Helper Functions ---

// Simple Union-Find based Connected Component Labeling & Cleanup
function cleanupRegions(labels, width, height, minSize) {
    const n = width * height;
    // We will do a simple iterative pass:
    // If a pixel has no neighbors of same color, it's noise.
    // But for "regions", we need true Component Labeling.

    // For performance in JS, we might just do a simpler "filter":
    // For each pixel, if it's different from most neighbors, change it.

    // Better approach:
    // 1. Identify all connected components (BFS/DFS)
    // 2. If component.size < minSize, reassign all pixels to majority neighbor

    const visited = new Uint8Array(n);
    const resultLabels = new Int32Array(labels);

    // Stack for DFS
    const stack = new Int32Array(n);

    // Direction offsets (4-connectivity)
    const dx = [1, -1, 0, 0];
    const dy = [0, 0, 1, -1];

    for (let i = 0; i < n; i++) {
        if (visited[i]) continue;

        let color = resultLabels[i];
        let count = 0;
        let p = 0; // stack pointer
        stack[p++] = i;
        visited[i] = 1;

        const componentIndices = []; // Store indices to reassign if small

        while (p > 0) {
            const curr = stack[--p];
            componentIndices.push(curr);
            count++;

            const cx = curr % width;
            const cy = Math.floor(curr / width);

            for (let d = 0; d < 4; d++) {
                const nx = cx + dx[d];
                const ny = cy + dy[d];

                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nIdx = ny * width + nx;
                    if (!visited[nIdx] && resultLabels[nIdx] === color) {
                        visited[nIdx] = 1;
                        stack[p++] = nIdx;
                    }
                }
            }
        }

        // If small region, find neighbor color
        if (count < minSize) {
            // Find most frequent neighbor color
            const neighborColors = {};
            let bestNeighbor = -1;
            let maxN = -1;

            for (let k = 0; k < componentIndices.length; k++) {
                const idx = componentIndices[k];
                const cx = idx % width;
                const cy = Math.floor(idx / width);

                for (let d = 0; d < 4; d++) {
                    const nx = cx + dx[d];
                    const ny = cy + dy[d];
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const nIdx = ny * width + nx;
                        if (resultLabels[nIdx] !== color) {
                            const nc = resultLabels[nIdx];
                            neighborColors[nc] = (neighborColors[nc] || 0) + 1;
                            if (neighborColors[nc] > maxN) {
                                maxN = neighborColors[nc];
                                bestNeighbor = nc;
                            }
                        }
                    }
                }
            }

            // Reassign
            if (bestNeighbor !== -1) {
                for (let k = 0; k < componentIndices.length; k++) {
                    resultLabels[componentIndices[k]] = bestNeighbor;
                }
            }
        }
    }

    return resultLabels;
}



// 5. Final Region Extraction using d3-contours
function extractRegionsAndOutlines(labels, width, height, numColors) {

    // d3.contours expects a 1D array of values and width/height
    // It generates MultiPolygons for each threshold.

    // We want separate contours for each integer color index [0..numColors-1]

    const allOutlines = [];
    const allRegions = []; // We'll store geojson features here

    // Create a generic projection that maps pixels 1:1
    const pathGenerator = geoPath(null);

    // Note: d3.contours is designed for continuous topography, 
    // but works for categorical data if we treat each value as a separate layer.
    // However, simple "marching squares" might interpolate between 0 and 1, creating 0.5.
    // We shouldn't use d3.contours directly on the ONE labels array if we want exact integer boundaries.

    // BETTER APPROACH for Exact Categories:
    // Create a binary grid for EACH color and contour it.
    // This is expensive (K passes), but K is low (~20).

    for (let k = 0; k < numColors; k++) {
        // Create binary mask for color k
        // To save memory, we can reuse one Float32Array or Int8Array
        const mask = new Float32Array(width * height);
        let hasPixels = false;

        for (let i = 0; i < labels.length; i++) {
            if (labels[i] === k) {
                mask[i] = 1;
                hasPixels = true;
            } else {
                mask[i] = 0;
            }
        }

        if (!hasPixels) continue;

        // Generate contours for value 0.5 (boundary between 0 and 1)
        const generatedContours = contours()
            .size([width, height])
            .thresholds([0.5])
            (mask);

        // generatedContours[0] is the MultiPolygon for the threshold 0.5
        const multiPolygon = generatedContours[0];

        if (multiPolygon && multiPolygon.coordinates.length > 0) {
            // multiPolygon.coordinates is Array of Polygons
            // Each Polygon is Array of Rings (Outer, Inner...)

            multiPolygon.coordinates.forEach((polygonCoords, idx) => {
                // Create a Feature for this distinct shape
                const area = calculatePolygonArea(polygonCoords[0]); // Approx area of outer ring
                if (area < 50) return; // Skip tiny specks

                const feature = {
                    type: 'Feature',
                    geometry: {
                        type: 'Polygon',
                        coordinates: polygonCoords
                    },
                    properties: {
                        colorIndex: k
                    }
                };

                // Generate SVG Path
                const pathData = pathGenerator(feature);

                allOutlines.push({
                    path: pathData,
                    colorIndex: k
                });

                allRegions.push(feature);
            });
        }
    }

    return { regions: allRegions, outlines: allOutlines };
}

function calculateLabelPositions(regions, width) {
    const results = [];

    for (const region of regions) {
        // region is a GeoJSON Feature with Polygon geometry
        // region.geometry.coordinates is [[[x,y]...], [[x,y]...] (holes)]

        const polygon = region.geometry.coordinates;

        // Polylabel expects [ [[x,y]...], ...holes ]
        // This matches GeoJSON Polygon coordinates structure exactly.
        // 1.0 precision usually enough
        const center = polylabel(polygon, 1.0);

        results.push({
            x: center[0],
            y: center[1],
            label: region.properties.colorIndex + 1
        });
    }

    return results;
}

// Shoelace formula for area
function calculatePolygonArea(ring) {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        area += ring[i][0] * ring[j][1];
        area -= ring[j][0] * ring[i][1];
    }
    return Math.abs(area / 2);
}


// Helper: RGB to LAB conversion
function rgb2lab(r, g, b) {
    let R = r / 255;
    let G = g / 255;
    let B = b / 255;

    R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
    G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
    B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;

    let X = R * 0.4124 + G * 0.3576 + B * 0.1805;
    let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    let Z = R * 0.0193 + G * 0.1192 + B * 0.9505;

    X = X / 0.95047;
    Y = Y / 1.00000;
    Z = Z / 1.08883;

    X = X > LAB_EPSILON ? Math.cbrt(X) : (LAB_KAPPA * X + 16) / 116;
    Y = Y > LAB_EPSILON ? Math.cbrt(Y) : (LAB_KAPPA * Y + 16) / 116;
    Z = Z > LAB_EPSILON ? Math.cbrt(Z) : (LAB_KAPPA * Z + 16) / 116;

    const L = 116 * Y - 16;
    const a = 500 * (X - Y);
    const bb = 200 * (Y - Z);

    return [L, a, bb];
}
