// Kaptura Sales · Service worker
// Guarda la plataforma en el dispositivo para que abra aunque no haya internet.
// Los datos (Supabase) NO pasan por aquí: la plataforma los guarda por su cuenta.
const CACHE = 'kaptura-v1';
const PRECACHE = ['./'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(PRECACHE.map(url =>
    fetch(url, { cache: 'reload' })
      .then(res => { if (res.ok) return cache.put(url === './' ? './index.html' : url, res); })
      .catch(() => {})
  ))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const viejas = (await caches.keys()).filter(k => k.startsWith('kaptura-') && k !== CACHE);
    await Promise.all(viejas.map(k => caches.delete(k)));
    await self.clients.claim();
    // Había una versión anterior guardada: recargar las pestañas abiertas para que tomen la nueva.
    if (viejas.length) {
      const pestanas = await self.clients.matchAll({ type: 'window' });
      await Promise.all(pestanas.map(c => c.navigate(c.url).catch(() => {})));
    }
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/supabase\.(co|in)$/.test(url.hostname)) return;           // datos en vivo: los maneja la plataforma
  if (req.mode === 'navigate') { event.respondWith(pagina(req, event)); return; }
  if (url.origin === self.location.origin || /cdn\.jsdelivr\.net$|fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    event.respondWith(recurso(req));
  }
});

// Página: primero internet (para recibir cambios); si tarda o no hay, la copia guardada.
async function pagina(req, event) {
  const cache = await caches.open(CACHE);
  const red = fetch(req).then(res => {
    const tipo = res.headers.get('content-type') || '';
    if (res.ok && tipo.includes('text/html')) cache.put('./index.html', res.clone());
    return res;
  });
  red.catch(() => {});
  const guardada = await cache.match('./index.html');
  if (!guardada) return red.catch(() => Response.error());
  const espera = new Promise(resolve => setTimeout(() => resolve(null), 6000));
  try {
    const res = await Promise.race([red, espera]);
    if (res) return res;
    // Se mostró la copia guardada porque internet tardó: si la de internet es distinta, avisar a la plataforma.
    event.waitUntil(avisarSiCambia(guardada.clone(), red));
    return guardada;
  } catch (_) {
    return guardada;
  }
}

async function avisarSiCambia(guardada, red) {
  try {
    const nueva = await red;
    if (!nueva || !nueva.ok) return;
    const [a, b] = await Promise.all([guardada.text(), nueva.clone().text()]);
    if (a === b) return;
    await (await caches.open(CACHE)).put('./index.html', nueva.clone());
    const pestanas = await self.clients.matchAll({ type: 'window' });
    pestanas.forEach(c => c.postMessage({ tipo: 'nueva-version' }));
  } catch (_) {}
}

// Librerías y tipografías: la copia guardada al instante y se actualiza en segundo plano.
async function recurso(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req, { ignoreVary: true });
  const red = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return guardado || (await red) || Response.error();
}
