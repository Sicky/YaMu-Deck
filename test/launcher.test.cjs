const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('diagnostic launcher forwards early flags, reports native failure, and scrubs credentials',{skip:process.platform==='win32'},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yamu-launcher-'));
  try{
    const script=path.join(dir,'diagnose-yamu-gamemode.sh');await fs.copyFile(path.resolve('scripts/diagnose-yamu-gamemode.sh'),script);
    const binary=path.join(dir,'yamu');
    await fs.writeFile(binary,'#!/bin/sh\nprintf "%s\\n" "$@" > "$YAMU_TEST_ARGS"\nprintf "native-sandbox-marker\\n" >&2\nprintf "Authorization: Bearer synthetic-sensitive-value\\n" >&2\nprintf "https://example.invalid/audio?token=synthetic-url-value\\n" >&2\nprintf "ABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJ\\n" >&2\nif [ -n "${ELECTRON_RUN_AS_NODE:-}" ]; then printf "run-as-node-still-set\\n" >&2; fi\nexit 42\n',{mode:0o755});
    const argsFile=path.join(dir,'arguments.txt');
    const result=spawnSync('sh',[script],{encoding:'utf8',timeout:15000,env:{...process.env,XDG_STATE_HOME:path.join(dir,'state'),YAMU_TEST_ARGS:argsFile,ELECTRON_RUN_AS_NODE:'1'}});
    assert.equal(result.status,42,result.stderr);
    const args=await fs.readFile(argsFile,'utf8');for(const flag of ['--steam-deck','--ozone-platform=x11','--disable-gpu','--fullscreen'])assert.ok(args.includes(flag));assert.ok(!args.includes('--no-sandbox'));
    const log=await fs.readFile(path.join(dir,'state/yamu/gamemode-diagnostic.log'),'utf8');
    assert.ok(log.includes('native-sandbox-marker'));assert.ok(log.includes('native-exit-code=42'));
    for(const secret of ['synthetic-sensitive-value','synthetic-url-value','ABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJ','run-as-node-still-set'])assert.ok(!log.includes(secret));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
