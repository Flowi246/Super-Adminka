// availability-check.js (без KPI, с колонками "Детали" и "Действия")

(() => {
  const $ = (sel) => document.querySelector(sel);
  const kpInput = $('#kpId');
  const btnCheck = $('#checkBtn');
  const btnReset = $('#resetBtn');
  const chips = $('#chips');
  const tbody = $('#tbody');

  const STORAGE_KEY = 'availability:lastKpId';

  // Цепочка CORS-proxy (fallback)
  const proxyChain = [
    (u) => u, // прямой
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
    (u) => `https://isomorphic-git.org/cors-proxy?${u}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`
  ];
  const TIMEOUT_MS = 12000;

  async function fetchJsonWithFallback(url) {
    const started = performance.now();
    let lastErr;
    for (const wrap of proxyChain) {
      const target = wrap(url);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort('timeout'), TIMEOUT_MS);
      try {
        const res = await fetch(target, { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const txt = await res.text(); // часто text/plain → парсим вручную
        const json = JSON.parse(txt);
        return { ok: true, json, ms: Math.round(performance.now() - started), via: target };
      } catch (e) {
        clearTimeout(t);
        lastErr = e;
      }
    }
    return { ok: false, error: lastErr?.message || 'network error', ms: Math.round(performance.now() - started) };
  }

  // Источники
  const SOURCES = [
{
  id: 'reval',
  name: 'Ревалл',
  build: (id) => `https://api.bhcesh.me/franchise/details?token=11f63a91d67e3756b7cecaa612c75727&kinopoisk_id=${id}`,
  parse: (j) => {
    // спец-ответы "нет проекта"
    if (
      (j?.status === "error" && /not movie/i.test(j?.error_info || "")) ||
      j?.message === "Movie not found" ||
      j?.result === false
    ) {
      return { available: false, titleRu: null, titleEn: null };
    }

    const titleRu = j?.title_ru || j?.names?.ru || j?.title || j?.name || null;
    const titleEn = j?.title_en || j?.names?.en || null;
    const seasonsArr = Array.isArray(j?.seasons) ? j.seasons : [];
    const available = seasonsArr.length > 0 || !!titleRu;
    return { available, titleRu, titleEn };
  }
},

    {
      id: 'holes',
      name: 'Холес',
      build: (id) => `https://aderom.net/api/${id}`,
      parse: (j) => {
        // спец-ответы "нет проекта"
    if (
      (j?.status === "error" && /not movie/i.test(j?.error_info || "")) ||
      j?.message === "Movie not found" ||
      j?.result === false
    ) {
      return { available: false, titleRu: null, titleEn: null };
    }
        const titleRu = j?.title_ru || j?.title || j?.name || j?.names?.ru || null;
        const titleEn = j?.title_en || j?.names?.en || null;
        const available = !!titleRu || !!j?.seasons || !!j?.data?.seasons;
        return { available, titleRu, titleEn };
      }
    },
    {
      id: 'aloha',
      name: 'Аллоха',
      build: (id) => `https://api.apbugall.org/?token=e9a962df5e96874972bd776d247fa6&kp=${id}`,
      parse: (j) => {
        // спец-ответы "нет проекта"
    if (
      (j?.status === "error" && /not movie/i.test(j?.error_info || "")) ||
      j?.message === "Movie not found" ||
      j?.result === false
    ) {
      return { available: false, titleRu: null, titleEn: null };
    }
        // apbugall: полезные поля в data.*, JSON.parse сам декодирует \uXXXX → UTF-8
        const data = (j && typeof j === 'object' && 'data' in j) ? j.data : j;
        const arr = Array.isArray(data) ? data : (data ? [data] : []);
        const first = arr[0] || {};
        const titleRu = first?.name || first?.title_ru || first?.title || null;
        const titleEn = first?.original_name || first?.title_en || null;
        const available = !!titleRu || arr.length > 0;
        return { available, titleRu, titleEn };
      }
    },
    {
      id: 'lumex',
      name: 'Люмекс',
      build: (id) => `https://portal.lumex.host/api/short?api_token=Cpcuf0ZI4VgGOZ8Kfge2GLchcxMEgU5L&kinopoisk_id=${id}`,
      parse: (j) => {
        // спец-ответы "нет проекта"
    if (
      (j?.status === "error" && /not movie/i.test(j?.error_info || "")) ||
      j?.message === "Movie not found" ||
      j?.result === false
    ) {
      return { available: false, titleRu: null, titleEn: null };
    }
        const arr = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : (j ? [j] : []));
        const first = arr[0] || {};
        const titleRu = first?.title_ru || first?.title || first?.name || null;
        const titleEn = first?.title_en || null;
        const available = arr.length > 0 || !!titleRu;
        return { available, titleRu, titleEn };
      }
    },
    {
      id: 'kodik',
      name: 'Кодик',
      build: (id) => `https://kodikapi.com/search?token=57e7a86d71861542dcb4f01a98480d3e&kinopoisk_id=${id}`,
      parse: (j) => {
        
        const results = Array.isArray(j?.results) ? j.results : (Array.isArray(j) ? j : []);
        const available = results.length > 0;
        const first = results[0] || {};
        const titleRu = first?.title || first?.title_ru || null;
        const titleEn = first?.title_en || null;
        return { available, titleRu, titleEn };
      }
    }
  ];

  // helpers
  function saveKp(id){try{localStorage.setItem(STORAGE_KEY,id)}catch{}}
  function loadKp(){try{return localStorage.getItem(STORAGE_KEY)||''}catch{return''}}
  function escapeHtml(str){
    return String(str)
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'","&#039;");
  }

  function renderRow(s,res){
    const tr=document.createElement('tr');

    // Источник
    const tdName=document.createElement('td');
    tdName.className='api-name';
    tdName.textContent=s.name;

    // Статус
    const tdStatus=document.createElement('td');
    const status=res.ok?(res.data.available?'ok':'fail'):'warn';
    tdStatus.innerHTML=`
      <span class="status ${status}">
        ${status==='ok'?'✅ Найдено':status==='fail'?'❌ Нет':'⚠️ Ошибка'}
      </span>
      <div class="muted mono">${res.ms} ms</div>
    `;

    // Название
    const tdTitle=document.createElement('td');
    const titleMain=res.data?.titleRu||'—';
    const titleSub=res.data?.titleEn?`<div class="muted">${escapeHtml(res.data.titleEn)}</div>`:'';
    tdTitle.innerHTML=`${escapeHtml(titleMain)}${titleSub}`;

// Детали (скачать JSON или ошибка)
const tdDetails = document.createElement('td');
tdDetails.className = 'details-cell';
if (res.ok) {
  const blob = new Blob([JSON.stringify(res.raw, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  tdDetails.innerHTML = `<a class="btn-small icon-download" href="${url}" download="${s.id}-${Date.now()}.json">Скачать JSON</a>`;
} else {
  tdDetails.innerHTML = `<span class="muted">${escapeHtml(res.error || '—')}</span>`;
}

// Действия (Открыть API / Скопировать cURL)
const tdActions = document.createElement('td');
tdActions.className = 'actions-cell';

const row = document.createElement('div');
row.className = 'row-actions';

const openApi = document.createElement('a');
openApi.className = 'btn-small primary icon-open';
openApi.textContent = 'Открыть API';
openApi.href = s.build(kpInput.value.trim());
openApi.target = '_blank';
row.appendChild(openApi);

const copyCurl = document.createElement('button');
copyCurl.className = 'btn-small ghost icon-copy';
copyCurl.textContent = 'Скопировать URL';
copyCurl.onclick = () => {
  const curl = `curl -s '${s.build(kpInput.value.trim())}'`;
  navigator.clipboard.writeText(curl).then(() => {
    copyCurl.textContent = 'Скопировано ✓';
    setTimeout(() => (copyCurl.textContent = 'Скопировать URL'), 1200);
  });
};
row.appendChild(copyCurl);

tdActions.appendChild(row);

    tr.appendChild(tdName);
    tr.appendChild(tdStatus);
    tr.appendChild(tdTitle);
    tr.appendChild(tdDetails);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }

  function renderChips(agg){
    chips.innerHTML='';
    const make=(text,cls)=>{const c=document.createElement('span'); c.className=`chip ${cls||''}`; c.textContent=text; chips.appendChild(c);};
    make(`Ошибок: ${agg.errors}`, agg.errors?'warn':'');
  }

  async function runCheck(){
    const id=kpInput.value.trim();
    if(!id){kpInput.focus();return;}
    saveKp(id);

    tbody.innerHTML=''; chips.innerHTML='';

    const promises=SOURCES.map(async(src)=>{
      const url=src.build(id);
      const res=await fetchJsonWithFallback(url);
      if(!res.ok){return {id:src.id,ok:false,error:res.error,ms:res.ms,data:{},raw:{error:res.error}};}
      let data={};
      try{data=src.parse(res.json)||{};}catch{data={available:false};}
      return {id:src.id,ok:true,ms:res.ms,data,raw:res.json};
    });

    const results=await Promise.all(promises);

    results.forEach((r)=>{const src=SOURCES.find(s=>s.id===r.id); renderRow(src,r);});

    const errors=results.filter(r=>!r.ok).length;
    renderChips({errors});
  }

  // события
  document.addEventListener('DOMContentLoaded',()=>{
    const last=loadKp(); if(last) kpInput.value=last;
  });
  btnCheck.addEventListener('click',runCheck);
  kpInput.addEventListener('keydown',(e)=>{if(e.key==='Enter') runCheck();});
  btnReset.addEventListener('click',()=>{
    kpInput.value=''; localStorage.removeItem(STORAGE_KEY);
    tbody.innerHTML=''; chips.innerHTML=''; kpInput.focus();
  });
})();
