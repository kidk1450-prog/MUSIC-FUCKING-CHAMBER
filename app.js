/* ================= CONFIG ===================== */
/* Jamendo Client ID */
const CLIENT_ID = '21e14e8a';
const API_BASE = 'https://api.jamendo.com/v3.0';
const CACHE_NAME = 'music-chamber-media-v1';

/* ===== Firebase config (your project) ===== */
const firebaseConfig = {
  apiKey: "AIzaSyB0rDa0wN3tjgOuEfwFlKqRsLttFH16oz0",
  authDomain: "music-chamber-5487a.firebaseapp.com",
  projectId: "music-chamber-5487a",
  storageBucket: "music-chamber-5487a.firebasestorage.app",
  messagingSenderId: "818204333226",
  appId: "1:818204333226:web:c7494be650835ecd7c2cd3",
  measurementId: "G-XH21YDR371"
};

/* ================= INIT FIREBASE (compat) ============= */
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
  var firebaseAuth = firebase.auth();
  var firestore = firebase.firestore();
} else {
  console.warn('Firebase not available or already initialized.');
}

/* ================= STATE ===================== */
let lastSearch = [];
let playlists = JSON.parse(localStorage.getItem('mc_playlists') || '[]'); // array of {name, tracks:[]}
let playedHistory = JSON.parse(localStorage.getItem('mc_played') || '[]'); // recent tracks
let currentQueue = [];
let currentIndex = -1;
let shuffle = false, loop = false, loopOne = false;

/* =============== DOM SHORTCUTS =============== */
const el = id => document.getElementById(id);
const songList = el('songList'), statusText = el('statusText') || {};
const audio = el('audio'), nowPlaying = el('nowPlaying'), nowArtist = el('nowArtist'),
      playlistContainer = el('playlistContainer'), cachedList = el('cachedList'),
      statsArea = el('statsArea'), sidebarPlaylists = el('sidebarPlaylists'),
      storageInfo = el('storageInfo'), zipStatus = el('zipStatus');

/* ============= PWA INSTALL PROMPT ============= */
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt = e; });

/* ============= AUTH UI ============= */
const auth = {
  btnSignUp: el('btnSignUp'), btnSignIn: el('btnSignIn'), btnLogout: el('btnLogout'),
  authEmail: el('authEmail'), authPass: el('authPass'), userArea: el('userArea'), authForm: el('authForm'), userEmailLabel: el('userEmail')
};

/* Auth handlers */
auth.btnSignUp && auth.btnSignUp.addEventListener('click', async ()=>{
  const email = auth.authEmail.value.trim(); const pass = auth.authPass.value;
  if(!email || !pass) return alert('Enter email and password');
  try{
    const cred = await firebaseAuth.createUserWithEmailAndPassword(email, pass);
    await firestore.collection('users').doc(cred.user.uid).set({ playlists: playlists || [], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    alert('Account created. Signed in.');
  }catch(err){ console.error(err); alert('Sign up failed: '+err.message); }
});
auth.btnSignIn && auth.btnSignIn.addEventListener('click', async ()=>{
  const email = auth.authEmail.value.trim(); const pass = auth.authPass.value;
  if(!email || !pass) return alert('Enter email and password');
  try{ await firebaseAuth.signInWithEmailAndPassword(email, pass); }catch(err){ console.error(err); alert('Sign in failed: '+err.message); }
});
auth.btnLogout && auth.btnLogout.addEventListener('click', async ()=>{ await firebaseAuth.signOut(); });

firebaseAuth.onAuthStateChanged(async user=>{
  if(user){
    auth.authForm.style.display='none'; auth.userArea.style.display='flex'; auth.userEmailLabel.textContent = user.email;
    // load or merge playlists
    try{
      const docRef = firestore.collection('users').doc(user.uid);
      const doc = await docRef.get();
      if(doc.exists){
        const data = doc.data();
        if(data && data.playlists){
          if(playlists && playlists.length){
            const serverPl = data.playlists;
            if(!serverPl || serverPl.length===0){
              await docRef.set({playlists: playlists}, {merge:true});
            } else {
              if(playlists[0] && playlists[0].tracks && serverPl[0]){
                const ids = new Set(serverPl[0].tracks.map(t=>t.id));
                playlists[0].tracks.forEach(t=>{ if(!ids.has(t.id)) serverPl[0].tracks.push(t); });
                await docRef.set({playlists: serverPl}, {merge:true});
                playlists = serverPl;
              } else playlists = serverPl;
            }
          } else playlists = data.playlists;
          savePlaylists(); renderPlaylist();
        }
      } else {
        await docRef.set({playlists: playlists || []});
      }
    }catch(err){ console.error('Load playlists failed',err); }
  } else {
    auth.authForm.style.display='flex'; auth.userArea.style.display='none'; auth.userEmailLabel.textContent = '';
  }
});

/* ============= SEARCH ============= */
el('searchBtn') && el('searchBtn').addEventListener('click', doSearch);
el('searchInput') && el('searchInput').addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(); });

async function doSearch(){
  const q = el('searchInput').value.trim();
  if(!q){ el('statusText') && (el('statusText').textContent='Type a search query.'); return; }
  el('statusText') && (el('statusText').textContent = 'Searching...');
  try{
    const res = await fetch(`${API_BASE}/tracks/?client_id=${CLIENT_ID}&format=json&limit=30&search=${encodeURIComponent(q)}&include=musicinfo`);
    const j = await res.json();
    lastSearch = j.results || [];
    renderSearch(lastSearch);
    el('statusText') && (el('statusText').textContent = lastSearch.length ? `Found ${lastSearch.length} tracks` : 'No results');
  }catch(err){
    console.error(err);
    el('statusText') && (el('statusText').textContent = 'Search failed — check client_id & network.');
  }
}

function renderSearch(list){
  songList.innerHTML = '';
  list.forEach((t,i)=>{
    const row = document.createElement('div'); row.className='song';
    const meta = document.createElement('div'); meta.className='meta';
    meta.innerHTML = `<div class="title">${escapeHtml(t.name)}</div><div class="sub">${escapeHtml(t.artist_name)}</div>`;
    const actions = document.createElement('div'); actions.className='actions';
    actions.innerHTML = `
      <button onclick="playFromSearch(${i})">▶</button>
      <button onclick="addToPlaylistIndex(${i})">➕</button>
      ${t.audiodownload_allowed? `<a class="download-link" href="${t.audiodownload}" target="_blank" rel="noopener">⬇</a>` : ''}
      <button onclick="downloadTrackIndexed(${i})" title="Download for offline">📥</button>
    `;
    row.appendChild(meta); row.appendChild(actions); songList.appendChild(row);
  });
}

/* ============= PLAYBACK ============= */
function setNowPlaying(track){
  nowPlaying.textContent = track ? track.name : 'Not playing';
  nowArtist.textContent = track ? track.artist_name : '';
}

function playFromSearch(idx){
  currentQueue = lastSearch.slice();
  currentIndex = idx;
  startCurrent();
}

async function startCurrent(){
  if(!currentQueue || currentIndex < 0 || currentIndex >= currentQueue.length){ setNowPlaying(null); return;}
  const track = currentQueue[currentIndex];
  setNowPlaying(track);
  const blobUrl = await getCachedTrack(track.id);
  if(blobUrl){ audio.src = blobUrl; audio.play().catch(()=>{}); }
  else { audio.src = track.audio; audio.play().catch(()=>{}); cacheUrlToIndexedDB(track); }
  savePlayed(track);
  renderCachedList();
}

el('playBtn') && el('playBtn').addEventListener('click', ()=>{ if(!audio.src) return; if(audio.paused) audio.play(); else audio.pause(); });
el('nextBtn') && el('nextBtn').addEventListener('click', ()=>nextTrack());
el('prevBtn') && el('prevBtn').addEventListener('click', ()=>{ if(currentIndex>0) currentIndex--; else currentIndex = (currentQueue.length-1); startCurrent(); });

if (audio) audio.addEventListener('timeupdate', ()=>{ const p = (audio.currentTime / (audio.duration||1)) * 100; el('progressBar').style.width = p + '%'; });
if (audio) audio.addEventListener('ended', ()=>{
  if(loopOne){ startCurrent(); return;}
  if(shuffle){ currentIndex = Math.floor(Math.random()*currentQueue.length); startCurrent(); return;}
  currentIndex++;
  if(currentIndex >= currentQueue.length){ if(loop){ currentIndex = 0; startCurrent(); } else { setNowPlaying(null); } }
  else startCurrent();
});

function nextTrack(){
  if(shuffle){ currentIndex = Math.floor(Math.random()*currentQueue.length); startCurrent(); return; }
  currentIndex++;
  if(currentIndex >= currentQueue.length) currentIndex = 0;
  startCurrent();
}

/* ============= PLAYLIST ============= */
function addToPlaylistIndex(i){ addToPlaylist(lastSearch[i]); }
function addToPlaylist(track){
  const t = {id:track.id, name:track.name, artist_name:track.artist_name, audio:track.audio, audiodownload_allowed:track.audiodownload_allowed, audiodownload:track.audiodownload};
  if(playlists.length===0) playlists.push({name:'Default', tracks:[]});
  if(!playlists[0].tracks.find(x=>x.id===t.id)) playlists[0].tracks.push(t);
  savePlaylists();
  renderPlaylist();
}
function savePlaylists(){ localStorage.setItem('mc_playlists', JSON.stringify(playlists)); savePlaylistsToServer(); }
async function savePlaylistsToServer(){
  try{
    const user = firebaseAuth.currentUser;
    if(user) await firestore.collection('users').doc(user.uid).set({playlists: playlists}, {merge:true});
  }catch(e){ console.warn('Could not save server playlists',e); }
}
function createPlaylist(name){
  if(!name) return;
  playlists.push({name, tracks:[]});
  savePlaylists(); renderPlaylist();
}
function playPlaylistAt(pIndex, tIndex){
  const pl = playlists[pIndex];
  if(!pl) return;
  currentQueue = pl.tracks.slice();
  currentIndex = tIndex;
  startCurrent();
}
function removeFromPlaylist(pIndex, tIndex){
  playlists[pIndex].tracks.splice(tIndex,1);
  savePlaylists(); renderPlaylist();
}
function renderPlaylist(){
  playlistContainer.innerHTML = ''; sidebarPlaylists.innerHTML = '';
  if(playlists.length===0){ playlistContainer.textContent='(no playlists)'; sidebarPlaylists.textContent='(no playlists)'; return; }
  playlists.forEach((pl,pi)=>{
    const wrapper = document.createElement('div'); wrapper.className='panel'; wrapper.style.marginBottom='8px';
    const title = document.createElement('div'); title.style.fontWeight='700'; title.style.marginBottom='6px'; title.textContent = pl.name;
    const list = document.createElement('div');
    if(pl.tracks.length===0) list.textContent='(empty)'; else pl.tracks.forEach((t,ti)=>{
      const r = document.createElement('div'); r.className='playlist-item';
      r.innerHTML = `<span>${escapeHtml(t.name)} — ${escapeHtml(t.artist_name)}</span>
                     <span>
                      ${t.audiodownload_allowed? `<a class="download-link" href="${t.audiodownload}" target="_blank" rel="noopener">⬇</a>` : ''}
                      <button onclick="playPlaylistAt(${pi},${ti})">▶</button>
                      <button onclick="removeFromPlaylist(${pi},${ti})" style="color:#f66">✖</button>
                     </span>`;
      list.appendChild(r);
    });
    wrapper.appendChild(title); wrapper.appendChild(list);
    playlistContainer.appendChild(wrapper);

    const s = document.createElement('div'); s.className='playlist-item'; s.style.marginBottom='6px';
    s.innerHTML = `<span style="font-size:14px">${escapeHtml(pl.name)}</span><span><button onclick="playPlaylistAt(${pi},0)">▶</button></span>`;
    sidebarPlaylists.appendChild(s);
  });
}
renderPlaylist();

/* ========== DOWNLOAD PLAYLIST ZIP ========== */
el('downloadPlaylist') && el('downloadPlaylist').addEventListener('click', async ()=>{
  if(playlists.length===0){ alert('No playlists'); return; }
  const p = playlists[0];
  if(!p || p.tracks.length===0){ alert('Playlist empty'); return; }
  const allowed = p.tracks.filter(t=>t.audiodownload_allowed);
  if(allowed.length===0){ alert('No downloadable tracks in playlist'); return; }
  try{
    const zip = new JSZip(); zipStatus.textContent='Zipping...';
    await Promise.all(allowed.map(async t=>{
      const resp = await fetch(t.audiodownload);
      if(!resp.ok) throw new Error('Network error '+t.name);
      const blob = await resp.blob();
      const ext = (t.audiodownload.split('.').pop().split('?')[0]) || 'mp3';
      zip.file(`${sanitizeFilename(t.artist_name)} - ${sanitizeFilename(t.name)}.${ext}`, blob);
    }));
    const content = await zip.generateAsync({type:'blob'});
    const url = URL.createObjectURL(content);
    const a = document.createElement('a'); a.href = url; a.download = 'playlist.zip'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    zipStatus.textContent='ZIP ready';
  }catch(err){
    console.error(err);
    alert('Could not create ZIP (CORS or network). Use individual ⬇ links instead.');
    zipStatus.textContent='ZIP failed';
  }finally{ setTimeout(()=>zipStatus.textContent='', 3000); }
});

/* ========== INDEXEDDB caching (idb) ========== */
const dbPromise = idb.openDB('mc-db', 1, { upgrade(db){ db.createObjectStore('tracks'); }});

async function cacheUrlToIndexedDB(track){
  try{
    const r = await fetch(track.audio);
    if(!r.ok) throw new Error('Fetch failed');
    const blob = await r.blob();
    const db = await dbPromise;
    await db.put('tracks', blob, track.id);
    await updateStorageInfo();
    return true;
  }catch(e){ console.warn('cache to IDB failed', e); return false; }
}
async function getCachedTrack(id){
  try{
    const db = await dbPromise;
    const blob = await db.get('tracks', id);
    if(!blob) return null;
    return URL.createObjectURL(blob);
  }catch(e){ console.warn(e); return null; }
}
async function renderCachedList(){
  const db = await dbPromise;
  const keys = await db.getAllKeys('tracks');
  if(!keys || keys.length===0){ cachedList.textContent='No cached tracks yet'; return; }
  cachedList.innerHTML = '';
  for(const k of keys){
    const d = document.createElement('div'); d.className='playlist-item';
    d.innerHTML = `<span style="font-size:13px">${k}</span><span><button onclick="playCached('${k}')">Play</button><button onclick="deleteCached('${k}')">Delete</button></span>`;
    cachedList.appendChild(d);
  }
}
async function playCached(id){
  const blobUrl = await getCachedTrack(id);
  if(!blobUrl){ alert('Not cached'); return; }
  audio.src = blobUrl; audio.play();
}
async function deleteCached(id){
  const db = await dbPromise;
  await db.delete('tracks', id);
  renderCachedList();
  updateStorageInfo();
}
async function clearAllCached(){
  const db = await dbPromise;
  const keys = await db.getAllKeys('tracks');
  for(const k of keys) await db.delete('tracks', k);
  renderCachedList(); updateStorageInfo();
}
el('clearCache') && el('clearCache').addEventListener('click', ()=>{ if(confirm('Delete all cached tracks?')) clearAllCached(); });

/* helper: update storage usage info (approx by summing blob sizes) */
async function updateStorageInfo(){
  try{
    const db = await dbPromise;
    const keys = await db.getAllKeys('tracks');
    let total = 0;
    for(const k of keys){
      const b = await db.get('tracks', k);
      total += b.size || 0;
    }
    storageInfo && (storageInfo.textContent = `Cached tracks: ${keys.length} — ${Math.round(total/1024/1024*10)/10} MB`);
  }catch(e){ storageInfo && (storageInfo.textContent = 'Storage info unavailable'); }
}

/* helper attempt caches API for non-indexed fallback */
async function cacheUrl(url){ try{ if('caches' in window){ const c = await caches.open(CACHE_NAME); await c.add(url); await updateStorageInfo(); } }catch(e){} }

/* ========== PLAYED HISTORY & AI ========== */
function savePlayed(track){
  playedHistory = JSON.parse(localStorage.getItem('mc_played')||'[]');
  if(!playedHistory.find(t=>t.id===track.id)) playedHistory.unshift(track);
  if(playedHistory.length>200) playedHistory.pop();
  localStorage.setItem('mc_played', JSON.stringify(playedHistory));
  renderStats();
  if(track.audiodownload_allowed) cacheUrlToIndexedDB(track).then(()=>renderCachedList());
}
function renderStats(){
  const s = JSON.parse(localStorage.getItem('mc_played')||'[]');
  if(s.length===0){ statsArea.textContent='No plays yet'; return; }
  statsArea.innerHTML = '<div style="font-weight:600;margin-bottom:8px">Recent plays</div>';
  s.slice(0,8).forEach(t=>{
    const d = document.createElement('div'); d.textContent = `${t.name} — ${t.artist_name}`; statsArea.appendChild(d);
  });
}
async function doAiShuffle(){
  const recent = JSON.parse(localStorage.getItem('mc_played')||'[]');
  if(recent.length===0){ alert('No listening history yet'); return; }
  const favArtist = recent[0].artist_name;
  try{
    const res = await fetch(`${API_BASE}/tracks/?client_id=${CLIENT_ID}&format=json&limit=20&artist_name=${encodeURIComponent(favArtist)}`);
    const j = await res.json();
    const results = j.results || [];
    if(results.length>0){ currentQueue = results; currentIndex = 0; startCurrent(); } else alert('AI found no similar tracks');
  }catch(e){ console.error(e); alert('AI shuffle failed'); }
}
el('aiBtn') && el('aiBtn').addEventListener('click', ()=>doAiShuffle());
el('aiBtnBar') && el('aiBtnBar').addEventListener('click', ()=>doAiShuffle());

/* ========== UTIL & HELPERS ========== */
function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function sanitizeFilename(s){ return (s||'').replace(/[\/\\:?<>|"]/g,'').slice(0,120); }

/* ========== SERVICE WORKER REGISTER ========== */
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').then(()=>console.log('SW registered')).catch(e=>console.warn('SW failed',e));
}

/* UI button bindings */
el('shuffleBtn') && el('shuffleBtn').addEventListener('click', ()=>{ shuffle = !shuffle; el('shuffleBtn').classList.toggle('green', shuffle); });
el('loopBtn') && el('loopBtn').addEventListener('click', ()=>{ loop = !loop; el('loopBtn').classList.toggle('green', loop); });
el('loopOneBtn') && el('loopOneBtn').addEventListener('click', ()=>{ loopOne = !loopOne; el('loopOneBtn').classList.toggle('green', loopOne); });

el('createPlaylistBtn') && el('createPlaylistBtn').addEventListener('click', ()=>{ const name = el('newPlaylistName').value.trim(); if(!name) return alert('Name required'); createPlaylist(name); el('newPlaylistName').value='';});
el('downloadPlaylist') && el('downloadPlaylist').addEventListener('click', ()=>{ /* handled above */ });

el('createDemo') && el('createDemo').addEventListener('click', async ()=>{
  try{
    const res = await fetch(`${API_BASE}/tracks/?client_id=${CLIENT_ID}&format=json&limit=5&search=epic`);
    const j = await res.json(); const tracks = j.results||[];
    if(tracks.length===0) alert('No demo tracks found');
    else{
      playlists.unshift({name:'JoJo Demo', tracks:tracks.map(t=>({id:t.id,name:t.name,artist_name:t.artist_name,audio:t.audio,audiodownload_allowed:t.audiodownload_allowed,audiodownload:t.audiodownload}))});
      savePlaylists(); renderPlaylist();
      alert('Demo playlist added');
    }
  }catch(e){ console.error(e); alert('Demo creation failed'); }
});

/* boot UI */
renderPlaylist(); renderCachedList(); renderStats(); updateStorageInfo();

/* expose functions for inline handlers if needed */
window.playFromSearch = playFromSearch;
window.addToPlaylistIndex = addToPlaylistIndex;
window.playPlaylistAt = playPlaylistAt;
window.playCached = playCached;

/* convenience function for single-track download */
window.downloadTrackIndexed = async function(i){
  const track = lastSearch[i];
  if(!track) return alert('No track');
  if(!track.audiodownload_allowed) return alert('Download not allowed for this track');
  const ok = await cacheUrlToIndexedDB(track);
  if(ok) alert('Track cached for offline play'); else alert('Caching failed (CORS?) — use ⬇ link to download manually');
};
