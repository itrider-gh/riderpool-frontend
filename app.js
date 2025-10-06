// ================= Config =================
const API = "https://api.riderpool.online/api";
const POOL_API = `${API}/pool`;
const NODE_API = `${API}/node`;
const HASHRATE_HISTORY_API = `${API}/hashrate`;     // <-- historique quotidien (date, hashrate)
const MONTHLY_BESTS_API = `${API}/monthlyBests`;

// ================= Utils =================
const fmt = {
  compact(n){
    if(n===undefined||n===null||isNaN(n)) return "–";
    const u=["","K","M","G","T","P","E"]; let i=0; let v=Number(n)||0;
    while(v>=1000&&i<u.length-1){ v/=1000; i++; }
    return v.toFixed(2).replace('.',',')+" "+u[i];
  },
  percent(v){ if(!isFinite(v)) return "–"; return (v*100).toFixed(2).replace('.',',')+"%"; },
  timeAgoSec(sec){
    if(!sec) return "–";
    const d = new Date(sec*1000);
    const diff = (Date.now()-d)/1000;
    if(diff<60) return Math.floor(diff)+"s";
    if(diff<3600) return Math.floor(diff/60)+"m";
    if(diff<86400) return Math.floor(diff/3600)+"h";
    return d.toLocaleString('en-GB');
  },
  hashrateHuman(hps){
    if(hps==null || isNaN(hps)) return "–";
    const units=["H/s","KH/s","MH/s","GH/s","TH/s","PH/s","EH/s"];
    let i=0, v=Number(hps)||0;
    while(v>=1000&&i<units.length-1){ v/=1000; i++; }
    return v.toFixed(2).replace('.',',')+" "+units[i];
  }
};

function $(sel){ return document.querySelector(sel); }
function copyFromSelector(sel){
  const el = $(sel);
  if(!el) return;
  const text = el.innerText || el.textContent || "";
  navigator.clipboard?.writeText(text);
}

// Parse "1.96T" / "556G" / etc. -> nombre en H/s
function parseHashrateString(str) {
  if (str == null) return NaN;
  if (typeof str === 'number') return str;
  const m = String(str).trim().match(/^([\d.,]+)\s*([KMGTPE])?H?$/i);
  if (!m) return NaN;
  const num = parseFloat(m[1].replace(',', '.'));
  const unit = (m[2] || ' ').toUpperCase();
  const mul = { K:1e3, M:1e6, G:1e9, T:1e12, P:1e15, E:1e18 };
  return num * (mul[unit] || 1);
}

function hashrateHumanAny(x) {
  const v = typeof x === 'string' ? parseHashrateString(x) : Number(x);
  if (!isFinite(v)) return '–';
  const units = ["H/s","KH/s","MH/s","GH/s","TH/s","PH/s","EH/s"];
  let i=0, n=v;
  while(n>=1000 && i<units.length-1){ n/=1000; i++; }
  return n.toFixed(2).replace('.', ',') + " " + units[i];
}

function computeSafeYBounds(arr, fallbackMax=1){
  const vals = arr.filter(v => typeof v === 'number' && isFinite(v) && v >= 0);
  if (vals.length === 0) return { min: 0, max: fallbackMax };
  const max = Math.max(...vals);
  // petit headroom pour éviter que la courbe colle le bord
  return { min: 0, max: max > 0 ? max * 1.15 : fallbackMax };
}


// ===== Personal stats by address =====
const STATS_ADDR_API = (addr) => `${API}/stats/${encodeURIComponent(addr)}`;

// very light sanity check (bech32-ish bc1...)
function looksLikeBc2Address(s) {
  if (!s) return false;
  const x = s.trim();
  return /^bc1[0-9a-z]{20,80}$/i.test(x);
}

async function loadUserStats(addr) {
  const resBox   = $('#usResults');
  const emptyBox = $('#usEmpty');
  const errBox   = $('#usError');

  // reset visibilities
  [resBox, emptyBox, errBox].forEach(el => el && (el.hidden = true));

  try {
    const r = await fetch(STATS_ADDR_API(addr), { cache: 'no-cache' });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();

    if (!j || !j.globalStats) {
      emptyBox.hidden = false;
      return;
    }

    // KPIs (global)
    const g = j.globalStats;
    $('#usHr1m').textContent = hashrateHumanAny(g.hashrate1m);
    $('#usHr5m').textContent = hashrateHumanAny(g.hashrate5m);
    $('#usHr1h').textContent = hashrateHumanAny(g.hashrate1hr);
    $('#usHr1d').textContent = hashrateHumanAny(g.hashrate1d);
    $('#usBestShare').textContent = fmt.compact(g.bestshare || g.bestever || 0);
    $('#usWorkers').textContent = Array.isArray(j.workers) ? j.workers.length : 0;

    // Workers table
    const tbody = $('#usTable tbody');
    tbody.innerHTML = '';

    (j.workers || []).forEach(w => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${w.workername || '—'}</code></td>
        <td>${hashrateHumanAny(w.hashrate1m)}</td>
        <td>${hashrateHumanAny(w.hashrate5m)}</td>
        <td>${hashrateHumanAny(w.hashrate1hr)}</td>
        <td>${hashrateHumanAny(w.hashrate1d)}</td>
        <td>${hashrateHumanAny(w.hashrate7d)}</td>
        <td>${fmt.compact(w.bestshare || w.bestever || 0)}</td>
        <td>${fmt.timeAgoSec(w.lastshare)}</td>
      `;
      tbody.appendChild(tr);
    });

    resBox.hidden = false;

  } catch (e) {
    console.error('addr stats error', e);
    errBox.hidden = false;
  }
}

function bindUserStatsUI() {
  const input = $('#addrInput');
  const btn   = $('#addrGo');

  // submit on click
  btn?.addEventListener('click', () => {
    const addr = (input?.value || '').trim();
    if (!looksLikeBc2Address(addr)) {
      $('#addrHint').innerHTML = 'Please enter a valid BC2 address (starts with <code>bc1</code>).';
      return;
    }
    localStorage.setItem('bc2addr', addr);
    const url = new URL(window.location.href);
    url.searchParams.set('addr', addr);
    history.replaceState(null, '', url.toString());
    loadUserStats(addr);
  });

  // submit on Enter
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); btn?.click(); }
  });

  // prefill from URL or localStorage
  const urlAddr = new URL(window.location.href).searchParams.get('addr');
  const saved   = localStorage.getItem('bc2addr');
  const initVal = urlAddr || saved || '';
  if (initVal) {
    input.value = initVal;
    if (looksLikeBc2Address(initVal)) loadUserStats(initVal);
  }
}


// ================= Data loaders =================
async function loadPool(){
  try{
    const r = await fetch(POOL_API, { cache: "no-cache" });
    const pool = await r.json();
    const runtime = pool.runtime || {};
    const hr = pool.hashrates || {};
    const sh = pool.shares || {};

    $('#kpiHr1h').textContent = hashrateHumanAny(hr.hashrate1hr);
    $('#kpiHr1h2').textContent = hashrateHumanAny(hr.hashrate1hr);
    $('#kpiBestShare').textContent = fmt.compact(sh.bestshare || 0);

    $('#pillUsers').textContent = runtime.Users ?? '–';
    $('#pillWorkers').textContent = runtime.Workers ?? '–';
    $('#pillUpdated').textContent = "Updated: " + fmt.timeAgoSec(runtime.lastupdate);
    $('#nodeUpdated').textContent = fmt.timeAgoSec(runtime.lastupdate);

    const total = (sh.accepted||0) + (sh.rejected||0);
    const rej = total ? (sh.rejected/total) : 0;
    $('#pillRejectVal').textContent = (rej*100).toFixed(2).replace('.', ',') + "%";
    $('#pillReject').classList.toggle('good', rej <= 0.02);
  }catch(e){
    console.error('pool error', e);
  }
}

async function loadNode(){
  try{
    const r = await fetch(NODE_API, { cache:"no-cache" });
    if(!r.ok) throw new Error("node http " + r.status);
    const j = await r.json();
    const height = Number(j?.height);
    const peers  = Number(j?.peers);
    const subv   = (j?.subversion||"").replace(/\//g,'');
    const v = subv.includes(':') ? subv.split(':').join(' ') : subv;

    $('#nodeHeight').textContent  = isFinite(height)? height.toLocaleString('en-GB') : '–';
    $('#nodePeers').textContent   = isFinite(peers)? String(peers) : '–';
    $('#nodeVersion').textContent = v || '–';
  }catch(e){
    console.error('node error', e);
    ['nodeHeight','nodePeers','nodeVersion'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.textContent='–';
    });
  }
}

// ===== Hashrate history (daily) =====
// Endpoint shape: [{ date: "YYYY-MM-DD", hashrate: number }, ...]
async function loadHashrateHistory(){
  let items = [];
  try{
    const r = await fetch(HASHRATE_HISTORY_API, { cache:"no-cache" });
    if(r.ok) items = await r.json();
  }catch(e){ console.warn('history error', e); }

  // Sanitize + map
  let labels = [];
  let data = [];
  if (Array.isArray(items) && items.length) {
    for (const it of items) {
      const d = String(it.date || '');
      const v = Number(it.hashrate);
      const clean = (isFinite(v) && v >= 0) ? v : null;
      labels.push(d || '');
      data.push(clean);
    }
  }

  // Fallback si tout invalide
  if (!data.some(v => typeof v === 'number')) {
    const now = new Date();
    labels = Array.from({length: 14}, (_,i)=>{
      const dt = new Date(now.getTime() - (13-i)*86400000);
      return dt.toISOString().slice(0,10);
    });
    data = Array.from({length: 14}, ()=> 2.5e13 + Math.random()*1e13);
  }

  renderHashrateChart(labels, data);
}

// ===== Monthly best share =====
// Endpoint shape: [{ month:"YYYY-MM", sdiff:number, address:string, epoch:number }, ...]
async function loadMonthlyBests(){
  let items = [];
  try{
    const r = await fetch(MONTHLY_BESTS_API, { cache:"no-cache" });
    if(r.ok) items = await r.json();
  }catch(e){ console.warn('monthly bests error', e); }

  const labels = [];
  const data = [];

  if (Array.isArray(items)) {
    for (const x of items) {
      const month = x.month || '';
      let val = x.sdiff ?? x.diff ?? x.difficulty ?? null;
      if (typeof val === 'string') {
        const n = Number(val.replace(/[, ]/g,''));
        if(!Number.isNaN(n)) val = n;
      }
      val = Number(val);
      const clean = (isFinite(val) && val >= 0) ? val : null;
      if (month) {
        labels.push(month);
        data.push(clean);
      }
    }
  }

  // Fallback si vide
  if (!data.some(v => typeof v === 'number')) {
    labels.push("2025-09","2025-10");
    data.push(7.207e10, 2.631e10);
  }

  renderBestShareChart(labels, data);
}

// ================= Charts =================
let chartHR, chartBest;

function renderHashrateChart(labels, data){
  const ctx = document.getElementById('chartHashrate');
  if(chartHR){ chartHR.destroy(); }

  // Assure des nombres uniquement / null
  const clean = data.map(v => (typeof v === 'number' && isFinite(v) && v >= 0) ? v : null);
  const yBounds = computeSafeYBounds(clean, 1);

  chartHR = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Hashrate',
        data: clean,
        tension: 0.25,
        borderWidth: 2,
        pointRadius: 0,
        spanGaps: true
      }]
    },
    options: {
      normalized: true,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: '#9aa3b2' }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y: {
          min: 0,
          max: yBounds.max,        // borne Y stricte
          grace: '5%',
          ticks: {
            color: '#9aa3b2',
            callback: (v)=> hashrateHumanAny(v)
          },
          grid: { color: 'rgba(255,255,255,0.06)' }
        }
      },
      plugins: {
        legend: { labels: { color: '#e9ecf1' } },
        tooltip: {
          callbacks: { label: (ctx)=> ' ' + hashrateHumanAny(ctx.parsed.y) }
        }
      }
    }
  });
}

function renderBestShareChart(labels, data){
  const ctx = document.getElementById('chartBestShare');
  if(chartBest){ chartBest.destroy(); }

  const clean = data.map(v => (typeof v === 'number' && isFinite(v) && v >= 0) ? v : null);
  const yBounds = computeSafeYBounds(clean, 1);

  chartBest = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Best Share', data: clean, borderWidth: 1 }]
    },
    options: {
      normalized: true,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#9aa3b2' }, grid: { display:false } },
        y: {
          min: 0,
          max: yBounds.max,
          grace: '5%',
          ticks: {
            color: '#9aa3b2',
            callback: (v)=> {
              const U = [{k:1e15,s:'P'},{k:1e12,s:'T'},{k:1e9,s:'G'},{k:1e6,s:'M'}];
              for(const u of U){ if(Math.abs(v)>=u.k) return (v/u.k).toFixed(2)+' '+u.s; }
              return String(v);
            }
          },
          grid: { color: 'rgba(255,255,255,0.06)' }
        }
      },
      plugins: { legend: { labels: { color: '#e9ecf1' } } }
    }
  });
}

// ================= Init =================
function bindCopyButtons(){
  document.querySelectorAll('[data-copy]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const sel = btn.getAttribute('data-copy');
      copyFromSelector(sel);
    });
  });
}

let refreshTimer=null;
function startRefresh(){
  if(refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(()=>{
    loadPool(); loadNode();
  }, 30000);
}

document.addEventListener('DOMContentLoaded', async ()=>{
  bindCopyButtons();
  bindUserStatsUI();                 // <— AJOUT
  await Promise.all([loadPool(), loadNode(), loadHashrateHistory(), loadMonthlyBests()]);
  startRefresh();
});