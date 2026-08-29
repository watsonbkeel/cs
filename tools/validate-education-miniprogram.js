const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'education-miniprogram');
const requiredFiles = [
  'app.js',
  'app.json',
  'app.wxss',
  'game.config.js',
  'url-policy.js',
  'project.config.json',
  'sitemap.json',
  'pages/game/game.js',
  'pages/game/game.json',
  'pages/game/game.wxml',
  'pages/game/game.wxss',
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`missing education shell file: ${file}`);
}

const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const app = readJson('app.json');
const project = readJson('project.config.json');
const privateProjectPath = path.join(root, 'project.private.config.json');
const privateProject = fs.existsSync(privateProjectPath) ? readJson('project.private.config.json') : null;
const page = readJson('pages/game/game.json');
const markup = fs.readFileSync(path.join(root, 'pages/game/game.wxml'), 'utf8');
const config = require(path.join(root, 'game.config.js'));
const { normalizeGameUrl } = require(path.join(root, 'url-policy.js'));

if (project.compileType !== 'miniprogram') throw new Error('education shell must compile as miniprogram');
if (project.miniprogramRoot !== './') throw new Error('miniprogramRoot must point to the shell root');
if (!app.pages.includes('pages/game/game')) throw new Error('game page is not registered');
if (app.window.pageOrientation !== 'landscape' || page.pageOrientation !== 'landscape') {
  throw new Error('education shell must use landscape orientation');
}
if (!markup.includes('<web-view') || !markup.includes('binderror="handleWebViewError"')) {
  throw new Error('game page must load the web build and handle load failures');
}
if (normalizeGameUrl('https://example.com/game/') !== 'https://example.com/game/') {
  throw new Error('HTTPS game URLs must be accepted');
}
if (normalizeGameUrl('http://127.0.0.1:7456/') !== 'http://127.0.0.1:7456/') {
  throw new Error('127.0.0.1 development URLs must be accepted');
}
if (normalizeGameUrl('http://localhost:7456/') !== 'http://localhost:7456/') {
  throw new Error('localhost development URLs must be accepted');
}
for (const unsafeUrl of ['http://example.com/', 'http://192.168.1.20:7456/', 'javascript:alert(1)']) {
  if (normalizeGameUrl(unsafeUrl)) throw new Error(`unsafe game URL accepted: ${unsafeUrl}`);
}
if (!normalizeGameUrl(config.gameUrl)) throw new Error('configured gameUrl is invalid');
if (project.setting.urlCheck !== false) throw new Error('local DevTools domain checking must be disabled');
if (privateProject && privateProject.setting && privateProject.setting.urlCheck !== false) {
  throw new Error('project.private.config.json overrides local domain checking');
}

let gamePage;
global.Page = definition => {
  gamePage = definition;
};
require(path.join(root, 'pages/game/game.js'));
delete global.Page;

const pageState = {
  ...gamePage,
  data: { ...gamePage.data },
  setData(update) {
    Object.assign(this.data, update);
  },
};
const originalWarn = console.warn;
console.warn = () => {};
gamePage.onLoad.call(pageState);
console.warn = originalWarn;
if (!pageState.data.showWebView || pageState.data.gameUrl !== config.gameUrl) {
  throw new Error('the configured local game URL must open automatically');
}

const originalError = console.error;
console.error = () => {};
gamePage.handleWebViewError.call(pageState, { detail: { errMsg: 'test failure' } });
console.error = originalError;
if (pageState.data.showWebView || !pageState.data.canRetry) {
  throw new Error('a web-view failure must leave a recoverable error state');
}
gamePage.handleRetry.call(pageState);
if (!pageState.data.showWebView || pageState.data.canRetry) {
  throw new Error('retry must reopen the configured game URL');
}

console.log(`education mini-program shell validated: ${requiredFiles.length} required files, URL policy and retry states passed, ${config.gameUrl}`);
