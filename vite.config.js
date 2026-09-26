import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Auto-detect / generate index.html so Vite never crashes on GitHub Actions
const rootHtml = path.resolve(__dirname, 'index.html');
const publicHtml = path.resolve(__dirname, 'public/index.html');
const rendererHtml = path.resolve(__dirname, 'src/renderer/index.html');

if (!fs.existsSync(rootHtml)) {
  if (fs.existsSync(publicHtml)) {
    fs.copyFileSync(publicHtml, rootHtml);
  } else if (fs.existsSync(rendererHtml)) {
    fs.copyFileSync(rendererHtml, rootHtml);
  } else {
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NOVA AI</title>
  </head>
  <body class="bg-[#050811] text-white overflow-hidden select-none">
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.jsx"></script>
  </body>
</html>`;
    fs.writeFileSync(rootHtml, htmlContent, 'utf-8');
  }
}

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  }
});
