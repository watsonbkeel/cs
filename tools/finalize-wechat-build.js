const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'build', 'wechatgame');
const appid = process.env.WECHAT_APPID || 'touristappid';
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);

if (!fs.existsSync(root)) throw new Error('build/wechatgame does not exist');
const project = read('project.config.json');
project.appid = appid;
project.projectname = 'wechat-tactical-fps';
project.compileType = 'game';
write('project.config.json', project);

const game = read('game.json');
game.deviceOrientation = 'landscape';
write('game.json', game);

const seen = new Map();
const collisions = [];
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(root, full);
    const lower = relative.toLowerCase();
    if (seen.has(lower) && seen.get(lower) !== relative) collisions.push([seen.get(lower), relative]);
    else seen.set(lower, relative);
    if (entry.isDirectory()) scan(full);
  }
}
scan(root);
if (collisions.length) throw new Error(`case-colliding files: ${JSON.stringify(collisions)}`);

const required = ['game.js', 'game.json', 'project.config.json', 'application.js'];
for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error(`missing build file: ${file}`);
console.log(`wechat build finalized: ${seen.size} entries, landscape, ${appid}`);
