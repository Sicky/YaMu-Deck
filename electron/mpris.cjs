const NAME = 'org.mpris.MediaPlayer2.yamu';
const PATH = '/org/mpris/MediaPlayer2';
const NO_TRACK = '/org/mpris/MediaPlayer2/TrackList/NoTrack';
function sanitizeState(input = {}) {
  if(!input || typeof input !== 'object')input={};
  const text = value => typeof value === 'string' ? value.slice(0,512) : '';
  const number = (value,max) => Number.isFinite(value) ? Math.max(0,Math.min(max,value)) : 0;
  const id = typeof input.id === 'string' && /^\d+(?::\d+)?$/.test(input.id) ? input.id : '';
  let art = '';
  try { const url = new URL(input.art); if (url.protocol === 'https:' && /(^|\.)(yandex\.net|yandex\.ru)$/.test(url.hostname) && !url.username && !url.password && !url.port) {url.search='';url.hash='';art=url.href;} } catch {}
  return {id,title:text(input.title),artist:text(input.artist),album:text(input.album),art,
    duration:number(input.duration,86400),position:number(input.position,86400),volume:number(input.volume,1),
    status:id && ['Playing','Paused'].includes(input.status) ? input.status : 'Stopped',
    canNext:!!id && input.canNext === true,canPrevious:!!id && input.canPrevious === true};
}
const trackPath = id => id ? `/org/mpris/MediaPlayer2/track/t${Buffer.from(id).toString('hex')}` : NO_TRACK;
async function createMpris({send,raise,quit,platform=process.platform,dbus,busFactory} = {}) {
  let status = platform === 'linux' ? 'starting':'unsupported';
  const bridge = {update(){},close(){},getStatus:()=>status};
  if(platform !== 'linux') return bridge;
  let bus;
  try {
    dbus ||= require('@jellybrick/dbus-next');
    const {Interface,ACCESS_READ:R,ACCESS_READWRITE:RW} = dbus.interface;
    class MprisInterface extends Interface {
      constructor(name){
        super(name);
        // dbus-next 0.11.4 declares undefined instance fields over the maps
        // installed by configureMembers on the subclass prototype.
        for(const key of ['$properties','$methods','$signals'])if(Object.hasOwn(this,key)&&this[key]===undefined)delete this[key];
      }
    }
    const V = (type,value)=>new dbus.Variant(type,value);
    let state = sanitizeState(), updatedAt=Date.now(), closed=false;
    const command = (action,value)=>{if(!closed)send({action,value});};
    class Root extends MprisInterface {
      constructor(){super('org.mpris.MediaPlayer2');this.CanQuit=true;this.CanRaise=true;this.HasTrackList=false;this.Identity='Yamu';this.SupportedUriSchemes=[];this.SupportedMimeTypes=[];}
      Raise(){raise?.();} Quit(){quit?.();}
    }
    Root.configureMembers({methods:{Raise:{},Quit:{}},properties:{CanQuit:{signature:'b',access:R},CanRaise:{signature:'b',access:R},HasTrackList:{signature:'b',access:R},Identity:{signature:'s',access:R},SupportedUriSchemes:{signature:'as',access:R},SupportedMimeTypes:{signature:'as',access:R}}});
    class Player extends MprisInterface {
      constructor(){super('org.mpris.MediaPlayer2.Player');}
      get PlaybackStatus(){return state.status;}
      get Metadata(){
        const result={'mpris:trackid':V('o',trackPath(state.id))};
        if(state.id){result['xesam:title']=V('s',state.title);result['xesam:artist']=V('as',state.artist?[state.artist]:[]);result['xesam:album']=V('s',state.album);result['mpris:length']=V('x',BigInt(Math.round(state.duration*1e6)));if(state.art)result['mpris:artUrl']=V('s',state.art);}
        return result;
      }
      get Position(){const elapsed=state.status==='Playing'?(Date.now()-updatedAt)/1000:0;return BigInt(Math.round(Math.min(state.duration||86400,state.position+elapsed)*1e6));}
      get Volume(){return state.volume;} set Volume(value){if(Number.isFinite(value))command('volume',Math.max(0,Math.min(1,value)));}
      get Rate(){return 1;} set Rate(_value){}
      get MinimumRate(){return 1;} get MaximumRate(){return 1;}
      get CanGoNext(){return state.canNext;} get CanGoPrevious(){return state.canPrevious;}
      get CanPlay(){return !!state.id;} get CanPause(){return !!state.id;} get CanSeek(){return !!state.id && state.duration>0;} get CanControl(){return true;}
      Next(){if(this.CanGoNext)command('next');} Previous(){if(this.CanGoPrevious)command('previous');}
      Play(){if(this.CanPlay)command('play');} Pause(){if(this.CanPause)command('pause');}
      PlayPause(){if(this.CanPlay)command('toggle');} Stop(){if(this.CanPlay)command('stop');}
      Seek(offset){if(!this.CanSeek)return;const seconds=Number(offset)/1e6;if(!Number.isFinite(seconds))return;const position=Number(this.Position)/1e6+seconds;if(position>state.duration)this.Next();else command('position',Math.max(0,position));}
      SetPosition(id,position){const seconds=Number(position)/1e6;if(id===trackPath(state.id)&&this.CanSeek&&seconds>=0&&seconds<=state.duration)command('position',seconds);}
      OpenUri(_uri){} // Never turn a D-Bus argument into a URL or shell command.
      Seeked(position){return position;}
    }
    Player.configureMembers({methods:{Next:{},Previous:{},Play:{},Pause:{},PlayPause:{},Stop:{},Seek:{inSignature:'x'},SetPosition:{inSignature:'ox'},OpenUri:{inSignature:'s'}},signals:{Seeked:{signature:'x'}},properties:{PlaybackStatus:{signature:'s',access:R},Metadata:{signature:'a{sv}',access:R},Position:{signature:'x',access:R},Volume:{signature:'d',access:RW},Rate:{signature:'d',access:RW},MinimumRate:{signature:'d',access:R},MaximumRate:{signature:'d',access:R},CanGoNext:{signature:'b',access:R},CanGoPrevious:{signature:'b',access:R},CanPlay:{signature:'b',access:R},CanPause:{signature:'b',access:R},CanSeek:{signature:'b',access:R},CanControl:{signature:'b',access:R}}});
    bus=busFactory?busFactory():dbus.sessionBus();
    bus.on('error',()=>{status='unavailable';});
    const result=await bus.requestName(NAME,dbus.NameFlag.DO_NOT_QUEUE);
    if(result!==dbus.RequestNameReply.PRIMARY_OWNER)throw new Error('Name unavailable');
    const root=new Root(),player=new Player();bus.export(PATH,root);bus.export(PATH,player);
    status='ready';
    bridge.update=(input,seeked=false)=>{
      if(closed||status!=='ready')return;
      const before={PlaybackStatus:player.PlaybackStatus,Metadata:player.Metadata,Volume:player.Volume,CanGoNext:player.CanGoNext,CanGoPrevious:player.CanGoPrevious,CanPlay:player.CanPlay,CanPause:player.CanPause,CanSeek:player.CanSeek};
      const old=state;state=sanitizeState(input);updatedAt=Date.now();
      const changed={};
      for(const key of Object.keys(before)){if(key==='Metadata'){if(['id','title','artist','album','art','duration'].some(field=>old[field]!==state[field]))changed.Metadata=player.Metadata;}else if(before[key]!==player[key])changed[key]=player[key];}
      if(Object.keys(changed).length)Interface.emitPropertiesChanged(player,changed);
      if(seeked)player.Seeked(player.Position);
    };
    bridge.close=()=>{if(closed)return;closed=true;status='closed';bus.unexport(PATH);bus.disconnect();};
  }catch{status='unavailable';try{bus?.disconnect();}catch{}}
  return bridge;
}
module.exports={createMpris,sanitizeState,trackPath,NAME,PATH};
