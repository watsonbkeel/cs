# Education Mini Program Shell

This directory is an ordinary WeChat Mini Program wrapper for the existing Cocos web build.

## Local DevTools simulator

1. Double-click `../start-education-local.command` and keep its terminal window open.
2. Import this directory in WeChat DevTools using the education Mini Program AppID and the **Mini Program** mode.
3. In DevTools local settings, enable the option that skips legal-domain, web-view domain, TLS, and HTTPS certificate validation.
4. Compile the Mini Program. It loads `http://127.0.0.1:7456/` from `game.config.js`.

The local HTTP URL is accepted only for `127.0.0.1` and `localhost`. Other HTTP hosts are rejected.

## Release

Deploy `build/web-mobile` to HTTPS, replace `gameUrl` with that HTTPS URL, re-enable domain validation, and add the host to the Mini Program business-domain allowlist. The loopback URL does not work on physical devices or in a release build.

The original Cocos project, `build/web-mobile`, and `build/wechatgame` remain independent from this wrapper.
