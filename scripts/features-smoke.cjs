// Fully synthetic API and media: this test never uses a real account or audio URL.
const {app} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'../.tools/features-profile'));
const feedback = []; let batch = 0;
global.fetch = async (url,options={}) => {
  const target = new URL(url); let result;
  if(target.pathname === '/account/status') result = {account:{uid:1,displayName:'Synthetic Test'}};
  else if(target.pathname === '/users/1/likes/tracks') result = {library:{tracks:[]}};
  else if(target.pathname.endsWith('/tracks') && target.pathname.includes('/rotor/')) {
    const start = ++batch * 10;
    result = {batchId:`batch-${batch}`,sequence:[1,2].map(i=>({track:{id:String(start+i),title:`Test ${start+i}`,artists:[{name:'Test'}]}}))};
  } else if(target.pathname.endsWith('/feedback')) {feedback.push(JSON.parse(options.body)); result='ok';}
  else if(target.pathname.endsWith('/download-info')) result = [{codec:'mp3',preview:false,bitrateInKbps:320,downloadInfoUrl:'https://cdn.yandex.net/synthetic-info'}];
  else if(target.hostname === 'cdn.yandex.net') return {ok:true,text:async()=>JSON.stringify({host:'cdn.yandex.net',path:'/test.mp3',ts:'abcdef',s:'synthetic'})};
  else throw new Error('Unexpected mock route');
  return {ok:true,status:200,json:async()=>({result})};
};
app.on('web-contents-created',(_event,contents)=>contents.once('did-finish-load',async()=>{
  try {
    const result = await contents.executeJavaScript(`(async()=>{
      const assert=(v,m)=>{if(!v)throw new Error(m)};
      const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setTimeout(r,20));}throw new Error('UI wait timeout')};
      const audio=document.querySelector('#audio'); let source='';
      Object.defineProperty(audio,'src',{get:()=>source,set:v=>{source=v}});
      audio.load=()=>{};
      audio.pause=()=>audio.dispatchEvent(new Event('pause'));
      audio.play=async()=>audio.dispatchEvent(new Event('play'));
      const session=await call('login','synthetic-test-token'); signedIn(session);
      document.querySelector('#play').click(); await wait(()=>queue.length>=4 && !waveStarting);
      assert(queue[0].id==='11','personal wave starts');
      assert(document.querySelector('#wave-nav').classList.contains('active'),'wave active state');
      assert(document.querySelector('#quality-open').textContent==='320k','actual bitrate');
      await moveTrack(1); assert(queue[index].id==='12','skip advances');
      audio.onended(); await wait(()=>queue[index].id==='21');
      assert(queue.length>=6,'wave keeps filling');
      document.querySelector('#queue').click(); assert(document.querySelectorAll('[data-track]').length===queue.length,'wave queue visible');
      await playTrack([{id:'99',title:'Manual',artists:[]},{id:'100',title:'Remote next',artists:[]}],0);
      assert(!waveMode,'manual selection stops wave');
      return {passed:true,queueAdvanced:true,qualityShown:true};
    })()`);
    contents.send('media-command',{action:'volume',value:.25});
    contents.send('media-command',{action:'next'});
    await contents.executeJavaScript(`(async()=>{for(let i=0;i<100;i++){if(queue[index]?.id==='100' && audio.volume===.25)return;await new Promise(r=>setTimeout(r,20));}throw new Error('Remote media command failed')})()`);
    result.remoteMedia=true;
    assert.ok(feedback.some(e=>e.type==='radioStarted'));
    assert.ok(feedback.some(e=>e.type==='skip' && e.trackId==='11'));
    assert.ok(feedback.some(e=>e.type==='trackFinished' && e.trackId==='12'));
    assert.ok(feedback.some(e=>e.type==='trackStarted' && e.trackId==='21'));
    await fs.writeFile(path.join(__dirname,'../.tools/features-result.json'),JSON.stringify({...result,feedbackEvents:feedback.length}));
    const win = require('electron').BrowserWindow.fromWebContents(contents);
    win.setContentSize(1280,800);
    await new Promise(resolve=>setTimeout(resolve,200));
    await fs.writeFile(path.join(__dirname,'../docs/playback-preview.png'),(await win.capturePage()).toPNG());
    app.exit(0);
  } catch(e) {await fs.writeFile(path.join(__dirname,'../.tools/features-result.json'),JSON.stringify({passed:false,error:e.message})); app.exit(1);}
}));
require('../electron/main.cjs');
setTimeout(()=>app.exit(1),20000);
