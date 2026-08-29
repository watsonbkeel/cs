const { gameUrl } = require('../../game.config');
const { normalizeGameUrl } = require('../../url-policy');

Page({
  data: {
    gameUrl: '',
    showWebView: false,
    canRetry: false,
    message: '游戏地址尚未配置',
  },

  onLoad() {
    const configuredUrl = normalizeGameUrl(gameUrl);
    this.configuredUrl = configuredUrl;

    if (!configuredUrl) {
      console.warn('[education-shell] Set an HTTPS or loopback gameUrl in game.config.js');
      return;
    }

    this.openGame();
  },

  openGame() {
    if (!this.configuredUrl) return;
    this.setData({
      gameUrl: this.configuredUrl,
      showWebView: true,
      canRetry: false,
      message: '正在进入游戏',
    });
  },

  handleWebViewLoad() {
    console.info('[education-shell] game loaded');
  },

  handleWebViewError(event) {
    console.error('[education-shell] game load failed', event.detail);
    this.setData({
      gameUrl: '',
      showWebView: false,
      canRetry: true,
      message: '游戏加载失败，请检查网络后重试',
    });
  },

  handleRetry() {
    this.openGame();
  },
});
