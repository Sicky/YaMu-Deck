function launchSettings({platform=process.platform,env=process.env,args=process.argv}={}){
  const desktop=args.includes('--desktop-mode');
  const gaming=platform==='linux'&&!desktop&&(args.includes('--steam-deck')||['XDG_CURRENT_DESKTOP','XDG_SESSION_DESKTOP','DESKTOP_SESSION'].some(key=>/gamescope/i.test(env[key]||''))||env.STEAM_GAMEPADUI==='1');
  const ozone=args.find(value=>value.startsWith('--ozone-platform='))?.split('=')[1]||(gaming?'x11':undefined);
  const software=args.includes('--disable-gpu')||(gaming&&!args.includes('--enable-gpu'));
  return {gaming,ozone,software,inProcessGpu:args.includes('--in-process-gpu')||(gaming&&software),fullscreen:gaming||args.includes('--fullscreen')};
}
function withTimeout(operation,ms=5000){let timer;return Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Storage unavailable')),ms);})]).finally(()=>clearTimeout(timer));}
function createCredentialStore(storage,{platform=process.platform,timeout=5000}={}){
  let unavailable=false;
  async function available(){
    if(unavailable||typeof storage.isAsyncEncryptionAvailable!=='function')return false;
    try{
      if(!await withTimeout(()=>storage.isAsyncEncryptionAvailable(),timeout))return false;
      // Never allow the Linux plaintext fallback to persist credentials.
      return platform!=='linux'||['gnome_libsecret','kwallet','kwallet5','kwallet6'].includes(storage.getSelectedStorageBackend?.());
    }catch{unavailable=true;return false;}
  }
  return {
    async encrypt(token){if(!await available())return null;try{return await withTimeout(()=>storage.encryptStringAsync(token),timeout);}catch{unavailable=true;return null;}},
    async decrypt(buffer){if(!await available())return null;try{const value=await withTimeout(()=>storage.decryptStringAsync(buffer),timeout);return typeof value.result==='string'?value.result:null;}catch{unavailable=true;return null;}}
  };
}
module.exports={launchSettings,createCredentialStore};
