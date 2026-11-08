const { createHash, createHmac, randomBytes } = require('node:crypto');
const CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d';
const CLIENT_SECRET = '53bc75238f0c4d08a118e51fe9203300';
class PublicError extends Error {}
function publicMessage(error) { return error instanceof PublicError ? error.message : 'Не удалось выполнить запрос. Проверьте сеть и повторите попытку.'; }
class MusicAPI {
  constructor(fetcher = fetch) { this.fetcher = fetcher; this.token = null; this.uid = null; this.device = null; this.epoch = 0; }
  cancelAuth() { this.epoch++; this.device = null; }
  logout() { this.cancelAuth(); this.token = null; this.uid = null; }
  checkEpoch(epoch) { if (epoch !== this.epoch) throw new PublicError('Вход отменён.'); }
  async request(path, data, authenticated = true, token = this.token, options = {}) {
    const url = path.startsWith('https://oauth.yandex.ru/') ? path : `https://api.music.yandex.net${path}`;
    const target = new URL(url);
    if (target.origin !== 'https://api.music.yandex.net' && !['https://oauth.yandex.ru/device/code', 'https://oauth.yandex.ru/token'].includes(target.href)) throw new PublicError('Недопустимый адрес API');
    const response = await this.fetcher(url, {
      method: data ? 'POST' : 'GET', signal: AbortSignal.timeout(20000), redirect: 'error',
      headers: { ...(authenticated && token && target.origin === 'https://api.music.yandex.net' ? { Authorization: `OAuth ${token}` } : {}), 'Accept-Language': 'ru', ...(data ? { 'Content-Type': options.json ? 'application/json' : 'application/x-www-form-urlencoded' } : {}), ...options.headers },
      body: data ? options.json ? JSON.stringify(data) : new URLSearchParams(data).toString() : undefined
    });
    const body = await response.json();
    if (!response.ok || body.error) {
      const code = typeof body.error === 'string' ? body.error : body.error?.name;
      if (code === 'authorization_pending' || code === 'slow_down') return { pending: true, slow: code === 'slow_down' };
      throw new PublicError(response.status === 401 ? 'Сессия истекла. Войдите снова.' : 'Яндекс отклонил запрос. Повторите вход или попробуйте позже.');
    }
    return body.result ?? body;
  }
  async login(token, epoch = ++this.epoch) {
    this.checkEpoch(epoch);
    if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{1,4096}$/.test(token.trim())) throw new PublicError('Некорректный токен');
    const status = await this.request('/account/status', undefined, true, token.trim());
    this.checkEpoch(epoch);
    const account = status.account;
    if (!account || !/^\d+$/.test(String(account.uid))) throw new PublicError('Некорректный ответ аккаунта');
    this.token = token.trim(); this.uid = account.uid;
    return { uid: account.uid, login: String(account.login || ''), displayName: String(account.displayName || '') };
  }
  async deviceStart() {
    const epoch = ++this.epoch;
    const code = await this.request('https://oauth.yandex.ru/device/code', { client_id: CLIENT_ID, device_id: randomBytes(12).toString('hex'), device_name: 'Yamu Steam Deck' }, false);
    this.checkEpoch(epoch);
    this.device = { ...code, deadline: Date.now() + code.expires_in * 1000, nextPoll: Date.now() + (code.interval || 5) * 1000 };
    return { user_code: code.user_code, verification_url: code.verification_url || code.verification_uri || 'https://oauth.yandex.ru/device', interval: code.interval || 5, expires_in: code.expires_in };
  }
  async devicePoll() {
    const epoch = this.epoch;
    if (!this.device || Date.now() > this.device.deadline) throw new PublicError('Код истёк. Запросите новый.');
    if (Date.now() < this.device.nextPoll) return { pending: true };
    const result = await this.request('https://oauth.yandex.ru/token', { grant_type: 'device_code', code: this.device.device_code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }, false);
    this.checkEpoch(epoch);
    this.device.nextPoll = Date.now() + ((this.device.interval || 5) + (result.slow ? 5 : 0)) * 1000;
    if (result.pending) return result;
    const account = await this.login(result.access_token, epoch); this.device = null; return { account };
  }
  async tracks(ids) {
    const list = [];
    for (let i = 0; i < ids.length; i += 100) list.push(...await this.request('/tracks', { 'track-ids': ids.slice(i, i + 100).join(',') }));
    return list;
  }
  async likes() {
    const result = await this.request(`/users/${this.uid}/likes/tracks`);
    return (result.library?.tracks || []).map(t => String(t.id));
  }
  async library() { return this.tracks((await this.likes()).slice(0, 500)); }
  async search(query) {
    if (typeof query !== 'string' || query.length > 300) throw new PublicError('Некорректный запрос');
    return (await this.request(`/search?text=${encodeURIComponent(query)}&type=track&page=0`)).tracks?.results || [];
  }
  async playlists() { return this.request(`/users/${this.uid}/playlists/list`); }
  async playlist(owner, kind) {
    if (!/^\d+$/.test(String(owner)) || !/^\d+$/.test(String(kind))) throw new PublicError('Некорректный плейлист');
    const result = await this.request(`/users/${owner}/playlists/${kind}`);
    return (result.tracks || []).map(t => t.track).filter(Boolean);
  }
  async like(id, liked) { validateId(id); return this.request(`/users/${this.uid}/likes/tracks/${liked ? 'add-multiple' : 'remove'}`, { 'track-ids': String(id) }); }
  async wave(previous) {
    if (previous !== undefined) validateId(previous);
    const query = new URLSearchParams({settings2:'true', ...(previous !== undefined ? {queue:String(previous)} : {})});
    const result = await this.request(`/rotor/station/user:onyourwave/tracks?${query}`);
    if (!Array.isArray(result.sequence)) throw new PublicError('Яндекс не вернул треки Моей волны. Попробуйте позже.');
    return result.sequence.filter(item => item.track?.id && item.track.available !== false).map(item => ({...item.track, _waveBatch: String(result.batchId || '')}));
  }
  async waveFeedback(type, id, batch = '', seconds = 0) {
    if (!['radioStarted','trackStarted','trackFinished','skip'].includes(type) || typeof batch !== 'string' || batch.length > 1024 || !Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw new PublicError('Некорректное событие Моей волны');
    if (type !== 'radioStarted') validateId(id);
    return this.request(`/rotor/station/user:onyourwave/feedback?${new URLSearchParams({'batch-id':batch})}`, {type, timestamp:new Date().toISOString(), from:'desktop-yamu', ...(type !== 'radioStarted' ? {trackId:String(id), totalPlayedSeconds:seconds} : {})}, true, this.token, {json:true});
  }
  async playback(id, quality = 'hq') { return this.stream(id, quality, true); }
  async stream(id, quality = 'hq', detailed = false) {
    validateId(id);
    if (!['nq','hq','lossless'].includes(quality)) throw new PublicError('Неизвестное качество звука');
    let notice = '';
    if (quality === 'lossless') {
      try {
        const ts = Math.floor(Date.now()/1000);
        const sign = createHmac('sha256','kzqU4XhfCaY6B6JTHODeq5').update(`${ts}${id}losslessflacraw`).digest('base64').replace(/=$/,'');
        const query = new URLSearchParams({ts:String(ts),trackId:String(id),quality:'lossless',codecs:'flac',transports:'raw',sign});
        const result = await this.request(`/get-file-info?${query}`, undefined, true, this.token, {headers:{'X-Yandex-Music-Client':'YandexMusicDesktopAppWindows/5.95.0'}});
        const info = result.downloadInfo;
        if (info?.transport === 'raw' && info.codec === 'flac' && info.quality === 'lossless') {
          const url = trustedMediaURL(info.url || info.urls?.[0]);
          return detailed ? {url,codec:'flac',quality:'lossless',bitrate:Number(info.bitrate)||0,notice:''} : url;
        }
      } catch { /* The legacy MP3 route remains available when lossless is unavailable. */ }
      notice = 'Lossless недоступен для этого трека или аккаунта. Используется MP3.';
    }
    const variants = await this.request(`/tracks/${id}/download-info`);
    if (!Array.isArray(variants)) throw new PublicError('Яндекс не вернул варианты аудио. Проверьте доступ к треку.');
    const mp3 = variants.filter(v => v.codec === 'mp3' && !v.preview && Number(v.bitrateInKbps) > 0).sort((a,b) => b.bitrateInKbps - a.bitrateInKbps);
    const best = quality === 'nq' ? mp3.find(v => v.bitrateInKbps <= 192) || mp3.at(-1) : mp3[0];
    if (!best) throw new PublicError('Полный трек недоступен. Проверьте подписку и регион.');
    const metadata = trustedMediaURL(best.downloadInfoUrl);
    const response = await this.fetcher(metadata, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) throw new PublicError('Не удалось получить аудиопоток');
    const url = directLink(await response.text());
    if (quality === 'hq' && best.bitrateInKbps < 320) notice = '320 кбит/с недоступно для этого трека. Выбран лучший доступный MP3.';
    return detailed ? {url,codec:'mp3',quality:best.bitrateInKbps >= 256 ? 'hq':'nq',bitrate:Number(best.bitrateInKbps),notice} : url;
  }
}
function validateId(id) { if (!/^\d+(?::\d+)?$/.test(String(id))) throw new PublicError('Некорректный ID трека'); }
function trustedMediaURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/(^|\.)(yandex\.net|yandex\.ru|yandex\.com)$/.test(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new PublicError('Недопустимый адрес аудио');
  return url.href;
}
function directLink(payload) {
  if (typeof payload !== 'string' || payload.length > 65536) throw new PublicError('Некорректный формат аудиоссылки');
  const text = payload.trim();
  let fields;
  if (text.startsWith('{')) {
    try { fields = JSON.parse(text); } catch { throw new PublicError('Некорректный JSON аудиоссылки'); }
  } else {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new PublicError('Недопустимый XML аудиоссылки');
    const decode = value => value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, entity => {
      const named = { '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'" };
      if (named[entity]) return named[entity];
      const point = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3,-1),16) : parseInt(entity.slice(2,-1),10);
      if (!Number.isInteger(point) || point < 32 || point > 0x10ffff) throw new PublicError('Некорректный XML аудиоссылки');
      return String.fromCodePoint(point);
    });
    const tag = name => { const value = text.match(new RegExp(`<${name}\\s*>([\\s\\S]*?)</${name}\\s*>`))?.[1]; if (value === undefined) throw new PublicError('В ответе Яндекса отсутствуют поля аудиоссылки'); return decode(value.trim()); };
    fields = Object.fromEntries(['host','path','ts','s'].map(name => [name,tag(name)]));
  }
  const {host, path, s: salt} = fields;
  const ts = typeof fields.ts === 'number' && Number.isSafeInteger(fields.ts) ? String(fields.ts) : fields.ts;
  if (typeof host !== 'string' || !/^[a-z0-9.-]+$/i.test(host) || typeof path !== 'string' || !path.startsWith('/') || /[\s\\?#]/.test(path) || typeof salt !== 'string' || !salt || typeof ts !== 'string' || !/^[0-9a-f]{1,32}$/i.test(ts)) throw new PublicError('Некорректные поля аудиоссылки Яндекса');
  const sign = createHash('md5').update('XGRlBW9FXlekgbPrRHuSiA' + path.slice(1) + salt).digest('hex');
  return trustedMediaURL(`https://${host}/get-mp3/${sign}/${ts}${path}`);
}
module.exports = { MusicAPI, directLink, trustedMediaURL, PublicError, publicMessage };
