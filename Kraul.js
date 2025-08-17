// мини-диагностика загрузки скрипта
window.addEventListener('error', e => console.error('Global error:', e.message));
console.log('app: ready');

(() => {
  const $ = s => document.querySelector(s);

  // элементы
  const domainEl = $('#domain');
  const depthEl = $('#depth');
  const limitEl = $('#limit');
  const urlsTa = $('#urls');

  const crawlBtn = $('#crawl');
  const stopBtn = $('#stop');
  const copyBtn = $('#copyIssues');

  const msgBox = $('#msg');
  const tbody = $('#tbody');
  const bar = $('#bar');
  const doneEl = $('#done');
  const totalEl = $('#total');
  const concEl = $('#concurrency');
  const timeoutEl = $('#timeout');
  const inlineLoader = $('#inlineLoader');

  const issuesWrap = $('#issues');
  const issuesEmpty = $('#issues-empty');

  // состояние
  let stopFlag = false;
  let controllers = new Set();
  let results = [];
  let issues = [];

  // прокси
  const PROXIES = [
    { name:'direct',     wrap: u => u },
    { name:'allorigins', wrap: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
    { name:'thingproxy', wrap: u => `https://thingproxy.freeboard.io/fetch/${u}` },
    { name:'isomorphic', wrap: u => `https://cors.isomorphic-git.org/${u}` },
    { name:'corsproxy',  wrap: u => `https://corsproxy.io/?${encodeURIComponent(u)}` },
  ];
  const BAD_EXT = /\.(?:jpg|jpeg|png|webp|svg|gif|ico|css|js|mjs|woff2?|ttf|otf|pdf|zip|rar|7z|tar|gz|mp4|webm|avi|mov|mp3|m4a)(?:\?|#|$)/i;

  // утилиты
  function setMsg(text, type=''){ msgBox.className = 'msg ' + (type||''); msgBox.innerHTML = text; }
  function setLoading(v){ inlineLoader.classList.toggle('show', !!v); }
  function escapeHTML(s){ return String(s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function normUrl(u){ if(!u) return ''; let s=u.trim(); if(!/^https?:\/\//i.test(s)) s='https://'+s; try{ return new URL(s).href; }catch{ return s; } }
  function sameOrigin(u, origin){ try{ return new URL(u).origin === origin; }catch{ return false; } }
  function noHash(u){ try{ const x=new URL(u); x.hash=''; return x.href; }catch{ return u; } }
  function fetchWithTimeout(url, ms){
    const ctrl = new AbortController();
    const to = setTimeout(()=>ctrl.abort('timeout'), ms);
    controllers.add(ctrl);
    return fetch(url, {signal:ctrl.signal, credentials:'omit', redirect:'follow', headers:{'Accept':'text/html,*/*;q=0.8'}})
      .finally(()=>{ clearTimeout(to); controllers.delete(ctrl); });
  }
  async function fetchHTMLFallback(url, timeoutMs){
    let lastErr;
    const candidates = [url];
    if (url.startsWith('https://')) candidates.push('http://'+url.slice(8));
    for (const base of candidates){
      for (const p of PROXIES){
        try{
          const res = await fetchWithTimeout(p.wrap(base), timeoutMs);
          if(!res.ok) throw new Error(`HTTP ${res.status}`);
          const txt = await res.text();
          if (!txt || txt.length < 32) throw new Error('empty');
          return { html: txt };
        }catch(e){ lastErr = e; }
      }
    }
    throw lastErr || new Error('Failed to fetch');
  }
  function parseSEO(html){
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = (doc.querySelector('title')?.textContent || '').trim() || '—';
    const desc =
      (doc.querySelector('meta[name="description"]')?.content || '').trim() ||
      (doc.querySelector('meta[property="og:description"]')?.content || '').trim() ||
      (doc.querySelector('meta[name="twitter:description"]')?.content || '').trim() || '—';
    const h1s = [...doc.querySelectorAll('h1')].map(h=>h.textContent.trim()).filter(Boolean);
    return { title, desc, h1: h1s.length ? h1s.join(' | ') : '—' };
  }
  function addRow(i, url){
    const tr = document.createElement('tr');
    tr.dataset.idx = i;
    tr.innerHTML = `
      <td data-label="#">${i+1}</td>
      <td class="urlcell mono" data-label="URL">${escapeHTML(url)}</td>
      <td class="mono" data-label="Title">—</td>
      <td class="mono" data-label="Description">—</td>
      <td class="mono" data-label="H1">—</td>
      <td class="mono" data-label="OK" style="text-align:center">…</td>
    `;
    tbody.appendChild(tr);
  }
  function updateRow(i, seo, okState){
    const tr = tbody.querySelector(`tr[data-idx="${i}"]`);
    if(!tr) return;
    tr.children[2].innerHTML = escapeHTML(seo.title ?? '—');
    tr.children[3].innerHTML = escapeHTML(seo.desc ?? '—');
    tr.children[4].innerHTML = escapeHTML(seo.h1 ?? '—');
    const symbol = okState==='ok' ? '✓' : '✖';
    tr.children[5].textContent = symbol;
    tr.children[5].className = 'mono ' + (okState==='ok' ? 'ok' : 'bad');
    if (okState==='bad') tr.classList.add('row-bad');
  }
  function updateProgress(done, total){
    doneEl.textContent = String(done);
    totalEl.textContent = String(total);
    bar.style.width = (total ? Math.round(done*100/total) : 0) + '%';
  }
  const delay = ms => new Promise(r => setTimeout(r, ms));

// --- Проблемы: только нужные проверки ---
function collectIssues(url, seo){
  const list = [];
  const title = (seo.title || '').trim();
  const desc  = (seo.desc  || '').trim();
  const h1    = (seo.h1    || '').trim();

  if (!title || title === '—') list.push({ type:'title-missing', text:'Отсутствует SEO-заголовок (Title)' });
  if (!desc || desc === '—')   list.push({ type:'desc-missing',  text:'Неправильное мета-описание (нет описания)' });
  if (desc && desc !== '—' && desc.length < 60)
    list.push({ type:'desc-short', text:`Неправильное мета-описание (<60 символов: ${desc.length})` });
  if (!h1 || h1 === '—')       list.push({ type:'h1-missing',    text:'Отсутствует H1' });

  if (list.length){
    issues.push({ url, items:list });
    renderIssue({ url, items:list });
  }
  // «плохой» считается любой из этих проблем
  return list.length > 0;
}

function renderIssue(issue){
  if (typeof issuesEmpty !== 'undefined' && issuesEmpty) issuesEmpty.style.display = 'none';
  const box = document.createElement('div');
  box.className = 'issue-item';
  box.innerHTML = `<b>${escapeHTML(issue.url)}</b>`;
  const tags = document.createElement('div');
  tags.className = 'issue-tags';
  issue.items.forEach(it=>{
    const t = document.createElement('span');
    t.className = 'tag tag-bad';
    t.textContent = it.text;
    tags.appendChild(t);
  });
  box.appendChild(tags);
  issuesWrap.appendChild(box);
}

function resetIssues(){
  issues = [];
  issuesWrap.innerHTML = '';
  if (typeof issuesEmpty !== 'undefined' && issuesEmpty) issuesEmpty.style.display = '';
}

// --- Копирование ошибок (группы: ссылки -> подпись ниже) ---
function copyIssuesToClipboard(){
  if (!issues.length){
    navigator.clipboard.writeText('').then(()=>setMsg('Ошибок не найдено, копировать нечего','success'));
    return;
  }

  // собираем ссылки по типам проблем
  const groups = {
    'desc-missing': [],
    'desc-short':   [],
    'title-missing':[],
    'h1-missing':   []
  };

  for (const row of issues){
    for (const it of row.items){
      if (groups[it.type]) groups[it.type].push(row.url);
    }
  }

  // helper: формирует блок "список ссылок\nПодпись\n"
  const makeBlock = (urls, label) => urls.length
    ? `${urls.join('\n')}\n${label}\n\n`
    : '';

  const output =
      makeBlock(groups['desc-missing'], 'Неправильное мета-описание')
    + makeBlock(groups['desc-short'],   'Неправильное мета-описание')
    + makeBlock(groups['title-missing'],'Отсутствует SEO-заголовок')
    + makeBlock(groups['h1-missing'],   'Отсутствует H1');

  navigator.clipboard.writeText(output.trim()).then(()=>{
    const total = Object.values(groups).reduce((a,arr)=>a+arr.length,0);
    setMsg(`Скопировано ссылок: ${total}`,'success');
  }).catch(()=>{
    setMsg('Не удалось скопировать в буфер обмена','error');
  });
}


  // страница
  async function processOne(i, url, timeoutMs, maxRetries=2){
    let attempt=0;
    while (attempt <= maxRetries && !stopFlag){
      try{
        const { html } = await fetchHTMLFallback(url, timeoutMs);
        const seo = parseSEO(html);
        const hasProblems = collectIssues(url, seo);
        updateRow(i, seo, hasProblems ? 'bad' : 'ok');
        return { url, ...seo, ok: hasProblems ? 'bad' : 'ok' };
      }catch(e){
        console.warn('processOne error', url, e);
        attempt++;
        if (attempt > maxRetries){
          updateRow(i, {title:'',desc:'',h1:''}, 'bad');
          issues.push({ url, items:[
            {type:'title-missing', text:'Отсутствует SEO-заголовок (ошибка загрузки)'},
            {type:'desc-missing',  text:'Неправильное мета-описание (ошибка загрузки)'}
          ] });
          renderIssue({ url, items:[
            {type:'title-missing', text:'Отсутствует SEO-заголовок (ошибка загрузки)'},
            {type:'desc-missing',  text:'Неправильное мета-описание (ошибка загрузки)'}
          ] });
          return { url, title:'',desc:'',h1:'', ok:'bad' };
        } else {
          await delay(500*attempt);
        }
      }
    }
    updateRow(i, {title:'',desc:'',h1:''}, 'bad');
    return { url, title:'',desc:'',h1:'', ok:'bad' };
  }

  // пул
  async function scanUrls(urls, concurrency, timeoutSec){
    stopFlag = false; controllers.forEach(c=>c.abort('restart')); controllers.clear();
    results = []; resetIssues();

    tbody.innerHTML = ''; urls.forEach((u,i)=>addRow(i, u));
    updateProgress(0, urls.length); setMsg('Запуск сканирования…'); setLoading(true);

    const total = urls.length; let done=0;
    const pool = new Set(); let cursor=0;

    const N = Math.max(1, Math.min(concurrency, 10));
    function launchNext(){
      if (stopFlag || cursor >= total) return;
      const i = cursor++; const u = urls[i];
      const p = processOne(i, u, timeoutSec*1000).then(res=>{
        results[i] = res; done++; updateProgress(done,total); pool.delete(p);
        if (!stopFlag && cursor < total) launchNext();
      });
      pool.add(p);
    }
    for (let k=0;k<N;k++) launchNext();

    await Promise.all([...pool]);
    setLoading(false);
    setMsg(stopFlag ? 'Остановлено пользователем' : 'Готово ✓', stopFlag ? 'error' : 'success');
  }

  // BFS краулер
  async function crawlDomain(startUrl, maxDepth=1, pageLimit=1000, fetchTimeout=15000){
    setMsg('Краулим домен…'); setLoading(true);
    const origin = new URL(startUrl).origin;
    const q = [{ url: noHash(startUrl), depth: 0 }];
    const seen = new Set();
    const out = [];

    while (q.length && out.length < pageLimit && !stopFlag){
      const { url, depth } = q.shift();
      if (seen.has(url) || BAD_EXT.test(url)) continue;
      seen.add(url); out.push(url);
      setMsg(`Краулинг: ${escapeHTML(url)} (уровень ${depth})`);
      try{
        const { html } = await fetchHTMLFallback(url, fetchTimeout);
        if (depth < maxDepth){
          const doc = new DOMParser().parseFromString(html,'text/html');
          const anchors = [...doc.querySelectorAll('a[href]')];
          const links = anchors.map(a=>{
            try{ return new URL(a.getAttribute('href'), url).href; }catch{ return null; }
          }).filter(Boolean)
            .map(noHash)
            .filter(u => sameOrigin(u, origin) && !BAD_EXT.test(u));
          for (const u of links){
            if (!seen.has(u) && !q.find(x=>x.url===u) && out.length + q.length < pageLimit){
              q.push({ url: u, depth: depth+1 });
            }
          }
        }
      }catch(e){
        console.warn('crawl fetch error', url, e);
      }
    }
    setLoading(false);
    return out;
  }

  // обработчики
  crawlBtn?.addEventListener('click', async ()=>{
    console.log('click: crawl');
    const dom = normUrl(domainEl.value);
    if (!dom){ setMsg('Укажи домен','error'); return; }
    stopFlag = false; updateProgress(0,0);

    try{
      const urls = await crawlDomain(
        dom,
        Number(depthEl.value||1),
        Number(limitEl.value||1000),
        Number(timeoutEl.value||15)*1000
      );
      urlsTa.value = urls.join('\n');
      setMsg(`Найдено внутренних страниц: ${urls.length}. Начинаю сканирование…`);
      updateProgress(0, urls.length);
      await scanUrls(urls, Number(concEl.value||4), Number(timeoutEl.value||15));
    }catch(e){
      setLoading(false);
      console.error('crawl error:', e);
      setMsg('Ошибка краулинга: '+(e.message||e),'error');
    }
  });

  stopBtn?.addEventListener('click', ()=>{
    console.log('click: stop');
    stopFlag = true;
    controllers.forEach(c => c.abort('stopped')); controllers.clear();
    setLoading(false);
  });

  copyBtn?.addEventListener('click', ()=>{
    console.log('click: copy issues');
    copyIssuesToClipboard();
  });
})();

