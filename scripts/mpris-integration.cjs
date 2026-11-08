// Run on Linux under dbus-run-session. No real account or token is used.
const assert=require('node:assert/strict');const dbus=require('@jellybrick/dbus-next');
const {createMpris,NAME,PATH}=require('../electron/mpris.cjs');
async function main(){
  let bridge,client;const commands=[];
  const timeout=setTimeout(()=>{console.error('MPRIS integration timeout');process.exit(1);},10000);
  try{
    bridge=await createMpris({send:c=>commands.push(c)});assert.equal(bridge.getStatus(),'ready');
    bridge.update({id:'123',title:'Synthetic track',artist:'Synthetic artist',duration:180,position:5,status:'Playing',canNext:true,volume:.5});
    client=dbus.sessionBus();const proxy=await client.getProxyObject(NAME,PATH);
    const player=proxy.getInterface('org.mpris.MediaPlayer2.Player'),props=proxy.getInterface('org.freedesktop.DBus.Properties');
    const metadata=await props.Get('org.mpris.MediaPlayer2.Player','Metadata');
    assert.equal(metadata.value['xesam:title'].value,'Synthetic track');
    assert.equal((await props.Get('org.mpris.MediaPlayer2.Player','PlaybackStatus')).value,'Playing');
    await player.Next();await player.Pause();await props.Set('org.mpris.MediaPlayer2.Player','Volume',new dbus.Variant('d',.25));
    assert.deepEqual(commands.map(c=>c.action),['next','pause','volume']);assert.equal(commands[2].value,.25);
    console.log('MPRIS D-Bus integration passed');
  }finally{clearTimeout(timeout);client?.disconnect();bridge?.close();}
}
main().catch(()=>{console.error('MPRIS D-Bus integration failed');process.exitCode=1;});
