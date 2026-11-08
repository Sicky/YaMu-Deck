const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {createMpris,sanitizeState,trackPath,NAME,PATH}=require('../electron/mpris.cjs');
class Bus extends EventEmitter{
  interfaces=[];disconnected=false;
  async requestName(name,flags){assert.equal(name,NAME);assert.equal(flags,4);return 1;}
  export(path,iface){assert.equal(path,PATH);this.interfaces.push(iface);}
  unexport(path){assert.equal(path,PATH);} disconnect(){this.disconnected=true;}
}
test('MPRIS exposes only public metadata and fixed media commands',async()=>{
  const bus=new Bus(),commands=[];
  const bridge=await createMpris({platform:'linux',busFactory:()=>bus,send:command=>commands.push(command)});
  assert.equal(bridge.getStatus(),'ready');
  const player=bus.interfaces[1];let signals=0;player.$emitter.on('properties-changed',()=>signals++);
  bridge.update({id:'123:456',title:'Track',artist:'Artist',album:'Album',duration:200,position:10,status:'Paused',volume:.5,canNext:true,canPrevious:true,token:'NEVER-PUBLISH',url:'https://secret.invalid/stream'});
  assert.equal(player.Metadata['mpris:trackid'].value,trackPath('123:456'));
  assert.equal(player.Metadata['mpris:length'].value,200000000n);
  assert.ok(!JSON.stringify(player.Metadata,(_key,value)=>typeof value==='bigint'?String(value):value).includes('NEVER-PUBLISH'));
  assert.equal(player.Position,10000000n);assert.equal(signals,1);
  player.Next();player.Previous();player.Play();player.Pause();player.PlayPause();player.Volume=2;
  player.SetPosition(trackPath('other'),50000000n); // stale track ignored
  player.SetPosition(trackPath('123:456'),50000000n);
  player.OpenUri('file:///etc/passwd'); // deliberately unsupported
  assert.deepEqual(commands,[{action:'next',value:undefined},{action:'previous',value:undefined},{action:'play',value:undefined},{action:'pause',value:undefined},{action:'toggle',value:undefined},{action:'volume',value:1},{action:'position',value:50}]);
  bridge.update({});assert.equal(player.PlaybackStatus,'Stopped');assert.equal(player.CanPlay,false);
  bridge.close();assert.equal(bridge.getStatus(),'closed');assert.ok(bus.disconnected);
});
test('no Linux bus or occupied name does not crash player',async()=>{
  const unsupported=await createMpris({platform:'win32',busFactory:()=>{throw Error('Must not connect')}});assert.equal(unsupported.getStatus(),'unsupported');
  const bus=new Bus();bus.requestName=async()=>3;
  const unavailable=await createMpris({platform:'linux',busFactory:()=>bus});assert.equal(unavailable.getStatus(),'unavailable');assert.ok(bus.disconnected);
});
test('MPRIS sanitizes malformed values and never accepts arbitrary artwork origins',()=>{
  assert.equal(sanitizeState(null).status,'Stopped');
  const state=sanitizeState({id:'../invalid',position:Infinity,volume:-1,title:'x'.repeat(10000),art:'https://evil.org/?token=secret'});
  assert.equal(state.id,'');assert.equal(state.position,0);assert.equal(state.volume,0);assert.equal(state.title.length,512);assert.equal(state.art,'');
  assert.equal(sanitizeState({art:'https://cdn.yandex.net/image?secret=x#frag'}).art,'https://cdn.yandex.net/image');
});
