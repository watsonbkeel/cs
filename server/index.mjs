import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  clampInt, chooseTeam, safeMap, safeName, safePrimary, safeRoomCode, safeTeam,
  safeWeaponForPlayer, sanitizePlayerState, sanitizeWorldSnapshot, safeMission, safeMissionTeam,
} from './protocol.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'web-desktop');
const port = clampInt(process.env.PORT, 1, 65535, 7460);
const host = process.env.HOST || '0.0.0.0';
const maxPayload = clampInt(process.env.MAX_PAYLOAD_BYTES, 4096, 256 * 1024, 64 * 1024);
const allowedOrigins = new Set(String(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
const rooms = new Map();
const clients = new Map();
let nextPlayerId = 1;

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  if (pathname === '/healthz') {
    json(response, 200, { ok: true, rooms: rooms.size, clients: clients.size, uptimeSeconds: Math.floor(process.uptime()) }); return;
  }
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(root, requested);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) { response.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'cache-control': path.extname(file) === '.html' ? 'no-store' : 'public, max-age=300',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin',
    });
    response.end(data);
  });
});

const wss = new WebSocketServer({
  server, path: '/rooms', maxPayload,
  verifyClient: ({ origin }, done) => done(allowedOrigins.size === 0 || allowedOrigins.has(origin), 403, 'Origin not allowed'),
});

function send(socket, message) { if (socket.readyState === 1) socket.send(JSON.stringify(message)); }
function broadcast(room, message, except = null) { for (const player of room.players) if (player.socket !== except) send(player.socket, message); }
function roomState(room) {
  return { type: 'room', code: room.code, hostId: room.hostId, status: room.status, map: room.map, mission: room.mission, missionTeam: room.missionTeam, players: room.players.map(({ id, name, team, weapon }) => ({ id, name, team, weapon })) };
}
function publishRoom(room) { broadcast(room, roomState(room)); }
function allow(player, key, limit, windowMs = 1000) {
  const now = Date.now(); const bucket = player.rate.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) { player.rate.set(key, { startedAt: now, count: 1 }); return true; }
  bucket.count += 1; return bucket.count <= limit;
}
function reject(player, message) { send(player.socket, { type: 'error', message }); }

function detach(player) {
  const room = player.room; if (!room) return;
  room.players = room.players.filter(item => item !== player); player.room = null;
  if (room.players.length === 0) { rooms.delete(room.code); return; }
  if (room.hostId === player.id) {
    room.hostId = room.players[0].id; publishRoom(room);
    const nextHost = room.players[0];
    send(nextHost.socket, { type: 'hostMigration', snapshot: room.lastSnapshot, status: room.status, map: room.map });
    broadcast(room, { type: 'notice', message: `${nextHost.name} 已成为房主` }, nextHost.socket);
  } else publishRoom(room);
}

wss.on('connection', socket => {
  const player = { id: `p${nextPlayerId++}`, name: 'Player', team: 'blue', weapon: 'type38', activeWeapon: 'type38', socket, room: null, rate: new Map() };
  clients.set(socket, player); socket.isAlive = true; send(socket, { type: 'welcome', id: player.id });
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', (raw, isBinary) => {
    if (isBinary || !allow(player, 'all', 120)) { socket.close(1008, 'Message rate exceeded'); return; }
    let message; try { message = JSON.parse(String(raw)); } catch { reject(player, '消息格式无效'); return; }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') { reject(player, '消息格式无效'); return; }

    if (message.type === 'create') {
      if (!allow(player, 'lobby', 4, 5000)) return;
      const requestedCode=safeRoomCode(message.code);if(!requestedCode){reject(player,'房间码必须是 6 位字母或数字');return;}if(rooms.has(requestedCode)){reject(player,'该房间码已被使用，请更换');return;}
      detach(player); const team = safeTeam(message.team);
      const room = { code: requestedCode, hostId: player.id, status: 'lobby', map: 'city', mission: 'conquest', missionTeam: 'blue', players: [], lastSnapshot: null };
      player.name = safeName(message.name); player.team = team; player.weapon = safePrimary(team, message.weapon); player.activeWeapon = player.weapon;
      player.room = room; room.players.push(player); rooms.set(room.code, room); publishRoom(room); return;
    }
    if (message.type === 'join') {
      if (!allow(player, 'lobby', 4, 5000)) return;
      const room = rooms.get(safeRoomCode(message.code));
      if (!room || room.status !== 'lobby') { reject(player, '房间不存在或已经开局'); return; }
      if (room.players.length >= 24) { reject(player, '房间已满'); return; }
      detach(player); player.name = safeName(message.name); player.team = chooseTeam(room, message.team); player.weapon = safePrimary(player.team, message.weapon); player.activeWeapon = player.weapon;
      player.room = room; room.players.push(player); publishRoom(room); return;
    }

    const room = player.room; if (!room) { reject(player, '尚未加入房间'); return; }
    if (message.type === 'start') {
      if (room.hostId !== player.id) { reject(player, '只有房主可以开始'); return; }
      if (room.status !== 'lobby') { reject(player, '比赛已经开始'); return; }
      const mission=safeMission(message.mission);
      if(mission==='battle-royale'&&room.players.length>16){reject(player,'大逃杀最多允许 16 名真人');return;}
      room.status = 'playing'; room.map = safeMap(message.map); room.mission = mission; room.missionTeam = safeMissionTeam(message.missionTeam); room.lastSnapshot = null;
      broadcast(room, { type: 'matchStart', map: room.map, mission: room.mission, missionTeam: room.missionTeam, players: roomState(room).players }); publishRoom(room); return;
    }
    if (message.type === 'matchFinished') {
      if (room.hostId !== player.id || room.status !== 'playing') return;
      room.status = 'lobby'; room.lastSnapshot = null; publishRoom(room); return;
    }
    if (message.type === 'leave') { detach(player); return; }
    if (room.status !== 'playing') { reject(player, '比赛尚未开始'); return; }

    if (message.type === 'playerState') {
      if (!allow(player, 'state', 30)) return; const state = sanitizePlayerState(player, message.state); if (!state) return;
      broadcast(room, { type: 'playerState', id: player.id, state }, socket); return;
    }
    if (message.type === 'fire') {
      if (!allow(player, 'fire', 20)) return; const weaponId = safeWeaponForPlayer(player, message.weaponId); if (weaponId !== message.weaponId) return;
      const authoritativeHost = room.players.find(item => item.id === room.hostId); if (authoritativeHost && authoritativeHost !== player) send(authoritativeHost.socket, { type: 'fire', id: player.id, weaponId }); return;
    }
    if (message.type === 'reload') {
      if (!allow(player, 'reload', 4)) return; const weaponId = safeWeaponForPlayer(player, message.weaponId); if (weaponId !== message.weaponId) return;
      const authoritativeHost = room.players.find(item => item.id === room.hostId); if (authoritativeHost && authoritativeHost !== player) send(authoritativeHost.socket, { type: 'reload', id: player.id, weaponId }); return;
    }
    if (message.type === 'useItem' && (message.item === 'grenade' || message.item === 'heal')) {
      if (!allow(player, 'item', 4)) return; const authoritativeHost = room.players.find(item => item.id === room.hostId);
      if (authoritativeHost && authoritativeHost !== player) send(authoritativeHost.socket, { type: 'useItem', id: player.id, item: message.item }); return;
    }
    if (message.type === 'world') {
      if (room.hostId !== player.id || !allow(player, 'world', 15)) return; const snapshot = sanitizeWorldSnapshot(message.snapshot); if (!snapshot) return;
      room.lastSnapshot = snapshot; broadcast(room, { type: 'world', snapshot }, socket); return;
    }
    reject(player, '未知消息类型');
  });
  socket.on('close', () => { clients.delete(socket); detach(player); });
  socket.on('error', () => socket.close());
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) { if (socket.isAlive === false) { socket.terminate(); continue; } socket.isAlive = false; socket.ping(); }
}, 15000);

function shutdown() {
  clearInterval(heartbeat);
  for (const socket of wss.clients) socket.close(1001, 'Server shutdown');
  wss.close(() => server.close());
  setTimeout(() => process.exit(0), 5000).unref();
}
server.listen(port, host, () => console.log(`City Front web and room server: http://127.0.0.1:${port}`));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
