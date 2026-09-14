/* Servidor para probar la app desde el celular, en la red local.
 *
 *     node pruebas/servir.js [puerto]        # 8080 por omisión
 *
 * Manda `Cache-Control: no-store`, que es lo que importa: `python3 -m http.server`
 * a secas manda `Last-Modified` sin `Cache-Control`, el navegador aplica caché
 * heurístico y termina mostrando la versión anterior. Es el mismo síntoma que
 * describe CLAUDE.md en *Service worker*, y hace perder tiempo buscando un bug
 * que no existe.
 *
 * Ojo: sobre `http://` en una IP de la red local no hay contexto seguro, así que
 * no se registra el service worker y el GPS (botón ◎) no funciona. Todo lo demás
 * sí. Para probar esas dos cosas hace falta HTTPS.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.resolve(__dirname, '..');
const PUERTO = Number(process.argv[2]) || 8080;

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.geojson': 'application/json', '.webp': 'image/webp',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(RAIZ, rel);
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('no está');
  }
  res.writeHead(200, {
    'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream',
    'Cache-Control': 'no-store, must-revalidate',
    'Service-Worker-Allowed': '/'
  });
  fs.createReadStream(f).pipe(res);
}).listen(PUERTO, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`sirviendo ${RAIZ}`);
  for (const ip of ips) console.log(`   http://${ip}:${PUERTO}`);
  console.log('   el celular tiene que estar en la misma WiFi, y el firewall de macOS dejar pasar');
});
