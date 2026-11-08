// CI-only bootstrap. Official GitHub URLs, cache-busting queries, SHA-256 verified.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createReadStream,createWriteStream}=require('node:fs');const {Readable}=require('node:stream');const {pipeline}=require('node:stream/promises');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');const run=promisify(execFile);
const base=path.resolve('.tools/electron-runtime');
async function digest(file){const hash=crypto.createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex');}
const releases=new Map();
async function officialAsset(url){
  const parsed=new URL(url),match=parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/);
  if(parsed.origin!=='https://github.com'||!match)throw Error('Unsupported official asset URL');
  const [,owner,repo,tag,name]=match,key=`${owner}/${repo}/${tag}`;
  if(!releases.has(key)){
    const response=await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`Official release metadata returned ${response.status}`);
    releases.set(key,await response.json());
  }
  const asset=releases.get(key).assets.find(asset=>asset.name===decodeURIComponent(name));
  if(!asset||!Number.isSafeInteger(asset.id))throw Error('Official asset missing');
  return `https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`;
}
async function get(url){let failure;for(let attempt=1;attempt<=3;attempt++){try{
  // GitHub's browser download route can return 504 while its asset API works.
  // Both routes resolve the same official release asset; SHA-256 stays required.
  const target=attempt===1?url:await officialAsset(url);
  const response=await fetch(`${target}?yamu_ci=${Date.now()}_${attempt}`,{headers:{Accept:'application/octet-stream'},redirect:'follow',signal:AbortSignal.timeout(120000)});
  if(!response.ok){await response.body?.cancel();throw Error(`Official download returned ${response.status}`);}return response;
}catch(error){failure=error;console.log(`Retrying ${path.basename(new URL(url).pathname)} (${attempt}/3)`);}}throw failure;}
async function verifiedDownload(url,file,expected){
  try{if(await digest(file)===expected)return;}catch{}
  for(let attempt=1;attempt<=3;attempt++){try{const response=await get(url);await pipeline(Readable.fromWeb(response.body),createWriteStream(file));if(await digest(file)!==expected)throw Error('SHA-256 mismatch');console.log(`Verified ${path.basename(file)}`);return;}catch(error){if(attempt===3)throw error;console.log(`Retrying official download (${attempt}/3)`);}}
}
async function main(){
  if(process.platform!=='linux'||process.arch!=='x64')throw Error('Linux x64 CI only');
  await fs.mkdir(base,{recursive:true});
  const version=require('electron/package.json').version,filename=`electron-v${version}-linux-x64.zip`;
  const release=`https://github.com/electron/electron/releases/download/v${version}`;
  const manifest=await (await get(`${release}/SHASUMS256.txt`)).text();
  const line=manifest.split('\n').map(line=>line.trim().split(/\s+/)).find(parts=>parts[1]?.replace(/^\*/,'')===filename);
  if(!line||!/^[a-f0-9]{64}$/.test(line[0]))throw Error('Official Electron checksum missing');
  const archive=path.join(base,filename);await verifiedDownload(`${release}/${filename}`,archive,line[0]);
  const runtime=path.resolve('node_modules/electron/dist');await fs.mkdir(runtime,{recursive:true});
  await run('unzip',['-oq',archive,'-d',runtime]);await fs.chmod(path.join(runtime,'electron'),0o755);await fs.writeFile('node_modules/electron/path.txt','electron');
  const tool='appimage-12.0.1.7z';
  const checksum=require('app-builder-lib/out/toolsets/linux.js').appimageChecksums['0.0.0'][tool];
  const toolArchive=path.join(base,tool);await verifiedDownload(`https://github.com/electron-userland/electron-builder-binaries/releases/download/appimage-12.0.1/${tool}`,toolArchive,checksum);
  const tools=path.resolve('.tools/appimage-tools');await fs.mkdir(tools,{recursive:true});await run('7z',['x','-y',`-o${tools}`,toolArchive]);
  for(const file of ['mksquashfs','desktop-file-validate'])await fs.chmod(path.join(tools,'linux-x64',file),0o755);
  console.log('Official Linux runtime and AppImage tools ready; checksums verified');
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
