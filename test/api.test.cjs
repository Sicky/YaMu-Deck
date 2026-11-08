const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MusicAPI, directLink, trustedMediaURL } = require('../electron/api.cjs');
const { publicMessage } = require('../electron/api.cjs');
const reply = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
test('hex timestamps work in XML and JSON and are preserved in signed URL', () => {
  const fields = {host:'cdn.yandex.net',path:'/music/test.mp3',ts:'5dc4a6f2',s:'synthetic-salt'};
  const xml = '<download-info>' + Object.entries(fields).map(([k,v])=>`<${k}>${v}</${k}>`).join('') + '</download-info>';
  const fromXML = directLink(xml);
  assert.equal(fromXML,directLink(JSON.stringify(fields)));
  assert.match(fromXML,/\/5dc4a6f2\/music\/test.mp3$/);
  const expected = require('node:crypto').createHash('md5').update('XGRlBW9FXlekgbPrRHuSiA' + fields.path.slice(1) + fields.s).digest('hex');
  assert.ok(fromXML.includes(`/get-mp3/${expected}/`));
});
test('metadata parser rejects malformed, unsafe and incomplete responses', () => {
  for (const value of ['{}','{broken','<html>Denied</html>','<!DOCTYPE info><host>cdn.yandex.net</host>']) assert.throws(()=>directLink(value));
  const safe = {host:'cdn.yandex.net',path:'/file.mp3',ts:'5dc4a6f2',s:'salt'};
  for (const patch of [{host:'evil.org'},{host:'cdn.yandex.net/evil'},{ts:'../../evil'},{path:'/file?secret=x'},{path:'/file\\x'},{s:null}]) assert.throws(()=>directLink(JSON.stringify({...safe,...patch})));
});
test('XML whitespace and numeric entities do not change signature data', () => {
  assert.equal(directLink('<host> cdn.yandex.net </host><path>/a&#45;b.mp3</path><ts> 5DC4A6F2 </ts><s>test</s>'), directLink(JSON.stringify({host:'cdn.yandex.net',path:'/a-b.mp3',ts:'5DC4A6F2',s:'test'})));
});
test('stream resolves JSON CDN metadata with a hex timestamp without sending credentials', async () => {
  const api = new MusicAPI(async (url, options) => {
    if (url.startsWith('https://api.music.yandex.net/')) return reply({result:[{codec:'mp3',preview:false,bitrateInKbps:320,downloadInfoUrl:'https://cdn.yandex.net/info?format=json'}]});
    assert.equal(options.headers, undefined);
    assert.equal(options.redirect, 'error');
    return {ok:true,text:async()=>JSON.stringify({host:'cdn.yandex.net',path:'/music/test.mp3',ts:'5dc4a6f2',s:'test-salt'})};
  });
  api.token = 'synthetic-token';
  assert.match(await api.stream('123'), /\/5dc4a6f2\/music\/test.mp3$/);
});
test('login rolls back failed credentials and never puts token in URL', async () => {
  const api = new MusicAPI(async (url, options) => { assert.equal(options.headers.Authorization, 'OAuth invalid'); assert.ok(!url.includes('invalid')); return reply({error:'unauthorized'},401); });
  api.token = 'previous'; await assert.rejects(api.login('invalid'), /Сессия/); assert.equal(api.token,'previous');
});
test('credentials use exact API origin, redirects disabled, OAuth never receives music token', async () => {
  const api = new MusicAPI(async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(['https://api.music.yandex.net', 'https://oauth.yandex.ru'].includes(new URL(url).origin));
    if (url.includes('oauth.yandex.ru')) assert.equal(options.headers.Authorization, undefined);
    return reply({result:{}});
  });
  api.token = 'private-test-token';
  await api.request('/account/status');
  await api.request('https://oauth.yandex.ru/token', {code:'test-code'});
  await assert.rejects(api.request('https://oauth.yandex.ru/unknown'), /адрес/);
});
test('server errors and native exceptions do not reach UI with sensitive details', async () => {
  const secret = 'test-secret-not-real';
  const api = new MusicAPI(async () => reply({error:secret},400));
  await assert.rejects(api.search('test'), error => !publicMessage(error).includes(secret));
  assert.ok(!publicMessage(new TypeError(`Invalid header: ${secret}`)).includes(secret));
  let calls = 0; const invalid = new MusicAPI(async () => { calls++; });
  await assert.rejects(invalid.login('token\nwith-newline'), /токен/); assert.equal(calls,0);
});
test('logout during login cannot restore token or uid', async () => {
  let resolve;
  const api = new MusicAPI(() => new Promise(done => resolve = done));
  const pending = api.login('test-token');
  assert.equal(api.token,null);
  api.logout(); resolve(reply({result:{account:{uid:123,login:'test'}}}));
  await assert.rejects(pending,/отменён/);
  assert.equal(api.token,null); assert.equal(api.uid,null);
});
test('cancelling OAuth while polling discards the received access token', async () => {
  let resolve; const api = new MusicAPI(() => new Promise(done => resolve = done));
  api.device = {device_code:'test-code', deadline:Date.now()+10000, nextPoll:0};
  const pending = api.devicePoll(); api.cancelAuth();
  resolve(reply({access_token:'test-token'}));
  await assert.rejects(pending,/отменён/); assert.equal(api.token,null);
});
test('account response is reduced to public fields', async () => {
  const api = new MusicAPI(async () => reply({result:{account:{uid:123,login:'test',displayName:'Test',access_token:'must-not-leave-main'}}}));
  assert.deepEqual(await api.login('test-token'),{uid:123,login:'test',displayName:'Test'});
});
test('device code stays in main process and polling obeys interval', async () => {
  let requests = 0;
  const api = new MusicAPI(async () => { requests++; return reply({device_code:'private-code',user_code:'ABCD',expires_in:300,interval:5}); });
  const result = await api.deviceStart(); assert.equal(result.device_code,undefined); assert.equal(result.user_code,'ABCD');
  assert.deepEqual(await api.devicePoll(), {pending:true}); assert.equal(requests,1);
});
test('device pending and expiry are handled', async () => {
  const api = new MusicAPI(async () => reply({error:'authorization_pending'},400));
  api.device = { device_code:'x', deadline:Date.now()+10000,nextPoll:0,interval:5 };
  assert.deepEqual(await api.devicePoll(),{pending:true,slow:false});
  api.device.deadline = 0; await assert.rejects(api.devicePoll(),/истёк/);
});
test('media URLs cannot target local or untrusted hosts', () => {
  for (const url of ['http://music.yandex.net/file','https://yandex.net.evil.org/file','https://127.0.0.1/file','https://user:pass@cdn.yandex.net/file','https://cdn.yandex.net:123/file']) assert.throws(() => trustedMediaURL(url));
  assert.equal(trustedMediaURL('https://cdn.yandex.net/file'),'https://cdn.yandex.net/file');
  assert.throws(() => directLink('<host>localhost</host><path>/x</path><ts>1</ts><s>x</s>'));
});
test('stream excludes preview audio and prefers highest MP3 bitrate', async () => {
  const api = new MusicAPI(async url => url.includes('api.music') ? reply({result:[{codec:'mp3',preview:true,bitrateInKbps:320,downloadInfoUrl:'https://cdn.yandex.net/preview'},{codec:'mp3',preview:false,bitrateInKbps:192,downloadInfoUrl:'https://cdn.yandex.net/full'}]}) : (assert.equal(url,'https://cdn.yandex.net/full'), {ok:true,text:async () => '<host>cdn.yandex.net</host><path>/file.mp3</path><ts>123</ts><s>salt</s>'}));
  assert.match(await api.stream('123'), /^https:\/\/cdn.yandex.net\/get-mp3\/[a-f0-9]{32}\/123\/file.mp3$/);
  await assert.rejects(api.stream('../account'),/ID/);
});
test('library resolves tracks in batches and caps collection at 500', async () => {
  let batches = 0;
  const api = new MusicAPI(async (url,options) => { if (url.includes('/likes/')) return reply({result:{library:{tracks:Array.from({length:600},(_,i)=>({id:i+1}))}}}); batches++; const ids = new URLSearchParams(options.body).get('track-ids').split(','); assert.ok(ids.length <= 100); return reply({result:ids.map(id=>({id}))}); });
  const tracks = await api.library(); assert.equal(tracks.length,500); assert.equal(batches,5);
});
