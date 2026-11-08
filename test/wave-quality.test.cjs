const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHmac} = require('node:crypto');
const {MusicAPI} = require('../electron/api.cjs');
const reply = result => ({ok:true,status:200,json:async()=>({result})});
function mp3API() {
  return new MusicAPI(async (url,options) => {
    if (url.includes('api.music.yandex.net')) return reply([128,192,320].map(bitrateInKbps=>({codec:'mp3',preview:false,bitrateInKbps,downloadInfoUrl:`https://cdn.yandex.net/${bitrateInKbps}`})));
    assert.equal(options.headers,undefined); return {ok:true,text:async()=>JSON.stringify({host:'cdn.yandex.net',path:`/${new URL(url).pathname.slice(1)}.mp3`,s:'test',ts:'abcdef'})};
  });
}
test('quality selects normal or high MP3 and reports actual bitrate',async()=>{
  const api = mp3API();
  assert.equal((await api.playback('123','nq')).bitrate,192);
  assert.equal((await api.playback('123','hq')).bitrate,320);
  await assert.rejects(api.playback('123','unknown'),/качество/);
});
test('lossless signs raw FLAC request with matching client header',async()=>{
  const api = new MusicAPI(async (url,options)=>{
    const q = new URL(url).searchParams;
    assert.equal(q.get('codecs'),'flac'); assert.equal(q.get('transports'),'raw');
    assert.equal(options.headers['X-Yandex-Music-Client'],'YandexMusicDesktopAppWindows/5.95.0');
    const expected = createHmac('sha256','kzqU4XhfCaY6B6JTHODeq5').update(`${q.get('ts')}123losslessflacraw`).digest('base64').replace(/=$/,'');
    assert.equal(q.get('sign'),expected);
    return reply({downloadInfo:{transport:'raw',codec:'flac',quality:'lossless',url:'https://cdn.yandex.net/test.flac',bitrate:950,key:'must-not-leave-main'}});
  });
  const result = await api.playback('123','lossless');
  assert.equal(result.codec,'flac'); assert.equal(result.quality,'lossless'); assert.equal(result.key,undefined);
});
test('lossless unavailable or encrypted falls back visibly, never plays encrypted data',async()=>{
  for(const info of [{transport:'encraw',codec:'flac',quality:'lossless',url:'https://cdn.yandex.net/encrypted'}, {transport:'raw',codec:'mp3',quality:'hq',url:'https://cdn.yandex.net/mp3'}]) {
    const api = mp3API(), legacy = api.fetcher;
    api.fetcher = (url,options)=>url.includes('/get-file-info?') ? Promise.resolve(reply({downloadInfo:info})) : legacy(url,options);
    const result = await api.playback('123','lossless');
    assert.equal(result.codec,'mp3'); assert.equal(result.bitrate,320); assert.match(result.notice,/Lossless недоступен/);
  }
});
test('wave uses personal station, preserves batch IDs and filters unavailable tracks',async()=>{
  const api = new MusicAPI(async url=>{
    assert.equal(new URL(url).pathname,'/rotor/station/user:onyourwave/tracks');
    assert.equal(new URL(url).searchParams.get('queue'),'123');
    return reply({batchId:'batch-test',sequence:[{track:{id:'1',title:'Test'}},{track:{id:'2',available:false}}]});
  });
  assert.deepEqual(await api.wave('123'),[{id:'1',title:'Test',_waveBatch:'batch-test'}]);
});
test('wave feedback sends JSON with actual playback time and validates input',async()=>{
  const api = new MusicAPI(async (url,options)=>{
    assert.equal(new URL(url).searchParams.get('batch-id'),'batch-test');
    assert.equal(options.headers['Content-Type'],'application/json');
    const body = JSON.parse(options.body); assert.equal(body.type,'skip'); assert.equal(body.trackId,'123'); assert.equal(body.totalPlayedSeconds,12.5);
    return reply('ok');
  });
  assert.equal(await api.waveFeedback('skip','123','batch-test',12.5),'ok');
  await assert.rejects(api.waveFeedback('unknown','123'),/событие/);
  await assert.rejects(api.waveFeedback('skip','123','',Infinity),/событие/);
});
