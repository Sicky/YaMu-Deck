const {test}=require('node:test');const assert=require('node:assert/strict');
const {launchSettings,createCredentialStore}=require('../electron/startup.cjs');
test('Gaming Mode uses X11 and software rendering; Desktop and Windows retain defaults',()=>{
  assert.deepEqual(launchSettings({platform:'linux',env:{XDG_CURRENT_DESKTOP:'gamescope'},args:[]}),{gaming:true,ozone:'x11',software:true,inProcessGpu:true,fullscreen:true});
  assert.equal(launchSettings({platform:'linux',env:{},args:['--steam-deck']}).gaming,true);
  assert.equal(launchSettings({platform:'linux',env:{XDG_CURRENT_DESKTOP:'KDE'},args:[]}).software,false);
  assert.equal(launchSettings({platform:'win32',env:{},args:['--steam-deck']}).gaming,false);
  assert.equal(launchSettings({platform:'linux',env:{XDG_CURRENT_DESKTOP:'gamescope'},args:['--desktop-mode']}).gaming,false);
  const override=launchSettings({platform:'linux',env:{},args:['--steam-deck','--ozone-platform=wayland','--enable-gpu']});assert.equal(override.ozone,'wayland');assert.equal(override.software,false);
  assert.equal(override.inProcessGpu,false);
  for(const platform of ['linux','win32'])assert.equal(launchSettings({platform,env:{},args:[]}).inProcessGpu,false);
  assert.equal(launchSettings({platform:'linux',env:{},args:['--steam-deck']}).inProcessGpu,true);
  assert.equal(launchSettings({platform:'linux',env:{},args:['--desktop-mode','--in-process-gpu']}).inProcessGpu,true);
});
test('credential store uses async methods only and preserves plaintext fallback protection',async()=>{
  const blocked={isAsyncEncryptionAvailable:async()=>true,getSelectedStorageBackend:()=> 'basic_text',encryptStringAsync:()=>{throw Error('must not encrypt')}};
  assert.equal(await createCredentialStore(blocked,{platform:'linux'}).encrypt('test'),null);
  const secure={...blocked,getSelectedStorageBackend:()=> 'kwallet6',encryptStringAsync:async()=>Buffer.from('encrypted-test'),decryptStringAsync:async()=>({result:'synthetic-token'})};
  const store=createCredentialStore(secure,{platform:'linux'});
  assert.equal((await store.encrypt('test')).toString(),'encrypted-test');assert.equal(await store.decrypt(Buffer.from('test')),'synthetic-token');
});
test('unavailable keyring times out without blocking or accepting late results',async()=>{
  let finish;const store=createCredentialStore({isAsyncEncryptionAvailable:()=>new Promise(resolve=>finish=resolve)},{platform:'linux',timeout:20});
  assert.equal(await store.encrypt('synthetic-token'),null);finish(true);
  assert.equal(await store.encrypt('synthetic-token'),null);
});
test('decrypt timeout does not fall back to a synchronous credential call',async()=>{
  const store=createCredentialStore({isAsyncEncryptionAvailable:async()=>true,decryptStringAsync:()=>new Promise(()=>{}),decryptString:()=>{throw Error('sync call forbidden')}},{platform:'win32',timeout:20});
  assert.equal(await store.decrypt(Buffer.from('synthetic')),null);
});
