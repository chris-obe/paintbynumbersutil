# Paint by Numbers (Privacy Focused)

This is a local-first web application that converts any image into a "Paint by Numbers" template. It runs entirely in your browser using Web Workers, ensuring your photos never leave your device.

## Features

- **Privacy First**: No file uploads to servers. All processing happens locally.
- **No AI**: Uses classical Computer Vision algorithms (K-Means Clustering, Connected Component Labeling, Polylabel).
- **Customizable**: Adjustable palette size (k-colors).
- **Vector Output**: Generates clean SVG paths for printing.

## Tech Stack

- **Frontend**: React + Vite
- **Styling**: Vanilla CSS (Premium Dark Theme)
- **Algorithms**: 
  - `d3-contour` for region extraction
  - `polylabel` for number placement
  - `d3-delaunay` (optional future use) for mesh generation

## How to Run

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start Dev Server**
   ```bash
   npm run dev
   ```

3. **Open Browser**
   Navigate to `http://localhost:5173` (or the port shown in terminal).

## How to Deploy (Cloudflare Pages)

1. Connect your repository to Cloudflare Pages.
2. Set Build Command: `npm run build`
3. Set Output Directory: `dist`

Enjoy!
