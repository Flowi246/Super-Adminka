document.addEventListener('DOMContentLoaded', ()=>{
  const kpInput = document.getElementById('id-input');
  const btn = document.getElementById('fetch-summary');
  const tableBody = document.querySelector('#summary-table tbody');
  const chips = document.getElementById('summary-chips');
  const msg = document.getElementById('summary-msg');
  const breakdowns = document.getElementById('per-api-breakdowns');

  const setMsg = (text, type='info')=>{
    msg.className = `msg ${type}`;
    msg.innerHTML = text;
  };

  const fmt = {
    num(n){ return (n==null || Number.isNaN(n)) ? '—' : String(n); },
    safe(s){ return s ? String(s) : '—'; }
  };

  async function fetchJSON(url){
    const r = await fetch(url, { credentials: 'omit' });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // ---- Aderom с CORS-фолбэком ----
  async function fetchAderomWithFallback(kp){
    const base = `https://aderom.net/api/${encodeURIComponent(kp)}`;
    const attempts = [
      { label: 'direct', url: base },
      { label: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(base)}` },
      { label: 'isomorphic', url: `https://cors.isomorphic-git.org/${base}` },
      { label: 'thingproxy', url: `https://thingproxy.freeboard.io/fetch/${base}` },
    ];
    let lastErr;
    for(const a of attempts){
      try{
        const r = await fetch(a.url, { credentials:'omit' });
        if(!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        return { data, via: (a.label==='direct' ? '' : a.label) };
      }catch(e){ lastErr = e; }
    }
    throw lastErr || new Error('Aderom: failed');
  }

  // ---------- detectAnime (оставлено, но не рисуем в UI) ----------
  function detectAnime(obj){
    if (typeof obj?.is_anime === 'boolean') return obj.is_anime;
    if (typeof obj?.anime === 'boolean') return obj.anime;
    if (typeof obj?.isAnime === 'boolean') return obj.isAnime;
    if (typeof obj?.category === 'string' && /аниме/i.test(obj.category)) return true;
    if (typeof obj?.type === 'string' && /(anime|аниме)/i.test(obj.type)) return true;
    if (typeof obj?.genre === 'string' && /аниме/i.test(obj.genre)) return true;
    if (Array.isArray(obj?.genres) && obj.genres.some(g => /anime|аниме/i.test((g?.name||g)))) return true;
    const pool = [obj?.title, obj?.title_en, obj?.name, obj?.name_eng, obj?.original_name, obj?.title_orig]
      .filter(Boolean).join(' ').toLowerCase();
    if (/(anime|аниме|анiме)/.test(pool)) return true;
    return null;
  }

  // ---------- карточка разбивки ----------
  function renderBreakdownCard(sourceLabel, mapSeasonToCount, note=''){
    const card = document.createElement('div');
    card.className = 'break-card';
    const rows = Object.keys(mapSeasonToCount)
      .sort((a,b)=>Number(a)-Number(b))
      .map(s=>{
        const c = mapSeasonToCount[s];
        return `<tr><td>${s}</td><td>${fmt.num(c)}</td></tr>`;
      }).join('') || `<tr><td colspan="2">Данных о разбивке по сезонам нет</td></tr>`;

    card.innerHTML = `
      <h4>${sourceLabel}${note ? ` — <span class="muted">${note}</span>` : ''}</h4>
      <table class="mini-table">
        <thead><tr><th>Сезон</th><th>Серий</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    breakdowns.appendChild(card);
  }

  // ---------- «красивое поле» — глобальный максимум по всем API ----------
  function renderGlobalSeasonMax(globalMap){
    // вставляем в начало списка разбивок
    const card = document.createElement('div');
    card.className = 'break-card';
    card.style.borderColor = 'var(--accent)';

    // считаем итоги
    const seasons = Object.keys(globalMap).map(Number).filter(n=>!Number.isNaN(n)).sort((a,b)=>a-b);
    const totalSeasons = seasons.length;
    const totalEpisodes = seasons.reduce((acc, s)=> acc + (globalMap[String(s)]||0), 0);

    const rows = seasons.map(s => {
      const cnt = globalMap[String(s)];
      return `<tr><td>${s}</td><td>${fmt.num(cnt)}</td></tr>`;
    }).join('') || `<tr><td colspan="2">Нет данных</td></tr>`;

    card.innerHTML = `
      <h4>Итог по сезонам (макс по всем API)
        <span class="muted" style="margin-left:6px;">сезон → макс. серий</span>
      </h4>
      <table class="mini-table" style="margin-top:6px;">
        <thead><tr><th>Сезон</th><th>Серий</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="muted" style="margin-top:8px;text-align:right;">
        Всего сезонов: ${fmt.num(totalSeasons)} · Сумма серий: ${fmt.num(totalEpisodes)}
      </div>
    `;

    breakdowns.prepend(card);
  }

  // ---------- утилита агрегации: max по сезонам ----------
  function mergeSeasonMap(target, source){
    if (!source) return;
    for (const k of Object.keys(source)){
      const n = Number(k);
      if (Number.isNaN(n)) continue;
      const cur = Number(source[k]) || 0;
      target[k] = Math.max(target[k] || 0, cur);
    }
  }

  // ---------- Aderom: макс S/E и карта сезон→серии (макс по переводам) ----------
  function extractAderom(ad){
    let maxSeason = 0;
    let maxEpisodeOverall = 0;
    const perSeasonMaxEp = {}; // season -> max ep across translations

    if (Array.isArray(ad?.translation)) {
      for (const tr of ad.translation) {
        const seasons = tr?.seasons;
        if (!seasons || typeof seasons !== 'object') continue;

        for (const seasonKey of Object.keys(seasons)) {
          const seasonNum = Number(seasonKey) || 0;
          if (seasonNum > maxSeason) maxSeason = seasonNum;

          const v = seasons[seasonKey];
          let countForThisTranslation = 0;

          if (Array.isArray(v)) {
            const last = Number(v[v.length - 1]) || 0;
            countForThisTranslation = Math.max(v.length, last);
          } else if (typeof v === 'number') {
            countForThisTranslation = v;
          } else if (v && typeof v === 'object') {
            if (Array.isArray(v.episodes)) {
              const last = Number(v.episodes[v.episodes.length - 1]) || 0;
              countForThisTranslation = Math.max(v.episodes.length, last);
            } else if (typeof v.episodes === 'number') {
              countForThisTranslation = v.episodes;
            } else if (typeof v.last_episode === 'number') {
              countForThisTranslation = v.last_episode;
            }
          }

          perSeasonMaxEp[seasonKey] = Math.max(perSeasonMaxEp[seasonKey] || 0, countForThisTranslation);
          if (perSeasonMaxEp[seasonKey] > maxEpisodeOverall) {
            maxEpisodeOverall = perSeasonMaxEp[seasonKey];
          }
        }
      }
    }

    const seasonNotes = Object.keys(perSeasonMaxEp)
      .sort((a,b)=>Number(a)-Number(b))
      .map(s => `S${s}:E${perSeasonMaxEp[s]}`).join(', ');

    return {
      ru: ad?.title,
      en: ad?.title_en,
      lastSeason: maxSeason || null,
      lastEpisode: maxEpisodeOverall || null,
      isAnime: detectAnime(ad),
      note: seasonNotes || '',
      seasonMap: perSeasonMaxEp
    };
  }

  // ---------- BHcesh: макс S/E + карта S→серий из seasons[].episodes ----------
  function extractBhcesh(data){
    let lastSeason = 0;
    let lastEpisode = 0;
    const seasonMap = {}; // season -> count

    if (Array.isArray(data?.seasons)) {
      for (const s of data.seasons) {
        const sNum = Number(s?.season) || 0;
        if (sNum > lastSeason) lastSeason = sNum;

        let epMax = 0;
        if (Array.isArray(s?.episodes)) {
          for (const ep of s.episodes) {
            const num = Number(ep?.episode) || 0;
            if (num > epMax) epMax = num;
          }
          epMax = Math.max(epMax, s.episodes.length);
        } else if (typeof s?.episodes === 'number') {
          epMax = s.episodes;
        }

        seasonMap[String(sNum)] = Math.max(seasonMap[String(sNum)] || 0, epMax);
        if (epMax > lastEpisode) lastEpisode = epMax;
      }
    }

    if (!lastSeason && typeof data?.last_season === 'number') lastSeason = data.last_season;
    if (!lastEpisode && typeof data?.last_episode === 'number') lastEpisode = data.last_episode;

    return {
      ru: data?.name,
      en: data?.name_eng,
      lastSeason: lastSeason || null,
      lastEpisode: lastEpisode || null,
      isAnime: detectAnime(data),
      note: '',
      seasonMap
    };
  }

  // ---------- Apbugall: status/data + seasons{ "1": { episodes{ "51": {...} } } } ----------
  function extractApbugall(resp){
    const ap = resp?.data ?? resp;
    let lastSeason = 0;
    let lastEpisode = 0;
    const seasonMap = {};

    if (ap?.seasons && typeof ap.seasons === 'object') {
      const seasonNums = Object.keys(ap.seasons)
        .map(k=>Number(k)).filter(n=>!Number.isNaN(n));
      if (seasonNums.length) {
        const maxSeasonKey = Math.max(...seasonNums);
        lastSeason = Math.max(lastSeason, maxSeasonKey);

        for (const sNum of seasonNums) {
          const seasonObj = ap.seasons[String(sNum)] || ap.seasons[sNum];
          let count = 0;
          if (seasonObj?.episodes && typeof seasonObj.episodes === 'object') {
            const epKeys = Object.keys(seasonObj.episodes)
              .map(k=>Number(k)).filter(n=>!Number.isNaN(n));
            if (epKeys.length) {
              count = epKeys.length;
              const epMax = Math.max(...epKeys);
              if (epMax > lastEpisode) lastEpisode = epMax;
            }
          } else if (Array.isArray(seasonObj?.episodes)) {
            const arr = seasonObj.episodes;
            const last = Number(arr[arr.length-1])||0;
            count = Math.max(arr.length, last, ...arr.map(Number).filter(n=>!Number.isNaN(n)));
            if (count > lastEpisode) lastEpisode = count;
          } else if (typeof seasonObj?.episodes === 'number') {
            count = seasonObj.episodes;
            if (count > lastEpisode) lastEpisode = count;
          }
          seasonMap[String(sNum)] = Math.max(seasonMap[String(sNum)] || 0, count);
        }
      }
    }

    // фолбэки по корню
    if (!lastSeason && typeof ap?.seasons_count === 'number') {
      lastSeason = ap.seasons_count;
    }
    if (!lastEpisode && typeof ap?.episodes === 'number') {
      lastEpisode = ap.episodes;
      if (!lastSeason) lastSeason = Number(ap?.last_season || ap?.seasons_count || 1);
      if (Object.keys(seasonMap).length === 0) {
        seasonMap['1'] = lastEpisode;
      }
    } else if (!lastEpisode && ap?.episodes && typeof ap.episodes === 'object') {
      const keys = Object.keys(ap.episodes).map(k=>Number(k)).filter(n=>!Number.isNaN(n));
      if (keys.length) {
        lastEpisode = Math.max(...keys);
        if (!lastSeason) lastSeason = Number(ap?.last_season || ap?.seasons_count || 1);
        if (Object.keys(seasonMap).length === 0) {
          seasonMap['1'] = lastEpisode;
        }
      }
    }
    if (!lastEpisode && typeof ap?.last_episode === 'number') {
      lastEpisode = ap.last_episode;
    }
    if (!lastSeason && typeof ap?.last_season === 'number') {
      lastSeason = ap.last_season;
    }
    if (!lastSeason) lastSeason = 1;

    return {
      ru: ap?.name,
      en: ap?.original_name,
      lastSeason: lastSeason || null,
      lastEpisode: lastEpisode || null,
      isAnime: detectAnime(ap),
      note: '',
      seasonMap
    };
  }

  // ---------- Kodik: last_*; строим частичную карту (только последний сезон) ----------
  function extractKodik(item){
    const lastSeason = Number(item?.last_season ?? 0) || 0;
    const lastEpisode = Number(item?.last_episode ?? 0) || 0;
    const seasonMap = {};
    if (lastSeason && lastEpisode) {
      seasonMap[String(lastSeason)] = lastEpisode; // только последний сезон
    }
    return {
      ru: item?.title,
      en: item?.title_orig,
      lastSeason: lastSeason || null,
      lastEpisode: lastEpisode || null,
      isAnime: detectAnime(item),
      note: 'last_season/last_episode',
      seasonMap
    };
  }

  function addRow(i, source, ru, en, lastSeason, lastEpisode){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i}</td>
      <td>${source}</td>
      <td>${fmt.safe(ru)}</td>
      <td>${fmt.safe(en)}</td>
      <td>${fmt.num(lastSeason)}</td>
      <td>${fmt.num(lastEpisode)}</td>
    `;
    tableBody.appendChild(tr);
  }

  function addChip(label, lastSeason, lastEpisode, tone=''){
    const d = document.createElement('div');
    d.className = `chip ${tone}`;
    d.textContent = `${label}: S${lastSeason ?? '—'} / E${lastEpisode ?? '—'}`;
    chips.appendChild(d);
  }

  function clearUI(){
    tableBody.innerHTML = '';
    chips.innerHTML = '';
    breakdowns.innerHTML = '';
    setMsg('', 'info');
  }

  btn.addEventListener('click', async ()=>{
    const kp = kpInput.value.trim();
    if(!kp){ setMsg('Введите Kinopoisk ID', 'error'); return; }
    clearUI();
    setMsg('Загружаю…', 'info');

    const urls = {
      BHcesh: `https://api.bhcesh.me/franchise/details?token=b0ea0785621e530c842ce502aa0de81c&kinopoisk_id=${encodeURIComponent(kp)}`,
      Kodik:  `https://kodikapi.com/search?token=57e7a86d71861542dcb4f01a98480d3e&kinopoisk_id=${encodeURIComponent(kp)}`
    };

    let i=1, errs=[];
    const globalSeasonMax = {};

    // 1) Aderom - Холес (Gencit)
    try{
      const { data: ad, via } = await fetchAderomWithFallback(kp);
      const a = extractAderom(ad);
      addRow(i++,'Холес', a.ru, a.en, a.lastSeason, a.lastEpisode);
      addChip('Холес', a.lastSeason, a.lastEpisode, 'chip-good');
      renderBreakdownCard('Холес', a.seasonMap);
      mergeSeasonMap(globalSeasonMax, a.seasonMap);
    }catch(e){ errs.push(`Холес: ${e.message}`); }

    // 2) Apbugall - Аллоха (Polynoy)
    try{
      const ap = await fetchJSON(`https://api.apbugall.org/?token=e9a962df5e96874972bd776d247fa6&kp=${encodeURIComponent(kp)}`);
      const a = extractApbugall(ap);
      addRow(i++,'Аллоха', a.ru, a.en, a.lastSeason, a.lastEpisode);
      addChip('Аллоха', a.lastSeason, a.lastEpisode, 'chip-good');
      renderBreakdownCard('Аллоха', a.seasonMap);
      mergeSeasonMap(globalSeasonMax, a.seasonMap);
    }catch(e){ errs.push(`Аллоха: ${e.message}`); }

    // 3) BHcesh - Ревал (Linktodo)
    try{
      const r = await fetchJSON(urls.BHcesh);
      const b = extractBhcesh(r);
      addRow(i++,'Ревал', b.ru, b.en, b.lastSeason, b.lastEpisode);
      addChip('Ревал', b.lastSeason, b.lastEpisode, 'chip-good');
      renderBreakdownCard('Ревал', b.seasonMap);
      mergeSeasonMap(globalSeasonMax, b.seasonMap);
    }catch(e){ errs.push(`Ревал: ${e.message}`); }

    // 4) Kodik - Кодик
    try{
      const r = await fetchJSON(urls.Kodik);
      const item = Array.isArray(r?.results) ? r.results[0] : r;
      const k = extractKodik(item);
      addRow(i++,'Кодик', k.ru, k.en, k.lastSeason, k.lastEpisode);
      addChip('Кодик', k.lastSeason, k.lastEpisode, 'chip-warn');
      renderBreakdownCard('Кодик', k.seasonMap, 'API даёт только последний сезон');
      mergeSeasonMap(globalSeasonMax, k.seasonMap);
    }catch(e){ errs.push(`Кодик: ${e.message}`); }


    // === Итог: «в каждом сезоне сколько должно быть серий» (макс по всем API) ===
    if (Object.keys(globalSeasonMax).length){
      renderGlobalSeasonMax(globalSeasonMax);
    }

    if (i===1){
      setMsg('Не удалось получить данные ни из одного API (возможен CORS/сеть).', 'error');
    } else if (errs.length){
      setMsg(`Готово с частичными ошибками: ${errs.join(' · ')}`, 'error');
    } else {
      setMsg('Готово ✅', 'success');
    }
  });
});

