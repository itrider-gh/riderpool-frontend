// ====== Config API ======
const API = "https://chauffagistes-pool.fr:3000/api";
const PINGS_API = `${API}/pings`;

// ====== Utils ======
const fmt = {
  compact(n){
    if(n===undefined||n===null||isNaN(n)) return "–";
    const u=["","K","M","G","T","P","E"]; let i=0;
    while(n>=1000 && i<u.length-1){ n/=1000; i++; }
    return n.toFixed(2).replace('.',',') + " " + u[i];
  },
  percent(v){ if(!isFinite(v)) return "–"; return (v*100).toFixed(2).replace('.',',')+" %"; },
  timeAgo(ts){
    if(!ts) return "–";
    const d=new Date(ts*1000), diff=(Date.now()-d)/1000;
    if(diff<60) return Math.floor(diff)+"s";
    if(diff<3600) return Math.floor(diff/60)+"m";
    if(diff<86400) return Math.floor(diff/3600)+"h";
    return d.toLocaleString('fr-FR');
  },
  hashrate(v){ 
    if (v === undefined || v === null) return "–";
    return formatAnyHashrate(v);
  }
};

// === Fonctions de formatage hashrate ===
function parseHashrateToUnit(hps){
  const units = ["H/s","KH/s","MH/s","GH/s","TH/s","PH/s","EH/s"];
  let i = 0;
  let v = Number(hps) || 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v.toFixed(2).replace('.',',')} ${units[i]}`;
}
function parseHashrate(strOrNum){
  if(typeof strOrNum === "number") return strOrNum; // déjà en H/s
  if(typeof strOrNum !== "string") return 0;
  const m = strOrNum.trim().match(/^([\d.,]+)\s*([HKMGTP])?$/i);
  if(!m) return 0;
  const num = parseFloat(m[1].replace(',', '.'));
  const unit=(m[2]||'H').toUpperCase();
  const map={H:1, K:1e3, M:1e6, G:1e9, T:1e12, P:1e15};
  return num*(map[unit]||1);
}
function formatAnyHashrate(v){
  const hps = (typeof v === "number") ? v : parseHashrate(v);
  return parseHashrateToUnit(hps); // -> "42,00 TH/s"
}

// Copie presse-papiers (globale)
function copyText(t){ navigator.clipboard?.writeText(t); }
window.copyText = copyText;

// ====== Chart (historique hashrate) ======
let hrChart;
function ensureCharts(){
  const canvas = document.getElementById('hashrateChart');
  if(!canvas) return;
  const hc = canvas.getContext('2d');
  if(!hrChart){
    hrChart = new Chart(hc, {
      type:'line',
      data:{ labels:[], datasets:[{ label:'Hashrate (TH/s)', data:[], fill:true, tension:.35, borderWidth:2 }]},
      options:{ plugins:{ legend:{ display:false }}, scales:{ y:{ title:{display:true,text:'TH/s'}}, x:{ title:{display:true,text:'Date'} } } }
    });
  }
}

// --- Sélecteur d'intervalle (client-side) ---
let hrHistoryRaw = [];      // {date:'YYYY-MM-DD', hashrate:<H/s>}
let currentRange = '30d';   // défaut: Mois

function filterHistoryByRange(range){
  if(range === 'all') return [...hrHistoryRaw];
  const now = new Date();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 365;
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return hrHistoryRaw.filter(p => {
    const d = new Date(p.date + 'T00:00:00');
    return d >= cutoff;
  });
}

function updateHistoryChart(range){
  currentRange = range;
  const subset = filterHistoryByRange(range);
  const labels = subset.map(p=>p.date);
  const series = subset.map(p=> (p.hashrate/1e12)); // TH/s
  if (hrChart){
    hrChart.data.labels = labels;
    hrChart.data.datasets[0].data = series;
    hrChart.update();
  }

  // Style boutons actif/inactif
  document.querySelectorAll('.btn-range').forEach(b=>{
    b.classList.toggle('active', b.dataset.range === range);
  });
}

// ====== Fetch Pool status ======
async function loadPool(){
  try{
    const r = await fetch(`${API}/pool`);
    const pool = await r.json();

    const runtime = pool.runtime || {};
    const hr = pool.hashrates || {};
    const sh = pool.shares || {};

    const hh = document.getElementById("hashrateHeader");
    if (hh) hh.innerText = "Hashrate : " + fmt.hashrate(hr.hashrate1hr ?? "–");

    const set = (id, val) => { const el=document.getElementById(id); if(el) el.innerText = val; };
    set("pillUsers", runtime.Users ?? "–");
    set("pillWorkers", runtime.Workers ?? "–");
    set("pillAccepted", fmt.compact(sh.accepted||0));
    set("pillRejected", fmt.compact(sh.rejected||0));
    set("pillUpdated", "Maj: " + fmt.timeAgo(runtime.lastupdate));

    const total = (sh.accepted||0)+(sh.rejected||0);
    const rejRate = total ? (sh.rejected/total) : NaN;
    const rejEl = document.getElementById("pillRejectRate");
    if(rejEl){
      rejEl.innerHTML = (rejRate<=0.02)
        ? `Rejet: <span class="pill good">${(rejRate*100).toFixed(2).replace('.',',')} %</span>`
        : `Rejet: <span class="pill bad">${isNaN(rejRate)?'–':(rejRate*100).toFixed(2).replace('.',',')+' %'}</span>`;
    }

    set("kpiHr1h", fmt.hashrate(hr.hashrate1hr ?? "–"));
    set("kpiHr1d", fmt.hashrate(hr.hashrate1d ?? "–"));
    set("kpiSps1h", sh.SPS1h ?? "–");
    set("kpiBestShare", fmt.compact(sh.bestshare||0));
  }catch(e){
    console.error("Erreur pool:", e);
  }
}

// ====== Fetch History (une fois), puis filtrage local ======
async function loadHistory(){
  try{
    const r = await fetch(`${API}/hashrate`);
    const data = await r.json();
    ensureCharts();
    hrHistoryRaw = Array.isArray(data) ? data : [];
    updateHistoryChart(currentRange); // applique la plage courante
  }catch(e){
    console.error("Erreur history:", e);
  }
}

// ====== PINGS / TOPOLOGIE ======
let topoTimer = null;
let topoLoadedOnce = false;

function normalizeHostName(n){
  if(!n) return '';
  const s = n.toLowerCase();
  if(s.includes('proxy'))   return 'proxy';
  if(s.includes('primary')) return 'primary';
  if(s.includes('backup'))  return 'backup';
  return s;
}
function linkClass(aOnline, bOnline){
  return (aOnline && bOnline) ? 'net-link-ok' : 'net-link-bad';
}
function renderPingCounters(data){
  const total   = Number(data?.total ?? 0);
  const online  = Number(data?.online ?? 0);
  const offline = Number(data?.offline ?? 0);
  const set = (id, val) => { const el=document.getElementById(id); if(el) el.innerText = val; };
  set('pingTotal',   isFinite(total)   ? total   : '–');
  set('pingOnline',  isFinite(online)  ? online  : '–');
  set('pingOffline', isFinite(offline) ? offline : '–');
}
function renderNetwork(data){
  const pos = {
    proxy:   { x: 350, y: 40 },
    primary: { x: 200, y: 170 },
    backup:  { x: 500, y: 170 }
  };
  const box = { w: 180, h: 64 };

  const byKey = {};
  (data?.hosts||[]).forEach(h => { byKey[ normalizeHostName(h.name) ] = h; });

  const proxy   = byKey.proxy   || {};
  const primary = byKey.primary || {};
  const backup  = byKey.backup  || {};

  const online = h => !!h.online;
  const latMs  = h => (h.latencyMs != null ? `${h.latencyMs.toFixed(2)} ms` : '–');

  const link1 = linkClass(online(proxy), online(primary));
  const link2 = linkClass(online(proxy), online(backup));

  const svg = `
    <!-- Lignes -->
    <path class="${link1}" d="M ${pos.proxy.x} ${pos.proxy.y+box.h} C ${pos.proxy.x} ${pos.proxy.y+110}, ${pos.primary.x+box.w/2} ${pos.primary.y-40}, ${pos.primary.x+box.w/2} ${pos.primary.y}" />
    <path class="${link2}" d="M ${pos.proxy.x+box.w} ${pos.proxy.y+box.h} C ${pos.proxy.x+box.w} ${pos.proxy.y+110}, ${pos.backup.x+box.w/2} ${pos.backup.y-40}, ${pos.backup.x+box.w/2} ${pos.backup.y}" />

    <!-- Proxy -->
    <g class="net-node ${online(proxy)?'online':'offline'}">
      <rect x="${pos.proxy.x}" y="${pos.proxy.y}" width="${box.w}" height="${box.h}"></rect>
      <text class="net-title" x="${pos.proxy.x+box.w/2}" y="${pos.proxy.y+26}" text-anchor="middle">Stratum Proxy</text>
      <text class="net-sub"   x="${pos.proxy.x+box.w/2}" y="${pos.proxy.y+44}" text-anchor="middle">${latMs(proxy)}</text>
    </g>

    <!-- Primary -->
    <g class="net-node ${online(primary)?'online':'offline'}">
      <rect x="${pos.primary.x}" y="${pos.primary.y}" width="${box.w}" height="${box.h}"></rect>
      <text class="net-title" x="${pos.primary.x+box.w/2}" y="${pos.primary.y+26}" text-anchor="middle">Primary Stratum Server</text>
      <text class="net-sub"   x="${pos.primary.x+box.w/2}" y="${pos.primary.y+44}" text-anchor="middle">${latMs(primary)}</text>
    </g>

    <!-- Backup -->
    <g class="net-node ${online(backup)?'online':'offline'}">
      <rect x="${pos.backup.x}" y="${pos.backup.y}" width="${box.w}" height="${box.h}"></rect>
      <text class="net-title" x="${pos.backup.x+box.w/2}" y="${pos.backup.y+26}" text-anchor="middle">Backup Stratum Server</text>
      <text class="net-sub"   x="${pos.backup.x+box.w/2}" y="${pos.backup.y+44}" text-anchor="middle">${latMs(backup)}</text>
    </g>
  `;
  const el = document.getElementById('netSvg');
  if(el) el.innerHTML = svg;
}
async function loadPingsOnce(){
  try{
    const r = await fetch(PINGS_API);
    const data = await r.json();
    renderPingCounters(data);
    renderNetwork(data);
    updateHeaderStatusFromPings(data); // MAJ LEDs header au 1er chargement topo
    topoLoadedOnce = true;
  }catch(e){ console.error('Erreur pings:', e); }
}
function startTopoRefresh(){
  if(topoTimer) return;
  topoTimer = setInterval(async ()=> {
    try{
      const r = await fetch(PINGS_API);
      const data = await r.json();
      renderPingCounters(data);
      renderNetwork(data);
      updateHeaderStatusFromPings(data); // MAJ LEDs header sur refresh topo
    }catch(e){ console.error('Erreur pings:', e); }
  }, 30000);
}
function stopTopoRefresh(){
  if(topoTimer){ clearInterval(topoTimer); topoTimer = null; }
}

// ====== LEDs statut header ======
function setHeaderStatus(elId, host){
  const el = document.getElementById(elId);
  if(!el) return;
  const led = el.querySelector('.led');
  const state = el.querySelector('.state');

  const isOnline = !!host?.online;
  led.classList.toggle('online',  isOnline);
  led.classList.toggle('offline', !isOnline);
  state.textContent = isOnline ? 'UP' : 'DOWN';

  const baseTitle = el.getAttribute('title') || '';
  const lat = (host?.latencyMs!=null) ? `${host.latencyMs.toFixed(2)} ms` : '–';
  el.title = `${baseTitle} • Latence: ${lat}`;
  el.setAttribute('aria-label', `${baseTitle} ${isOnline?'UP':'DOWN'}, latence ${lat}`);
}

function updateHeaderStatusFromPings(data){
  const byKey = {};
  (data?.hosts||[]).forEach(h=>{
    const s=(h.name||'').toLowerCase();
    let k = s.includes('proxy')?'proxy':s.includes('primary')?'primary':s.includes('backup')?'backup':s;
    byKey[k]=h;
  });
  setHeaderStatus('stProxy',   byKey.proxy   || null);
  setHeaderStatus('stPrimary', byKey.primary || null);
  setHeaderStatus('stBackup',  byKey.backup  || null);
}

async function loadHeaderPings(){
  try{
    const r = await fetch(PINGS_API);
    const data = await r.json();
    updateHeaderStatusFromPings(data);
  }catch(e){
    // En cas d’erreur, passe tout en DOWN
    ['stProxy','stPrimary','stBackup'].forEach(id=>{
      setHeaderStatus(id, {online:false, latencyMs:null});
    });
    console.error('Erreur header pings:', e);
  }
}

// ====== Auto-refresh (status pool + LEDs header) ======
let timer=null;
function startRefresh(){
  if(timer) clearInterval(timer);
  timer = setInterval(()=>{
    loadPool();
    loadHeaderPings(); // LEDs header
  }, 30000);
}

// ====== Bind & Init ======
function selectOnClick(el){
  el.addEventListener('click', ()=>{
    const r=document.createRange();
    r.selectNodeContents(el);
    const s=window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
}

document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.btn-range');
  if(!btn) return;
  updateHistoryChart(btn.dataset.range);
});

document.addEventListener('DOMContentLoaded', ()=>{
  // Sélection rapide des codes
  ['confUrl','confUser','confPass','addrBTC','addrLN'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) selectOnClick(el);
  });

  // Topologie : lazy load + refresh quand ouvert
  const collapseEl = document.getElementById('topologyCollapse');
  if(collapseEl){
    collapseEl.addEventListener('show.bs.collapse', async ()=>{
      if(!topoLoadedOnce) { await loadPingsOnce(); }
      startTopoRefresh();
    });
    collapseEl.addEventListener('hide.bs.collapse', ()=>{
      stopTopoRefresh();
    });
  }

  ensureCharts();
  Promise.all([loadPool(), loadHistory()]).then(()=>{
    loadHeaderPings(); // init immédiate des LEDs
    startRefresh();
  });
});
