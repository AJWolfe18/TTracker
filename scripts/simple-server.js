// simple-server.js
// Quick HTTP server for testing the dashboard locally

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 8000;
const PUBLIC_DIR = join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  try {
    // Default to index-supabase.html for root
    let filePath = req.url === '/' ? '/index-supabase.html' : req.url;
    
    // Security: prevent directory traversal
    if (filePath.includes('..')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    
    const fullPath = join(PUBLIC_DIR, filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    try {
      const content = await readFile(fullPath);
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*' // Allow CORS for testing
      });
      res.end(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500);
    res.end('Internal server error');
  }
});

server.listen(PORT, () => {
  console.log(`
🚀 Local server running!

📍 Dashboard URLs:
   Supabase version: http://localhost:${PORT}/index-supabase.html
   Original version: http://localhost:${PORT}/index.html
   
📊 Direct file access:
   http://localhost:${PORT}/dashboard-supabase.js
   http://localhost:${PORT}/dashboard.js

Press Ctrl+C to stop the server
`);
});