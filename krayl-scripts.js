// app-live.js — Only NEW links from HOME (root) every 30s. No rescans. No other discovery.
window.addEventListener('error', e => console.error('Global error:', e.message));
console.log('app: home-only discovery');

(() => {
  const $ = s => document.querySelector(s);

  // === UI refs
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

  // >>> НОВОЕ: переключатель режима
  const jmodeEl = $('#jmode'); // select: "1" (articleBody) / "2" (description1)

  // === State
  let stopFlag = false;
  let controllers = new Set();
  let issues = [];
  let results = [];

  // Discovery: strictly HOME every 30s
  const REFRESH_MS = 30_000;
  let refreshTimer = null;
  let refreshing = false;

  // Limits / heuristics
  const MAX_NEW_PER_TICK = 1000;   // предохранитель на один тик
  const EXPAND_DEPTH = 1;          // расширяем только с главной: глубина 0 -> 1

  // Domain context
  let SITE = {
    origin: null,
    host: null,
    startUrl: null,
    homeUrl: null
  };

  // Bookkeeping
  const accounted = new Set();   // всё, что уже учли (в таблицу ставили или обработали)
  const enqueued  = new Set();   // сейчас в очереди
  const processed = new Set();   // реально обработанные страницы

  // File types to skip
  const BAD_EXT = /\.(?:jpg|jpeg|png|webp|svg|gif|ico|css|js|mjs|woff2?|ttf|otf|pdf|zip|rar|7z|tar|gz|mp4|webm|avi|mov|mp3|m4a)(?:\?|#|$)/i;

  // Proxies
  const PROXIES = [
    { name:'direct',     wrap: u => u },
    { name:'allorigins', wrap: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
    { name:'thingproxy', wrap: u => `https://thingproxy.freeboard.io/fetch/${u}` },
    { name:'isomorphic', wrap: u => `https://cors.isomorphic-git.org/${u}` },
    { name:'corsproxy',  wrap: u => `https://corsproxy.io/?${encodeURIComponent(u)}` },
  ];

  // === Utils
  function setMsg(text, type=''){ msgBox.className = 'msg ' + (type||''); msgBox.innerHTML = text; }
  function setLoading(v){ inlineLoader.classList.toggle('show', !!v); }
  function escapeHTML(s){ return String(s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function anchorHTML(url){
    const u = escapeHTML(url);
    return `<a href="${u}" target="_blank" rel="noopener noreferrer" class="url-link" title="${u}">${u}</a>`;
  }

  function normalizeHost(h){
    try{
      h = (h||'').toLowerCase();
      if (h.startsWith('www.')) h = h.slice(4);
      return h;
    }catch{ return h || ''; }
  }
  function sameHost(u){
    try{ return normalizeHost(new URL(u).host) === SITE.host; }catch{ return false; }
  }
  function stripTracking(u){
    try{
      const x = new URL(u);
      [
        'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
        'gclid','fbclid','yclid','mc_cid','mc_eid','ref','ref_src'
      ].forEach(k=>x.searchParams.delete(k));
      return x.href;
    }catch{ return u; }
  }
  function canonicalize(u, base){
    try{
      const x = new URL(u, base || SITE.origin);
      x.hash = '';
      x.hostname = normalizeHost(x.hostname);
      return stripTracking(x.href);
    }catch{ return (base ? u : (SITE.origin + '/' + String(u||'').replace(/^\/+/,''))); }
  }
  function isSkippable(u){ return BAD_EXT.test(u); }

  function normUrl(u){
    if(!u) return '';
    let s = u.trim();
    if(!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      const url = new URL(s);
      url.hostname = normalizeHost(url.hostname);
      url.hash = '';
      return stripTracking(url.href);
    } catch {
      return s;
    }
  }

  const cacheBust = url => {
    try{ const u = new URL(url); u.searchParams.set('__t', Date.now().toString()); return u.href; }
    catch{ return url + (url.includes('?') ? '&' : '?') + '__t=' + Date.now(); }
  };

  function fetchWithTimeout(url, ms){
    const ctrl = new AbortController();
    const to = setTimeout(()=>ctrl.abort('timeout'), ms);
    controllers.add(ctrl);
    return fetch(url, {
      signal:ctrl.signal, credentials:'omit', redirect:'follow',
      cache:'no-store',
      headers:{'Accept':'text/html,application/xml;q=0.9,*/*;q=0.8'}
    }).finally(()=>{ clearTimeout(to); controllers.delete(ctrl); });
  }
  async function fetchText(url, timeoutMs){
    let lastErr;
    const candidates = [cacheBust(url)];
    if (url.startsWith('https://')) candidates.push(cacheBust('http://'+url.slice(8)));
    for (const base of candidates){
      for (const p of PROXIES){
        try{
          const res = await fetchWithTimeout(p.wrap(base), timeoutMs);
          if(!res.ok) throw new Error(`HTTP ${res.status}`);
          const txt = await res.text();
          if (!txt || txt.length < 16) throw new Error('empty');
          return txt;
        }catch(e){ lastErr = e; }
      }
    }
    throw lastErr || new Error('Failed to fetch');
  }

  // === SEO + Body parse (режим Джатсу 1/2)
  function parseSEO(html){
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const title = (doc.querySelector('title')?.textContent || '').trim() || '—';
    const desc =
      (doc.querySelector('meta[name="description"]')?.content || '').trim() ||
      (doc.querySelector('meta[property="og:description"]')?.content || '').trim() ||
      (doc.querySelector('meta[name="twitter:description"]')?.content || '').trim() || '—';
    const h1s = [...doc.querySelectorAll('h1')].map(h=>h.textContent.trim()).filter(Boolean);

    // --- выбор цели в зависимости от режима
    const mode = (jmodeEl?.value || '1'); // по умолчанию "1"
    let bodyEl = null;

    if (mode === '1') {
      // Джатсу 1 → второй articleBody после скрипта
      const bodies = [...doc.querySelectorAll('div.prose.w-full.max-w-full[itemprop="articleBody"]')];
      const markerScripts = [...doc.querySelectorAll('script[data-noptimize][data-wpfc-render="false"]')];
      function isAfter(a, b){ return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); }
      if (bodies.length > 1 && markerScripts.length) {
        const lastScript = markerScripts[markerScripts.length - 1];
        bodyEl = bodies.find(b => isAfter(lastScript, b)) || bodies[1] || bodies[bodies.length - 1];
      } else if (bodies.length > 1) {
        bodyEl = bodies[1];
      } else {
        bodyEl = bodies[0] || null;
      }
    } else {
      // Джатсу 2 → div.description1.mt1.no-lm
      bodyEl = doc.querySelector('div.description1.mt1.no-lm');
    }

    // считаем контент «живым», если есть <p> ИЛИ ненулевая текстовая длина
    const bodyPCount = bodyEl ? bodyEl.querySelectorAll('p').length : 0;
    const bodyTextLen = bodyEl ? (bodyEl.textContent || '').replace(/\s+/g,' ').trim().length : 0;
    const hasBody = !!bodyEl && (bodyPCount > 0 || bodyTextLen > 0);

    return {
      title,
      desc,
      h1: h1s.length ? h1s.join(' | ') : '—',
      hasBody,
      bodyPCount,
      bodyTextLen
    };
  }

  function parseLinksFromHTML(html, baseUrl){
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // НИКАКИХ discovery из <link rel="alternate"> — строго home-only
    const urls = [...doc.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(Boolean)
      .map(href => canonicalize(href, baseUrl))
      .filter(u => sameHost(u) && !isSkippable(u));
    return urls;
  }

  // === Table UI
  // Порядок колонок: #, URL, Title, Description, H1, Статья, OK
  function addRow(i, url){
    const tr = document.createElement('tr');
    tr.dataset.idx = i;
    tr.innerHTML = `
      <td data-label="#">${i+1}</td>
      <td class="urlcell mono" data-label="URL">${anchorHTML(url)}</td>
      <td class="mono" data-label="Title">—</td>
      <td class="mono" data-label="Description">—</td>
      <td class="mono" data-label="H1">—</td>
      <td class="mono" data-label="Статья" style="text-align:center">…</td>
      <td class="mono" data-label="OK" style="text-align:center">…</td>
    `;
    tbody.appendChild(tr);
  }

  function updateRow(i, seo, okState){
    const tr = tbody.querySelector(`tr[data-idx="${i}"]`);
    if(!tr) return;
    // индексы: 0 #, 1 URL, 2 Title, 3 Description, 4 H1, 5 Статья, 6 OK
    tr.children[2].innerHTML = escapeHTML(seo.title ?? '—');
    tr.children[3].innerHTML = escapeHTML(seo.desc ?? '—');
    tr.children[4].innerHTML = escapeHTML(seo.h1 ?? '—');

    // колонка "Статья": отдельный индикатор по hasBody
    const articleSymbol = seo.hasBody ? '✓' : '✖';
    tr.children[5].textContent = articleSymbol;
    tr.children[5].className = 'mono ' + (seo.hasBody ? 'ok' : 'bad');

    // колонка "OK": общий статус (meta+h1+body)
    const symbol = okState==='ok' ? '✓' : '✖';
    tr.children[6].textContent = symbol;
    tr.children[6].className = 'mono ' + (okState==='ok' ? 'ok' : 'bad');

    if (okState==='bad') tr.classList.add('row-bad'); else tr.classList.remove('row-bad');
  }

  function updateProgress(done, total){
    doneEl.textContent = String(done);
    totalEl.textContent = String(total);
    bar.style.width = (total ? Math.round(done*100/total) : 0) + '%';
  }
  const delay = ms => new Promise(r => setTimeout(r, ms));

  // === Issues
  function collectIssues(url, seo){
    const list = [];
    const title = (seo.title || '').trim();
    const desc  = (seo.desc  || '').trim();
    const h1    = (seo.h1    || '').trim();

    if (!title || title === '—') list.push({ type:'title-missing', text:'Отсутствует SEO-заголовок' });
    if (!desc || desc === '—')   list.push({ type:'desc-missing',  text:'Неправильное мета-описание' });
    if (desc && desc !== '—' && desc.length < 60)
      list.push({ type:'desc-short', text:`Неправильное мета-описание (<60 символов: ${desc.length})` });
    if (!h1 || h1 === '—')       list.push({ type:'h1-missing',    text:'Отсутствует H1' });

    // Проверка текста статьи (режим Джатсу 1/2)
    if (!seo.hasBody) {
      list.push({ type:'body-missing', text:'Отсутствует текст статьи' });
    }

    if (list.length){
      issues.push({ url, items:list });
      renderIssue({ url, items:list });
    }
    return list.length > 0;
  }

  function renderIssue(issue){
    if (issuesEmpty) issuesEmpty.style.display = 'none';
    const box = document.createElement('div');
    box.className = 'issue-item';
    const urlHTML = anchorHTML(issue.url);
    box.innerHTML = `<b>${urlHTML}</b>`;
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
    issuesEmpty && (issuesEmpty.style.display = '');
  }

  function copyIssuesToClipboard(){
    if (!issues.length){
      navigator.clipboard.writeText('').then(()=>setMsg('Ошибок не найдено, копировать нечего','success'));
      return;
    }
    const groups = {
      'desc-missing': [],
      'desc-short':   [],
      'title-missing':[],
      'h1-missing':   [],
      'body-missing': []
    };
    for (const row of issues){
      for (const it of row.items){
        if (groups[it.type]) groups[it.type].push(row.url);
      }
    }
    const makeBlock = (urls, label) => urls.length ? `${urls.join('\n')}\n${label}\n\n` : '';
    const output =
        makeBlock(groups['desc-missing'], 'Неправильное мета-описание')
      + makeBlock(groups['desc-short'],   'Неправильное мета-описание')
      + makeBlock(groups['title-missing'],'Отсутствует SEO-заголовок')
      + makeBlock(groups['h1-missing'],   'Отсутствует H1')
      + makeBlock(groups['body-missing'], 'Отсутствует текст статьи');

    navigator.clipboard.writeText(output.trim()).then(()=>{
      const total = Object.values(groups).reduce((a,arr)=>a+arr.length,0);
      setMsg(`Скопировано ссылок: ${total}`,'success');
    }).catch(()=>{
      setMsg('Не удалось скопировать в буфер обмена','error');
    });
  }

  // === CORE
  async function liveCrawl(startUrl, { maxDepth=1, pageLimit=5000, fetchTimeout=15000, concurrency=4 } = {}){
    // reset
    stopFlag = false; controllers.forEach(c=>c.abort('restart')); controllers.clear();
    clearInterval(refreshTimer); refreshTimer = null; refreshing = false;

    results = []; resetIssues();
    tbody.innerHTML = '';
    urlsTa.value = '';
    accounted.clear(); enqueued.clear(); processed.clear();

    const normStart = normUrl(startUrl);
    SITE.origin  = new URL(normStart).origin;
    SITE.host    = normalizeHost(new URL(normStart).host);
    SITE.startUrl= canonicalize(normStart);
    SITE.homeUrl = canonicalize(SITE.origin + '/');

    let totalPlanned = 0;
    let done = 0;

    const queue = []; // {url, depth, rowIndex}

    function enqueuePage(u, depth){
      if (stopFlag || !u) return;
      u = canonicalize(u);
      if (!sameHost(u) || isSkippable(u)) return;
      if (accounted.has(u) || enqueued.has(u)) return;
      if (totalPlanned >= Number(limitEl.value||pageLimit)) return;

      accounted.add(u);
      enqueued.add(u);

      const rowIndex = totalPlanned++;
      addRow(rowIndex, u);
      queue.push({ url:u, depth, rowIndex });

      urlsTa.value += (urlsTa.value ? '\n' : '') + u;
      updateProgress(done, Math.min(totalPlanned, Number(limitEl.value||pageLimit)));
    }

    async function processPage({ url, depth, rowIndex }){
      try{
        setMsg(`Обработка: ${escapeHTML(url)} (depth ${depth})`);
        const html = await fetchText(url, fetchTimeout);
        const seo = parseSEO(html);
        const hasProblems = collectIssues(url, seo);
        updateRow(rowIndex, seo, hasProblems ? 'bad' : 'ok');
        results[rowIndex] = { url, ...seo, ok: hasProblems ? 'bad' : 'ok' };

        if (depth < Math.min(EXPAND_DEPTH, Number(maxDepth)||1)){
          const links = parseLinksFromHTML(html, url);
          for (const nu of links){
            enqueuePage(nu, depth+1);
          }
        }
      }catch(e){
        console.warn('process error', url, e);
        updateRow(rowIndex, {title:'',desc:'',h1:'',hasBody:false}, 'bad');
        issues.push({ url, items:[
          {type:'title-missing', text:'Отсутствует SEO-заголовок (ошибка загрузки)'},
          {type:'desc-missing',  text:'Неправильное мета-описание (ошибка загрузки)'}
        ]});
        renderIssue({ url, items:[
          {type:'title-missing', text:'Отсутствует SEO-заголовок (ошибка загрузки)'},
          {type:'desc-missing',  text:'Неправильное мета-описание (ошибка загрузки)'}
        ]});
      }finally{
        enqueued.delete(url);
        processed.add(url);
        done++;
        updateProgress(Math.min(done, Number(limitEl.value||pageLimit)), Math.min(totalPlanned, Number(limitEl.value||pageLimit)));
      }
    }

    // старт: главная
    enqueuePage(SITE.homeUrl, 0);

    // воркеры
    const N = Math.max(1, Math.min(concurrency, 10));
    async function worker(){
      while (!stopFlag){
        const task = queue.shift();
        if (!task){ await delay(80); continue; }
        if (task.rowIndex >= Number(limitEl.value||pageLimit)) continue;
        await processPage(task);
      }
    }
    Array.from({length:N}, ()=>worker());

    // refresh главной каждые 30с
    async function refreshHome(){
      if (stopFlag || refreshing) return;
      refreshing = true;
      try{
        setMsg('Поиск новых ссылок на главной…');
        const txt = await fetchText(SITE.homeUrl, Number(timeoutEl.value||15)*1000);
        const links = parseLinksFromHTML(txt, SITE.homeUrl);
        let added = 0;
        for (const u of links){
          if (added >= MAX_NEW_PER_TICK) break;
          if (!accounted.has(canonicalize(u)) && sameHost(u) && !isSkippable(u)){
            enqueuePage(u, 1);
            added++;
          }
        }
        console.log(`[home-refresh] +${added} новых ссылок`);
      }catch(e){
        console.warn('home refresh error', e);
      }finally{
        refreshing = false;
      }
    }

    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshHome, REFRESH_MS);
    refreshHome();

    setLoading(false);
    setMsg('Режим: только главная как источник. Обновление каждые 30 секунд ✓','success');
  }

  // === Handlers
  crawlBtn?.addEventListener('click', async ()=>{
    const dom = normUrl(domainEl.value);
    if (!dom){ setMsg('Укажи домен','error'); return; }
    stopFlag = false;
    clearInterval(refreshTimer); refreshTimer = null;
    updateProgress(0,0);
    await liveCrawl(dom, {
      maxDepth: Number(depthEl.value||1),
      pageLimit: Number(limitEl.value||5000),
      fetchTimeout: Number(timeoutEl.value||15)*1000,
      concurrency: Number(concEl.value||4)
    });
  });

  stopBtn?.addEventListener('click', ()=>{
    stopFlag = true;
    controllers.forEach(c => c.abort('stopped')); controllers.clear();
    clearInterval(refreshTimer); refreshTimer = null; refreshing = false;
    setLoading(false);
    setMsg('Остановлено пользователем','error');
  });
  

  copyBtn?.addEventListener('click', ()=>{
    copyIssuesToClipboard();
  });
})();




