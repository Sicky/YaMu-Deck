const $ = selector => document.querySelector(selector);
const audio = $('#audio');
function publishMediaState(seeked=false) {
  const track=queue[index];
  if('mediaSession' in navigator){navigator.mediaSession.playbackState=track?(audio.paused?'paused':'playing'):'none';if(!track)navigator.mediaSession.metadata=null;}
  call('media-state',{id:track?String(track.id):'',title:track?.title||'',artist:track?.artists?.map(a=>a.name).join(', ')||'',album:track?.albums?.[0]?.title||'',art:imageURL(track),duration:Number.isFinite(audio.duration)?audio.duration:Math.max(0,(track?.durationMs||0)/1000),position:audio.currentTime||0,volume:audio.volume,status:track?(audio.paused?'Paused':'Playing'):'Stopped',canNext:queue.length>1||waveMode,canPrevious:waveMode?index>0:queue.length>1,seeked}).catch(()=>{});
}
let account, page = 'home', queue = [], index = -1, liked = new Set(), shuffled = false, repeating = false, loadVersion = 0, viewVersion = 0, authVersion = 0, toastTimer;
let waveMode = false, waveGeneration = 0, waveLoading = null;
let waveStarting = false;
let waveStartedId='';
let quality = ['nq','hq','lossless'].includes(localStorage.getItem('quality')) ? localStorage.getItem('quality') : 'hq';
let actualAudio = null;
function updateQuality() {
  $('#track-quality').textContent = actualAudio ? `${actualAudio.codec.toUpperCase()}${actualAudio.codec === 'flac' ? ' · Lossless' : ''}${actualAudio.bitrate ? ` · ${actualAudio.bitrate} кбит/с` : ''}` : '';
  document.querySelectorAll('[data-quality]').forEach(button => { const selected = button.dataset.quality === quality; button.classList.toggle('selected',selected); button.setAttribute('aria-pressed',String(selected)); });
  $('#quality-open').textContent = actualAudio ? actualAudio.codec === 'flac' ? 'FLAC' : `${actualAudio.bitrate}k` : {nq:'NQ',hq:'HQ',lossless:'FLAC'}[quality];
  $('#quality-status').textContent = actualAudio ? `Сейчас: ${actualAudio.codec.toUpperCase()}${actualAudio.bitrate ? ` · ${actualAudio.bitrate} кбит/с` : ''}` : 'Выберите качество для воспроизведения.';
}
function waveEvent(type) {
  const track = queue[index];
  if (!waveMode || !track) return Promise.resolve();
  return call('waveFeedback',type,track.id,track._waveBatch || '',Math.max(0,Math.min(86400,Number(audio.currentTime)||0))).catch(e => toast(e.message));
}
async function extendWave() {
  if (waveLoading) return waveLoading;
  const generation = waveGeneration, current = queue[index];
  const pending = (async () => {
    const tracks = await call('wave',current?.id);
    if (!waveMode || generation !== waveGeneration) return;
    const recent = new Set(queue.slice(-25).map(t=>String(t.id)));
    const fresh = tracks.filter(t => {const id = String(t.id); if(recent.has(id)) return false; recent.add(id); return true;});
    queue.push(...fresh);
    if (page === 'queue') { const scroll = $('main').scrollTop; trackList(queue,'Сейчас в очереди','Моя волна · персональные рекомендации'); $('main').scrollTop = scroll; }
  })();
  waveLoading = pending;
  try { await pending; } finally { if (waveLoading === pending) waveLoading = null; }
}
async function startWave() {
  if (!account) return openAuth();
  if (waveStarting) return;
  waveStarting = true;
  waveEvent('skip');
  const generation = ++waveGeneration;
  ++loadVersion; waveLoading = null; waveMode = true; audio.pause();
  audio.removeAttribute('src'); audio.load(); queue = []; index = -1; updateLike(); actualAudio = null; updateQuality();
  $('#wave-nav').classList.add('active'); toast('Настраиваем вашу волну…');
  try {
    const tracks = await call('wave');
    if (generation !== waveGeneration) return;
    if (!tracks.length) throw new Error('Моя волна пока не вернула треки. Попробуйте ещё раз.');
    await call('waveFeedback','radioStarted',undefined,tracks[0]._waveBatch || '',0);
    if (generation !== waveGeneration) return;
    await playTrack(tracks,0,{wave:true,feedbackDone:true});
  } catch(e) { if (generation === waveGeneration) { waveMode = false; $('#wave-nav').classList.remove('active'); toast(e.message); } }
  finally { waveStarting = false; }
}
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const time = seconds => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2,'0')}`;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 6500); }
async function call(method, ...args) { const result = await window.yamu[method](...args); if (!result.ok) throw new Error(result.error); return result.data; }
function imageURL(track) { const uri = track?.coverUri || track?.albums?.[0]?.coverUri; if (!uri) return ''; const url = `https://${uri.replace('%%','200x200')}`; try { const parsed = new URL(url); return /(^|\.)(yandex\.net|yandex\.ru)$/.test(parsed.hostname) ? url : ''; } catch { return ''; } }
function cover(track, cls = 'cover') { const url = imageURL(track); return url ? `<img class="${cls}" src="${escapeHTML(url)}" alt="" loading="lazy">` : `<span class="${cls}">${icon('music_note')}</span>`; }
function openAuth() { if (!$('#auth').open) $('#auth').showModal(); }
function signedIn(result) { account = result.account; $('#username').textContent = account.displayName || account.login || 'Слушатель'; $('#account-label').textContent = 'Яндекс Музыка'; $('#login-top').textContent = 'Аккаунт'; $('#storage-note').textContent = result.saved ? 'Вход сохранён в зашифрованном хранилище системы.' : 'Защищённое хранилище недоступно: вход действует до закрытия приложения.'; $('#auth').close(); $('#token').value = ''; authVersion++; render('home'); const currentAccount = account; call('likes').then(ids => { if (account === currentAccount) { liked = new Set(ids); updateLike(); } }).catch(e => toast(e.message)); }
function home() {
  $('#content').innerHTML = `<div class="eyebrow">ХОРОШИЙ ДЕНЬ ДЛЯ МУЗЫКИ</div><h1>${account ? 'Снова вместе.' : 'В своём ритме.'}</h1><p class="intro">Любимые треки и новые открытия. Где бы вы ни играли.</p><div class="hero"><div class="hero-text"><div class="eyebrow">ПЕРСОНАЛЬНЫЕ РЕКОМЕНДАЦИИ</div><h2>Моя волна</h2><p>Любимое и новое — в вашем ритме.<br>Бесконечный поток музыки, подобранной для вас.</p><button id="hero-play" class="yellow">${icon('play_arrow')}  ${account ? 'Включить Мою волну' : 'Подключить Яндекс Музыку'}</button></div><div class="hero-art" aria-hidden="true"></div></div><div class="section-head"><h2>Ближе к вашей музыке</h2><small>Ваш следующий саундтрек</small></div><div class="cards"><button class="card" data-go="library"><span class="card-arrow">${icon('arrow_forward')}</span><span class="card-symbol">${icon('favorite_border')}</span><strong>Мне нравится</strong><small>Треки, которые остались с вами</small></button><button class="card" data-go="playlists"><span class="card-arrow">${icon('arrow_forward')}</span><span class="card-symbol">${icon('library_music')}</span><strong>Ваши плейлисты</strong><small>Для каждой игры и каждого дня</small></button><button class="card" data-go="search"><span class="card-arrow">${icon('arrow_forward')}</span><span class="card-symbol">${icon('search')}</span><strong>Найти своё</strong><small>Исполнитель, трек, новое увлечение</small></button></div>`;
  $('#hero-play').onclick = startWave;
  document.querySelectorAll('[data-go]').forEach(button => button.onclick = () => render(button.dataset.go));
}
let visibleTracks = [];
let queueReturn = null;
function updateNavigation() {
  $('main').classList.toggle('home-page',page==='home');
  document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('#breadcrumb').textContent = `Музыка / ${{home:'Для вас',search:'Поиск',library:'Мне нравится',playlists:'Плейлисты',queue:'Очередь'}[page] || 'Плейлист'}`;
  const isQueue = page === 'queue';
  $('#queue').classList.toggle('on', isQueue);
  $('#queue').setAttribute('aria-pressed', String(isQueue));
  $('#queue').setAttribute('aria-label', isQueue ? 'Закрыть очередь' : 'Открыть очередь');
  $('#queue').title = isQueue ? 'Закрыть очередь' : 'Открыть очередь';
}
function toggleQueue() {
  if (page === 'queue') {
    const previous = queueReturn; queueReturn = null;
    if (!previous || previous.loading) { render(previous?.page || 'home'); return; }
    ++viewVersion; page = previous.page; visibleTracks = previous.tracks;
    $('#content').replaceChildren(...previous.nodes); updateNavigation();
    $('main').scrollTop = previous.scroll;
    $('#queue').focus();
    return;
  }
  queueReturn = { page, nodes: [...$('#content').childNodes], tracks: visibleTracks, scroll: $('main').scrollTop, loading: !!$('#content [role="status"]') || $('#results')?.textContent === 'Ищем музыку…' };
  render('queue'); $('main').scrollTop = 0;
}
function trackList(tracks, title, subtitle = '') {
  visibleTracks = tracks;
  $('#content').innerHTML = `<div class="eyebrow">ВАША МУЗЫКА</div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(subtitle || `${tracks.length} треков`)}</p><div class="list">${tracks.length ? tracks.map((track, i) => `<button class="track ${String(queue[index]?.id) === String(track.id) ? 'current' : ''}" data-track="${i}">${cover(track)}<span class="track-info"><strong>${escapeHTML(track.title)}</strong><small>${escapeHTML(track.artists?.map(a => a.name).join(', ') || 'Неизвестный исполнитель')}</small></span><span class="track-time">${time(track.durationMs / 1000)}</span><span class="track-play">${icon('play_arrow')}</span></button>`).join('') : '<div class="empty">Здесь пока пусто. Найдите любимые треки через поиск.</div>'}</div>`;
  document.querySelectorAll('[data-track]').forEach(button => button.onclick = () => playTrack(tracks, Number(button.dataset.track), {wave:waveMode && tracks[Number(button.dataset.track)]._waveBatch !== undefined}));
}
async function render(next) {
  if (next !== 'queue') queueReturn = null;
  page = next; const version = ++viewVersion;
  updateNavigation();
  if (page === 'home') return home();
  if (page === 'queue') return trackList(queue, 'Сейчас в очереди');
  if (!account) { $('#content').innerHTML = '<div class="empty"><h2>Музыка начинается с вас</h2><p>Подключите аккаунт Яндекса, чтобы открыть свою коллекцию.</p><button class="yellow" id="empty-login">Войти через Яндекс</button></div>'; $('#empty-login').onclick = openAuth; return; }
  if (page === 'search') {
    $('#content').innerHTML = '<div class="eyebrow">МИЛЛИОНЫ ТРЕКОВ, ОДИН ВАШ</div><h1>Что будем слушать?</h1><form class="search-box" id="search-form"><input type="search" id="query" maxlength="300" placeholder="Трек или исполнитель" aria-label="Поиск музыки"><button class="yellow">Найти</button></form><div id="results"><p>Введите название и нажмите «Найти».</p></div>';
    $('#search-form').onsubmit = async event => {
      event.preventDefault(); const query = $('#query').value.trim(); if (!query) return;
      const requestVersion = ++viewVersion;
      $('#results').textContent = 'Ищем музыку…';
      try { const tracks = await call('search', query); if (requestVersion !== viewVersion) return;
        // Preserve the search form while reusing the accessible track list.
        const holder = document.createElement('div'); holder.append(...$('#content').childNodes);
        trackList(tracks, 'Результаты', query); const list = $('.list');
        $('#content').replaceChildren(...holder.childNodes); $('#results').replaceChildren(list);
      } catch (error) { if (requestVersion === viewVersion) $('#results').textContent = error.message; }
    }; $('#query').focus(); return;
  }
  $('#content').innerHTML = '<p role="status">Загружаем вашу музыку…</p>';
  try {
    if (page === 'library') { const tracks = await call('library'); if (version !== viewVersion) return; tracks.forEach(t => liked.add(String(t.id))); updateLike(); trackList(tracks, 'Мне нравится', 'Ваша личная коллекция · до 500 последних треков'); }
    else if (page === 'playlists') {
      const lists = await call('playlists'); if (version !== viewVersion) return;
      $('#content').innerHTML = `<div class="eyebrow">СОБРАНО ВАМИ</div><h1>Ваши плейлисты</h1><p>Музыка для любого момента.</p><div class="cards">${lists.map((list,i) => `<button class="card" data-playlist="${i}"><span class="card-symbol">${icon('library_music')}</span><strong>${escapeHTML(list.title)}</strong><small>${escapeHTML(list.trackCount || 0)} треков</small></button>`).join('')}</div>${lists.length ? '' : '<p>У вас пока нет плейлистов.</p>'}`;
      document.querySelectorAll('[data-playlist]').forEach(button => button.onclick = async () => { const list = lists[button.dataset.playlist]; const requestVersion = ++viewVersion; try { const tracks = await call('playlist', list.owner?.uid || account.uid, list.kind); if (requestVersion === viewVersion) trackList(tracks, list.title); } catch (e) { toast(e.message); } });
    }
  } catch (error) { if (version === viewVersion) { $('#content').innerHTML = '<div class="empty"><h2>Не удалось загрузить музыку</h2><p id="load-error"></p><button id="retry" class="yellow">Попробовать ещё раз</button></div>'; $('#load-error').textContent = error.message; $('#retry').onclick = () => render(next); } }
}
async function playTrack(tracks, position, options = {}) {
  if (!tracks[position]) return;
  const version = ++loadVersion;
  if (waveMode && !options.feedbackDone) await waveEvent('skip');
  if (version !== loadVersion) return;
  if (!options.wave) { waveMode = false; waveGeneration++; waveLoading = null; }
  $('#wave-nav').classList.toggle('active',waveMode);
  queue = [...tracks]; index = position; const track = queue[index]; waveStartedId='';
  audio.pause(); audio.removeAttribute('src'); audio.load();
  $('#now-title').textContent = track.title; $('#now-artist').textContent = track.artists?.map(a => a.name).join(', ') || ''; $('#now-cover').innerHTML = cover(track, ''); updateLike();
  actualAudio = null; updateQuality(); $('#quality-open').textContent = '…';
  try {
    const info = await call('playback', track.id, quality); if (version !== loadVersion) return;
    actualAudio = info; updateQuality();
    audio.src = info.url; if(!options.paused)await audio.play(); publishMediaState();
    if (version !== loadVersion) return;
    if (info.notice) toast(info.notice);
    if (waveMode && queue.length - index <= 3) extendWave().catch(e => toast(e.message));
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artists?.map(a => a.name).join(', ') || '', album: track.albums?.[0]?.title || '', artwork: imageURL(track) ? [{src:imageURL(track),sizes:'200x200',type:'image/jpeg'}] : [] });
  } catch (e) { if (version === loadVersion) { updateQuality(); toast(e.message); } }
}
let moving = false;
async function moveTrack(delta, finished = false, paused = false) {
  if (!queue.length || moving) return;
  moving = true; const version = loadVersion;
  try {
    if (waveMode) {
      await waveEvent(finished ? 'trackFinished':'skip');
      if (version !== loadVersion) return;
      if (delta > 0 && index >= queue.length - 1) await extendWave();
      if (version !== loadVersion) return;
      const next = index + delta;
      if (next < 0) return;
      if (next >= queue.length) { toast('Не удалось продолжить волну. Нажмите «Следующий трек», чтобы повторить.'); return; }
      await playTrack(queue,next,{wave:true,feedbackDone:true,paused});
    } else {
      const next = shuffled && queue.length > 1 ? (index + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length : (index + delta + queue.length) % queue.length;
      await playTrack(queue,next,{paused});
    }
  } catch(e) { toast(e.message); } finally { moving = false; }
}
function togglePlay() { if (waveStarting) return; if (!audio.src) { if (queue.length) playTrack(queue,Math.max(0,index),{wave:waveMode}); else if (page === 'home') startWave(); else toast('Сначала выберите трек'); return; } if (audio.paused) audio.play().catch(e => toast(e.message)); else audio.pause(); }
function updateLike() { const isLiked = liked.has(String(queue[index]?.id)); $('#like').disabled = index < 0; $('#like').innerHTML = icon(isLiked ? 'favorite' : 'favorite_border'); $('#like').classList.toggle('on',isLiked); }
$('#play').onclick = togglePlay; $('#prev').onclick = () => moveTrack(-1); $('#next').onclick = () => moveTrack(1);
$('#shuffle').onclick = () => { shuffled = !shuffled; $('#shuffle').classList.toggle('on',shuffled); $('#shuffle').setAttribute('aria-pressed',shuffled); };
$('#repeat').onclick = () => { repeating = !repeating; $('#repeat').classList.toggle('on',repeating); $('#repeat').setAttribute('aria-pressed',repeating); };
$('#like').onclick = async () => { const id = String(queue[index]?.id); const value = !liked.has(id); try { await call('like',id,value); value ? liked.add(id) : liked.delete(id); updateLike(); } catch (e) { toast(e.message); } };
$('#volume').oninput = event => { audio.volume = Number(event.target.value); localStorage.setItem('volume',audio.volume); };
audio.volume = Math.max(0,Math.min(1, Number(localStorage.getItem('volume') ?? 0.7))); $('#volume').value = audio.volume;
$('#seek').oninput = event => { if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * Number(event.target.value) / 100; };
audio.ontimeupdate = () => { $('#elapsed').textContent = time(audio.currentTime); $('#duration').textContent = time(audio.duration); $('#seek').value = audio.duration ? audio.currentTime / audio.duration * 100 : 0; };
audio.onplay = () => { $('#play').innerHTML = icon('pause'); call('playing',true).catch(() => {}); const id=String(queue[index]?.id||''); if(waveMode&&id&&waveStartedId!==id){waveStartedId=id;waveEvent('trackStarted');} };
audio.onpause = () => { $('#play').innerHTML = icon('play_arrow'); call('playing',false).catch(() => {}); };
audio.onended = () => { if (repeating) { audio.currentTime = 0; audio.play().catch(e => toast(e.message)); } else if (waveMode || index < queue.length - 1 || shuffled) moveTrack(1,true); };
audio.onerror = () => { if (audio.getAttribute('src')) toast('Ошибка аудиопотока. Выберите трек повторно или проверьте сеть.'); };
if ('mediaSession' in navigator) for (const [name, handler] of Object.entries({play:() => { if (audio.paused) togglePlay(); },pause:() => audio.pause(),previoustrack:() => moveTrack(-1),nexttrack:() => moveTrack(1),seekto:details => { audio.currentTime = details.seekTime; }})) { try { navigator.mediaSession.setActionHandler(name,handler); } catch {} }
document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => render(button.dataset.page));
$('#queue').onclick = toggleQueue; $('#login-top').onclick = () => account ? openPreferences().catch(e=>toast(e.message)) : openAuth();
$('#settings').onclick = () => $('#preferences').showModal(); $('#settings-close').onclick = () => $('#preferences').close();
async function openPreferences(){
  $('#preferences').showModal();
  const status=await call('media-status');
  $('#media-integration').textContent={ready:'Управление с панели Steam Deck готово: выберите Yamu в Decky Music Control.',starting:'Подключаем системное управление музыкой…',unavailable:'Системное управление музыкой недоступно. Запустите Yamu в пользовательской сессии SteamOS.',unsupported:'Управление из панели Steam Deck доступно в Linux-версии. В Windows используются системные медиакнопки.'}[status]||'';
}
$('#settings').onclick=()=>openPreferences().catch(e=>toast(e.message));
$('#wave-nav').onclick = startWave;
$('#quality-open').onclick = () => { updateQuality(); openPreferences().catch(e=>toast(e.message)); };
document.querySelectorAll('[data-quality]').forEach(button => button.onclick = () => { quality = button.dataset.quality; localStorage.setItem('quality',quality); updateQuality(); toast('Качество изменено. Применится со следующего трека.'); });
updateQuality();
function cancelAuth() { authVersion++; $('#token').value = ''; $('#device-code').textContent = ''; $('#auth-error').textContent = ''; $('#device-info').hidden = true; $('#device-start').disabled = false; call('device-cancel').catch(() => {}); }
$('#auth-close').onclick = () => $('#auth').close(); $('#auth').addEventListener('close',cancelAuth);
$('#device-start').onclick = async () => {
  const version = ++authVersion; $('#auth-error').textContent = ''; $('#device-start').disabled = true;
  try { const code = await call('device-start'); if (version !== authVersion) return; $('#device-info').hidden = false; $('#device-code').textContent = code.user_code; $('#auth-progress').textContent = 'Ожидаем подтверждения…';
    const deadline = Date.now() + code.expires_in * 1000;
    const poll = async () => { if (version !== authVersion) return; try { if (Date.now() > deadline) throw new Error('Код истёк. Запросите новый.'); const result = await call('device-poll'); if (version !== authVersion) return; if (result.account) signedIn(result); else setTimeout(poll,(code.interval + (result.slow ? 5 : 0)) * 1000); } catch (e) { if (version === authVersion) { $('#auth-error').textContent = e.message; $('#device-start').disabled = false; } } };
    setTimeout(poll,code.interval * 1000);
  } catch (e) { if (version === authVersion) { $('#auth-error').textContent = e.message; $('#device-start').disabled = false; } }
};
$('#open-auth').onclick = () => call('open-auth').catch(e => toast(e.message));
$('#token-form').onsubmit = async event => { event.preventDefault(); const version = ++authVersion; const button = $('#token-form button'); button.disabled = true; const pending = call('login',$('#token').value); $('#token').value = ''; try { const result = await pending; if (version === authVersion) signedIn(result); } catch (e) { if (version === authVersion) $('#auth-error').textContent = e.message; } finally { button.disabled = false; } };
$('#fullscreen').onclick = () => call('fullscreen'); $('#quit').onclick = () => call('quit');
$('#logout').onclick = async () => { try { await call('logout'); loadVersion++; waveGeneration++; waveMode = false; waveLoading = null; actualAudio = null; updateQuality(); $('#wave-nav').classList.remove('active'); audio.pause(); audio.removeAttribute('src'); audio.load(); account = null; queue = []; index = -1; liked.clear(); updateLike(); $('#now-title').textContent = 'Ваша музыка всегда рядом'; $('#now-artist').textContent = 'Выберите трек, чтобы начать'; $('#now-cover').innerHTML = icon('music_note'); $('#username').textContent = 'Ваш аккаунт'; $('#account-label').textContent = 'Войдите, чтобы слушать'; $('#login-top').textContent = 'Войти'; $('#preferences').close(); render('home'); } catch (e) { toast(e.message); } };
// Spatial navigation supports the Deck D-pad, left stick and Steam Input keyboard mappings.
function focusMove(dx,dy) {
  const root = document.querySelector('dialog[open]') || document;
  const candidates = [...root.querySelectorAll('button:not(:disabled), input, summary')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height);
  const current = document.activeElement; const rect = current?.getBoundingClientRect();
  if (!candidates.includes(current)) { candidates[0]?.focus(); return; }
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const best = candidates.filter(el => el !== current).map(el => { const r = el.getBoundingClientRect(), x = r.x + r.width / 2 - cx, y = r.y + r.height / 2 - cy; const along = x*dx + y*dy, across = Math.abs(x*dy-y*dx); return {el,along,score:along + across*3}; }).filter(item => item.along > 8).sort((a,b) => a.score-b.score)[0];
  best?.el.focus(); best?.el.scrollIntoView({block:'nearest',inline:'nearest'});
}
function back() { const dialog = document.querySelector('dialog[open]'); if (dialog) dialog.close(); else if (page === 'queue') toggleQueue(); else render('home'); }
document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); back(); return; } if (/INPUT/.test(event.target.tagName)) return; const directions = {ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}; if (directions[event.key]) { event.preventDefault(); focusMove(...directions[event.key]); } if (event.code === 'Space') { event.preventDefault(); togglePlay(); } });
let previousButtons = [], nextDirection = 0;
function gamepadLoop(now) {
  const pad = [...navigator.getGamepads()].find(p => p?.connected);
  if (pad) {
    const pressed = i => pad.buttons[i]?.pressed && !previousButtons[i];
    if (pressed(0)) document.activeElement?.click(); if (pressed(1)) back(); if (pressed(2)) togglePlay(); if (pressed(3) && !document.querySelector('dialog[open]')) render('search'); if (pressed(4)) moveTrack(-1); if (pressed(5)) moveTrack(1);
    const dx = pad.buttons[14]?.pressed ? -1 : pad.buttons[15]?.pressed ? 1 : Math.abs(pad.axes[0] || 0) > .6 ? Math.sign(pad.axes[0]) : 0;
    const dy = pad.buttons[12]?.pressed ? -1 : pad.buttons[13]?.pressed ? 1 : Math.abs(pad.axes[1] || 0) > .6 ? Math.sign(pad.axes[1]) : 0;
    if ((dx || dy) && now > nextDirection) { const active = document.activeElement; if (active?.type === 'range' && dx) { active.value = Math.max(Number(active.min),Math.min(Number(active.max),Number(active.value) + dx * Number(active.step || 1))); active.dispatchEvent(new Event('input')); } else focusMove(dx,dy); nextDirection = now + 190; }
    if (!dx && !dy) nextDirection = 0;
    previousButtons = pad.buttons.map(button => button.pressed);
  } else previousButtons = [];
  requestAnimationFrame(gamepadLoop);
}
requestAnimationFrame(gamepadLoop);
let lastMediaReport=0;
audio.addEventListener('timeupdate',()=>{if(Date.now()-lastMediaReport>1000){lastMediaReport=Date.now();publishMediaState();}});
for(const event of ['play','pause','ended','durationchange','volumechange','emptied'])audio.addEventListener(event,()=>publishMediaState());
audio.addEventListener('seeked',()=>publishMediaState(true));
window.yamu.onMediaCommand(async command=>{
  try {
    const action=command?.action,value=command?.value;
    if(action==='next'||action==='previous')await moveTrack(action==='next'?1:-1,false,audio.paused);
    else if(action==='toggle')togglePlay();
    else if(action==='play'&&audio.paused)togglePlay();
    else if(action==='pause')audio.pause();
    else if(action==='stop'){audio.pause();audio.currentTime=0;}
    else if(action==='position'&&Number.isFinite(value)&&Number.isFinite(audio.duration))audio.currentTime=Math.max(0,Math.min(audio.duration,value));
    else if(action==='volume'&&Number.isFinite(value)){audio.volume=Math.max(0,Math.min(1,value));$('#volume').value=audio.volume;localStorage.setItem('volume',audio.volume);}
    publishMediaState();
  }catch(e){toast(e.message);}
});
render('home');
call('session').then(result => { if (result.account) signedIn(result); else if (result.error) toast(result.error); }).catch(e => toast(e.message));
