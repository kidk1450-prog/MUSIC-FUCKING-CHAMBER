// service worker for Music Chamber
const CACHE_NAME='music-chamber-shell-v1';
const MUSIC_CACHE='music-files-v1';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{ e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);

  // If request looks like audio from Jamendo (ends with mp3 or audio), treat specially
  const isAudio = e.request.destination === 'audio' || /\.(mp3|wav|aac|ogg)(\?.*)?$/.test(url.pathname);
  if(isAudio){
    e.respondWith(
      caches.open(MUSIC_CACHE).then(cache =>
        fetch(e.request).then(resp => {
          if(resp && resp.ok){ cache.put(e.request, resp.clone()); }
          return resp;
        }).catch(()=>cache.match(e.request))
      )
    );
    return;
  }

  // App shell cache-first
  if(ASSETS.includes(url.pathname) || url.pathname === '/'){
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
    return;
  }

  // Default: network first then cache fallback
  e.respondWith(fetch(e.request).then(resp=>resp).catch(()=>caches.match(e.request)));
});
