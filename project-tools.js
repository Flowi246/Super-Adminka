/* Проекты + Парсер Википедии (ru, адаптив, умный поиск wiki по типу: фильм/сериал/аниме) */
const $ = (s) => document.querySelector(s);
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

// Константы
const KP_API_KEY = 'QJHNAG0-H4AM2TT-J59HBPM-YA6CZ7A';
const WIKI_LANG = 'ru';

/* ===================== ТАБЫ (делегирование) ===================== */
function switchTab(key){
  if(!key) return;
  document.querySelectorAll('.tab').forEach(b=>{
    b.classList.toggle('active', b.dataset.tab === key);
  });
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const panel = document.querySelector('#tab-'+key);
  if(panel) panel.classList.add('active');
  // прокрутка к началу (приятнее на мобилках)
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Делегирование кликов по вкладкам — работает, даже если вкладки подгрузили позже
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.tab');
  if(!btn) return;
  e.preventDefault();
  switchTab(btn.dataset.tab);
});

// Инициализация активной вкладки (после загрузки страницы и после вставки header.html/footer.html)
function initTabsDefault(){
  const active = document.querySelector('.tab.active') || document.querySelector('.tab');
  if(active) switchTab(active.dataset.tab);
}
window.addEventListener('DOMContentLoaded', initTabsDefault);
document.addEventListener('layout:ready', initTabsDefault); // см. layout.js

/* ===================== Утилиты ===================== */
function toast(msg, type='ok', ms=2600){
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg; document.body.appendChild(t);
  setTimeout(()=>t.remove(), ms);
}
function prettyJSON(v){ try{return JSON.stringify(v,null,2)}catch{ return String(v)} }
function downloadJSON(filename, obj){
  const blob = new Blob([JSON.stringify(obj,null,2)], {type:'application/json;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}
function parseIdList(raw){ return (raw||'').split(/[\s,;]+/g).map(s=>s.trim()).filter(Boolean) }
function headingTagFromNumber(numStr){
  const depth = (numStr||'').split('.').filter(Boolean).length; // "1.2.1" -> 3
  const lvl = Math.min(6, Math.max(2, 1 + depth)); // 1->h2..6
  return `h${lvl}`;
}

/* ===================== 1) СЕРИАЛЫ ===================== */
let seriesData = null;
on($('#series-build'),'click',()=>{
  const domain = $('#series-domain').value.trim();
  const kp = $('#series-kp').value.trim();
  const n = Math.max(1, Number($('#series-seasons').value||1));
  if(!domain || !kp){ toast('Заполните домен и Kinopoisk ID', 'err'); return; }
  const arr = Array.from({length:n}, (_,i)=>({ domain, kinopoisk_id: kp, season: String(i+1) }));
  seriesData = arr;
  $('#series-preview').textContent = prettyJSON(arr);
  $('#series-download').disabled = false;
  toast(`Готово: ${n} сезон(ов)`);
});
on($('#series-download'),'click',()=>{
  if(!seriesData) return;
  const domain = $('#series-domain').value.trim().replace(/[^a-z0-9.-]/gi,'_');
  const kp = $('#series-kp').value.trim();
  const n = Number($('#series-seasons').value||seriesData.length);
  downloadJSON(`series_${kp}_${domain}_${n}seasons.json`, seriesData);
});

/* ===================== 2) ФИЛЬМЫ ===================== */
let moviesData = null;
on($('#movies-build'),'click',()=>{
  const domain = $('#movies-domain').value.trim();
  const ids = parseIdList($('#movies-kp-list').value);
  if(!domain || ids.length===0){ toast('Заполните домен и хотя бы один ID', 'err'); return; }
  const arr = ids.map(kp=>({ domain, kinopoisk_id: kp }));
  moviesData = arr;
  $('#movies-preview').textContent = prettyJSON(arr);
  $('#movies-download').disabled = false;
  toast(`Готово: ${arr.length} записей`);
});
on($('#movies-download'),'click',()=>{
  if(!moviesData) return;
  const domain = $('#movies-domain').value.trim().replace(/[^a-z0-9.-]/gi,'_');
  downloadJSON(`movies_${domain}_${moviesData.length}.json`, moviesData);
});

/* ===================== 3) ВИКИ-ПАРСЕР ===================== */
// 3.1 Kinopoisk API
async function fetchKinopoiskMovie(id){
  if(!id) throw new Error('Укажите Kinopoisk ID');
  const endpoint = `https://api.kinopoisk.dev/v1.4/movie/${encodeURIComponent(id)}`;
  const res = await fetch(endpoint, { headers: { 'X-API-KEY': KP_API_KEY, 'accept': 'application/json' } });
  if(!res.ok){
    let text = ''; try{ text = await res.text(); } catch {}
    throw new Error(`Kinopoisk API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

/* ===== Определение медиа-типа под Википедию (фильм/сериал/аниме) */
function inferMediaType(kp){
  const t = (kp?.type || '').toLowerCase();
  const genres = (kp?.genres || []).map(g => (g?.name || '').toLowerCase());
  const isSeriesFlag = kp?.isSeries === true || kp?.seriesLength > 0 || ['tv-series','mini-series','animated-series','anime-series'].includes(t);

  const isAnime = t.includes('anime') || genres.includes('аниме') || genres.includes('anime');
  if(isAnime){
    return isSeriesFlag ? 'anime-series' : 'anime-film';
  }
  if(isSeriesFlag || t.includes('tv') || t.includes('series')){
    return 'series';
  }
  // мультфильмы считаем фильмами, если не сериал
  if(t.includes('cartoon') || genres.includes('мультфильм')){
    return 'film';
  }
  return 'film';
}

/* ===== Наборы подсказок и фильтров для ruwiki */
function wikiHintsFor(media){
  switch(media){
    case 'series':       return ['телесериал','сериал'];
    case 'anime-series': return ['аниме сериал','аниме','японский анимационный сериал','телесериал'];
    case 'anime-film':   return ['аниме фильм','аниме','японский анимационный фильм','фильм','мультфильм'];
    case 'film':
    default:             return ['фильм','кинофильм','художественный фильм'];
  }
}
function wikiAllowedTokens(media){
  switch(media){
    case 'series':       return ['телесериал','сериал'];
    case 'anime-series': return ['аниме сериал','аниме','японский анимационный сериал','мультсериал','телесериал'];
    case 'anime-film':   return ['аниме фильм','аниме','японский анимационный фильм','мультфильм','фильм'];
    case 'film':
    default:             return ['фильм','кинофильм','художественный фильм','мультфильм'];
  }
}

/* ===== Поиск по Википедии с приоритетом нужного типа ===== */
async function searchWikipediaSmart(name, year, media){
  const hints = wikiHintsFor(media);
  const allowed = wikiAllowedTokens(media).map(s => s.toLowerCase());

  const variants = [];
  for(const h of hints){
    if(year) variants.push(`"${name}" ${year} ${h}`);
    variants.push(`"${name}" ${h}`);
  }
  if(year) variants.push(`"${name}" ${year}`);
  variants.push(`"${name}"`);

  for(const q of variants){
    const url = `https://${WIKI_LANG}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&utf8=1&origin=*`;
    const data = await fetch(url).then(r=>r.json()).catch(()=>null);
    const hits = data?.query?.search || [];
    if(!hits.length) continue;

    const best = chooseBestWikiHit(hits, allowed, year);
    if(best) return { title: best.title, usedQuery: q };
  }
  return { title: null, usedQuery: null };
}

function chooseBestWikiHit(hits, allowedTokens, year){
  const byYear = year ? hits.find(h => (h?.title || '').includes(String(year))) : null;
  if(byYear) return byYear;

  const hasTokens = (text) => {
    const low = (text || '').toLowerCase();
    return allowedTokens.some(tok => low.includes(tok));
  };

  const filtered = hits.filter(h => hasTokens(h?.title) || hasTokens(h?.snippet));
  if(filtered.length) return filtered[0];

  return hits[0] || null;
}

/* ===== Секции из статьи (только заголовки) ===== */
async function getSections(title){
  const url = `https://${WIKI_LANG}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=sections&redirects=1&format=json&utf8=1&origin=*`;
  const data = await fetch(url).then(r=>r.json());
  return data?.parse?.sections || [];
}

async function buildFilmHeadingsHtmlSmart(name, year, media){
  const { title, usedQuery } = await searchWikipediaSmart(name, year, media);
  if(!title) return { title: null, usedQuery, html: `<p>Материал по «${name}» не найден.</p>`, sections: [] };

  const sections = await getSections(title);
  const skip = new Set(['Примечания','Ссылки','См. также','Источники']);
  let out = `<!-- ${title} -->\n`;
  const clean = [];
  for(const s of sections){
    const heading = String(s.line||'').trim();
    if(skip.has(heading)) continue;
    const tag = headingTagFromNumber(s.number||'1');
    out += `<${tag}>${heading}</${tag}>\n`;
    clean.push({ ...s, line: heading, _tag: tag });
  }
  return { title, usedQuery, html: out.trim(), sections: clean };
}

/* ===== Генерация промтов из заголовков ===== */
function promptsFromSections(sections){
  if(!sections || sections.length===0){
    sections = [
      { line:'Сюжет', number:'1' },
      { line:'Актёрский состав', number:'1.1' },
      { line:'Производство', number:'1.2' },
      { line:'Премьера', number:'1.3' },
    ];
  }
  const blocks = sections.map(s=>{
    const hTag = headingTagFromNumber(s.number||'1');
    const level = Number(hTag.slice(1)) || 2;
    const title = String(s.line||'').trim();
    // ВАЖНО: {{temp.0.type}} и {{temp.0.name}} не изменяем
    return `[[Напиши мне подробную статью на тему ${title} {{temp.0.type}}а {{temp.0.name}}, так же напиши уникальный заголовок h${level}. Перед списком должен быть вступительный текст. Напиши уникальный длинный текст]]`;
  });
  return blocks.join('\n');
}

/* ===== Запуск кнопки ===== */
on($('#wiki-run'), 'click', async ()=>{
  const id = $('#wiki-kp').value.trim();

  $('#wiki-prompts').value = '';
  $('#wiki-headings').value = '';
  $('#wiki-title').textContent = '—';
  $('#wiki-query').textContent = '—';
  $('#wiki-copy-prompts').disabled = true;
  $('#wiki-copy-headings').disabled = true;

  try{
    const data = await fetchKinopoiskMovie(id);
    const media = inferMediaType(data);               // фильм / сериал / аниме
    const name = data?.name || data?.alternativeName || `KP-${id}`;
    let year = '';
    if(data?.world){ const d = new Date(data.world); if(!isNaN(+d)) year = String(d.getFullYear()); }
    if(!year && data?.year) year = String(data.year);

    const { title, usedQuery, html, sections } = await buildFilmHeadingsHtmlSmart(name, year, media);
    $('#wiki-query').textContent = usedQuery || `${name} ${year}`.trim();

    if(!title){
      $('#wiki-headings').value = html;
      toast('Статья Wikipedia не найдена под нужный тип', 'err');
      return;
    }
    $('#wiki-title').textContent = title;
    $('#wiki-headings').value = html;

    const prompts = promptsFromSections(sections);
    $('#wiki-prompts').value = prompts;

    $('#wiki-copy-prompts').disabled = false;
    $('#wiki-copy-headings').disabled = false;
    toast('Готово: найдено в Википедии с учётом типа (фильм/сериал/аниме)');
  }catch(e){
    console.error(e);
    toast(e.message || 'Ошибка запроса', 'err', 5000);
  }
});

/* ===== Копирование ===== */
on($('#wiki-copy-prompts'),'click', async ()=>{
  try{ await navigator.clipboard.writeText($('#wiki-prompts').value||''); toast('Промты скопированы'); }
  catch{ toast('Не удалось копировать', 'err'); }
});
on($('#wiki-copy-headings'),'click', async ()=>{
  try{ await navigator.clipboard.writeText($('#wiki-headings').value||''); toast('HTML заголовков скопирован'); }
  catch{ toast('Не удалось копировать', 'err'); }
});
