import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const port = 7461;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('room server start timeout')), 10000);
  server.stdout.on('data', data => { if (String(data).includes('room server')) { clearTimeout(timeout); resolve(); } });
  server.stderr.on('data', data => { const text=String(data);if(text.includes('Error:'))reject(new Error(text)); });
  server.on('exit', code => reject(new Error(`room server exited ${code}`)));
});

function connect() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/rooms`); const messages=[];const waiters=[];
    socket.on('message', raw => { const message=JSON.parse(String(raw));messages.push(message);for(const waiter of [...waiters])if(waiter.predicate(message)){waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(message);} });
    socket.once('open', () => resolve({ socket, messages, waitFor(predicate, timeoutMs=3000) { const found=messages.find(predicate);if(found)return Promise.resolve(found);return new Promise((resolveWait,rejectWait)=>{const waiter={predicate,resolve:resolveWait};waiters.push(waiter);setTimeout(()=>{const index=waiters.indexOf(waiter);if(index>=0)waiters.splice(index,1);rejectWait(new Error('message timeout'));},timeoutMs);}); } }));
    socket.once('error', reject);
  });
}

const clients=[];
try {
  const health=await fetch(`http://127.0.0.1:${port}/healthz`).then(response=>response.json());
  if(!health.ok||health.rooms!==0)throw new Error(`health check failed: ${JSON.stringify(health)}`);
  for(let i=0;i<4;i+=1)clients.push(await connect());
  const welcomes=await Promise.all(clients.map(client=>client.waitFor(message=>message.type==='welcome')));
  clients[0].socket.send(JSON.stringify({type:'create',code:'ROOM42',name:'Host',team:'blue',weapon:'type38'}));
  const created=await clients[0].waitFor(message=>message.type==='room'&&message.code);const roomCode=created.code;if(roomCode!=='ROOM42')throw new Error(`custom room code rejected: ${roomCode}`);
  clients[1].socket.send(JSON.stringify({type:'create',code:'bad',name:'Bad',team:'red',weapon:'zhongzheng-shi'}));
  const invalidCode=await clients[1].waitFor(message=>message.type==='error'&&message.message.includes('6 位'));if(!invalidCode)throw new Error('invalid custom room code was accepted');
  clients[1].socket.send(JSON.stringify({type:'create',code:'ROOM42',name:'Duplicate',team:'red',weapon:'zhongzheng-shi'}));
  const duplicateCode=await clients[1].waitFor(message=>message.type==='error'&&message.message.includes('被使用'));if(!duplicateCode)throw new Error('duplicate custom room code was accepted');
  for(let i=1;i<4;i+=1)clients[i].socket.send(JSON.stringify({type:'join',code:roomCode,name:`Player${i}`,team:'blue',weapon:'type100'}));
  const fullRoom=await clients[0].waitFor(message=>message.type==='room'&&message.players.length===4);
  const blue=fullRoom.players.filter(player=>player.team==='blue').length,red=fullRoom.players.length-blue;
  if(blue!==2||red!==2)throw new Error(`team balance failed ${blue}:${red}`);
  const clientWeapon=fullRoom.players.find(player=>player.id===welcomes[1].id).weapon;
  clients[0].socket.send(JSON.stringify({type:'start',map:'military-base'}));
  await Promise.all(clients.map(client=>client.waitFor(message=>message.type==='matchStart'&&message.players.length===4)));
  clients[0].socket.send(JSON.stringify({type:'start',map:'city'}));
  await clients[0].waitFor(message=>message.type==='error'&&message.message==='比赛已经开始');

  clients[1].socket.send(JSON.stringify({type:'playerState',state:{position:[1,-99,2],yaw:45,pitch:999,stance:'invalid',weaponId:clientWeapon,magazine:999,reserve:9999,ads:true,reloading:false,climbing:true}}));
  const relayedState=await clients[0].waitFor(message=>message.type==='playerState'&&message.id===welcomes[1].id);
  const expectedAmmo=clientWeapon==='zhongzheng-shi'?{magazine:5,reserve:120}:{magazine:30,reserve:300};
  if(relayedState.state.magazine!==expectedAmmo.magazine||relayedState.state.reserve!==expectedAmmo.reserve||relayedState.state.position[1]!==-4.2||relayedState.state.pitch!==80||relayedState.state.stance!=='stand'||relayedState.state.ads!==true||relayedState.state.climbing!==true)throw new Error(`player state validation failed: ${JSON.stringify(relayedState.state)}`);
  clients[1].socket.send(JSON.stringify({type:'fire',weaponId:clientWeapon}));
  await clients[0].waitFor(message=>message.type==='fire'&&message.id===welcomes[1].id&&message.weaponId===clientWeapon);
  clients[1].socket.send(JSON.stringify({type:'reload',weaponId:clientWeapon}));
  await clients[0].waitFor(message=>message.type==='reload'&&message.id===welcomes[1].id&&message.weaponId===clientWeapon);
  clients[2].socket.send(JSON.stringify({type:'useItem',item:'grenade'}));
  await clients[0].waitFor(message=>message.type==='useItem'&&message.id===welcomes[2].id&&message.item==='grenade');
  clients[0].socket.send(JSON.stringify({type:'world',snapshot:{matchTime:999,score:{blue:2000000,red:-2},actors:[],objectives:[{id:'F',owner:'blue',progress:99},{id:'A',owner:'invalid',progress:2}],grenades:[{id:'g1',ownerId:welcomes[0].id,position:[2,-99,3],fuse:99}]}}));
  const world=await clients[3].waitFor(message=>message.type==='world');
  if(world.snapshot.matchTime!==600||world.snapshot.score.blue!==1000000||world.snapshot.score.red!==0||world.snapshot.objectives.length!==1||world.snapshot.objectives[0].owner!==null||world.snapshot.grenades[0].position[1]!==-8||world.snapshot.grenades[0].fuse!==3.5)throw new Error(`world validation failed: ${JSON.stringify(world.snapshot)}`);

  clients[0].socket.close();
  const migrated=await clients[1].waitFor(message=>message.type==='room'&&message.hostId!==welcomes[0].id&&message.players.length===3);
  if(!migrated.hostId)throw new Error('host migration failed');
  const handoff=await clients[1].waitFor(message=>message.type==='hostMigration');
  if(!handoff.snapshot||handoff.snapshot.score.blue!==1000000||handoff.status!=='playing')throw new Error(`host snapshot handoff failed: ${JSON.stringify(handoff)}`);
  clients[1].socket.send(JSON.stringify({type:'matchFinished'}));
  await clients[2].waitFor(message=>message.type==='room'&&message.status==='lobby');
  console.log(JSON.stringify({ok:true,roomCode,players:4,teams:{blue,red},aiFill:20,health:true,validation:true,hostMigratedTo:migrated.hostId,snapshotTransferred:true},null,2));
} finally {
  for(const client of clients)client.socket.close();server.kill('SIGTERM');
}
