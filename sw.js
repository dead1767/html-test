// TurboWarp ZIP Player Service Worker
importScripts('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');

const DB_NAME = 'twzip-player';
const STORE_NAME = 'files';
const ZIP_KEY = 'zip';

let zipPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredZip() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(ZIP_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function getZip() {
  if (!zipPromise) {
    zipPromise = (async () => {
      const blob = await getStoredZip();
      if (!blob) throw new Error('ZIPファイルが保存されていません。先にZIPをアップロードしてください。');
      return JSZip.loadAsync(blob);
    })().catch(error => {
      zipPromise = null;
      throw error;
    });
  }
  return zipPromise;
}

async function getFile(path) {
  const zip = await getZip();
  const file = zip.file(path);
  if (!file || file.dir) return null;
  return file.async('uint8array');
}

function contentType(path) {
  const ext = path.split('.').pop().toLowerCase();
  const types = {
    html: 'text/html; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    gif: 'image/gif',
    webp: 'image/webp',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    txt: 'text/plain; charset=utf-8',
    css: 'text/css; charset=utf-8',
    xml: 'application/xml'
  };
  return types[ext] || 'application/octet-stream';
}

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'RESET') {
    zipPromise = null;
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ ok: true });
    }
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scopeURL = new URL(self.registration.scope);

  if (url.origin !== scopeURL.origin || !url.pathname.startsWith(scopeURL.pathname)) {
    return;
  }

  // Serve the ZIP's original index.html when the player requests ?play=1.
  if (request.mode === 'navigate' && url.searchParams.get('play') === '1') {
    event.respondWith((async () => {
      try {
        const data = await getFile('index.html');
        if (!data) return new Response('ZIP内にindex.htmlがありません。', { status: 404 });

        // iPad向けテスト: TurboWarpの高画質レンダリングを無効化する
        let html = new TextDecoder('utf-8').decode(data);
        const highQualityLine = 'if (vm.renderer.setUseHighQualityRender) vm.renderer.setUseHighQualityRender(true);';
        html = html.replace(
          highQualityLine,
          'if (vm.renderer.setUseHighQualityRender) vm.renderer.setUseHighQualityRender(false);'
        );

        return new Response(html, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        });
      } catch (error) {
        return new Response(String(error), { status: 500 });
      }
    })());
    return;
  }

  const path = decodeURIComponent(url.pathname.slice(scopeURL.pathname.length))
    .replace(/^\/+/, '');

  if (path === 'script.js' || path.startsWith('assets/')) {
    event.respondWith((async () => {
      try {
        const data = await getFile(path);
        if (!data) return new Response('ZIP内にファイルがありません: ' + path, { status: 404 });
        return new Response(data, {
          headers: {
            'Content-Type': contentType(path),
            'Cache-Control': 'no-store'
          }
        });
      } catch (error) {
        return new Response('ファイル読み込みエラー: ' + String(error), { status: 500 });
      }
    })());
  }
});
