document.addEventListener('DOMContentLoaded', () => {
  console.log('parser.js загружен');

  // ===== Состояние =====
  const state = {
    domain: '',
    kinopoiskId: '',
    seasonsData: null,
    lastResponse: null,
    uiState: {
      isLoading: false,
      activeSeason: null
    },
    saveStatus: 'saved'
  };

  // ===== Элементы =====
  const elements = {
    domainInput: document.getElementById('domain-input'),
    idInput: document.getElementById('id-input'),
    actionButton: document.getElementById('action-button'),
    resultDiv: document.getElementById('result-div'),
    downloadsContainer: document.getElementById('download-buttons-container'),
    saveDot: document.getElementById('save-status')
  };

  // ===== Хелперы =====
  const showMessage = (text, type = 'info') => {
    const types = {
      success: { color: '#10b981' },
      error:   { color: '#ef4444' },
      info:    { color: '#3b82f6' }
    };
    const c = (types[type] || types.info).color;
    elements.resultDiv.innerHTML = `<div style="color:${c}">${text}</div>`;
  };

  const loadState = () => {
    const saved = localStorage.getItem('parserState');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      Object.assign(state, parsed);
      if (elements.domainInput) elements.domainInput.value = state.domain || '';
      if (elements.idInput) elements.idInput.value = state.kinopoiskId || '';
    } catch (e) {
      console.warn('Не удалось прочитать parserState из localStorage', e);
    }
  };

  const saveState = () => {
    localStorage.setItem('parserState', JSON.stringify(state));
  };

  const updateUI = () => {
    if (elements.actionButton) {
      elements.actionButton.disabled = !!state.uiState.isLoading;
      elements.actionButton.innerHTML = state.uiState.isLoading
        ? '<span class="loading"></span> Загрузка...'
        : 'Получить данные';
    }
    if (elements.saveDot) {
      elements.saveDot.className = `status-indicator ${state.saveStatus === 'saved' ? 'status-saved' : 'status-saving'}`;
      elements.saveDot.title = state.saveStatus === 'saved' ? 'Все изменения сохранены' : 'Сохранение...';
    }
  };

  // Автосохранение ввода
  const debounce = (fn, t = 400) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), t);
    };
  };

  const autoSave = debounce(() => {
    state.domain = (elements.domainInput?.value || '').trim();
    state.kinopoiskId = (elements.idInput?.value || '').trim();
    state.saveStatus = 'saving';
    updateUI();
    saveState();
    state.saveStatus = 'saved';
    updateUI();
  }, 500);

  if (elements.domainInput) elements.domainInput.addEventListener('input', autoSave);
  if (elements.idInput) elements.idInput.addEventListener('input', autoSave);

  // ====== Парсер ======
  elements.actionButton.addEventListener('click', async () => {
    state.domain = elements.domainInput.value.trim();
    state.kinopoiskId = elements.idInput.value.trim();
    if (!state.kinopoiskId) {
      showMessage('Введите Kinopoisk ID!', 'error');
      return;
    }
    state.uiState.isLoading = true;
    saveState();
    updateUI();

    try {
      const response = await fetch(
        `https://api.bhcesh.me/franchise/details?token=b0ea0785621e530c842ce502aa0de81c&kinopoisk_id=${state.kinopoiskId}`
      );
      if (!response.ok) throw new Error(`Ошибка HTTP: ${response.status}`);
      const data = await response.json();
      state.lastResponse = data;

      if (data?.seasons) processSeasonsData(data.seasons);
      else throw new Error('Данные о сезонах не найдены');
    } catch (error) {
      console.error('Ошибка:', error);
      showMessage(error.message, 'error');
      state.lastResponse = { error: error.message };
    } finally {
      state.uiState.isLoading = false;
      saveState();
      updateUI();
    }
  });

  const processSeasonsData = (seasons) => {
    state.seasonsData = {};
    seasons.forEach(season => {
      const seasonNum = season.season;
      state.seasonsData[seasonNum] = (season.episodes || []).map(ep => {
        const episodeData = {
          domain: state.domain,
          kinopoisk_id: +state.kinopoiskId,
          season: seasonNum,
          episode: ep.episode,
          name: ep.name || 'Без названия'
        };
        if (ep.episode === 1) episodeData.divider = `Сезон ${seasonNum}`;
        return episodeData;
      });
    });
    renderSeasonsData();
  };

  const renderSeasonsData = () => {
    if (!state.seasonsData) return;
    const totalSeasons = Object.keys(state.seasonsData).length;
    const totalEpisodes = Object.values(state.seasonsData).reduce((sum, eps) => sum + eps.length, 0);
    showMessage(`Успешно загружено!<br>Сезонов: ${totalSeasons}<br>Эпизодов: ${totalEpisodes}`, 'success');
    renderDownloadButtons();
  };

  const renderDownloadButtons = () => {
    elements.downloadsContainer.innerHTML = '';
    Object.keys(state.seasonsData)
      .sort((a, b) => Number(a) - Number(b))
      .forEach(seasonNum => {
        const btn = document.createElement('button');
        btn.className = `download-button ${state.uiState.activeSeason === seasonNum ? 'active' : ''}`;
        btn.innerHTML = `Сезон ${seasonNum}<div class="episode-count">${state.seasonsData[seasonNum].length} эп.</div>`;

        btn.addEventListener('click', async () => {
          state.uiState.activeSeason = seasonNum;
          saveState();
          updateUI();

          const data = JSON.stringify(state.seasonsData[seasonNum], null, 2);
          const safeDomain = (state.domain || 'domain').replace(/\W+/g, '-');
          const filename = `${safeDomain}_season_${seasonNum}.json`;

          // Если запускаешь как расширение Chrome
          if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
            chrome.downloads.download({
              url: URL.createObjectURL(new Blob([data], { type: 'application/json' })),
              filename,
              saveAs: true
            }, () => {
              if (chrome.runtime.lastError) {
                showMessage(`Ошибка скачивания: ${chrome.runtime.lastError.message}`, 'error');
              } else {
                showMessage(`Сезон ${seasonNum} успешно сохранен`, 'success');
              }
            });
          } else {
            // Обычная web-страница
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            showMessage(`Сезон ${seasonNum} успешно сохранен`, 'success');
          }
        });

        elements.downloadsContainer.appendChild(btn);
      });
  };

  // ==== init ====
  loadState();
  updateUI();
});


