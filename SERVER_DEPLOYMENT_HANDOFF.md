# City Front 服务器部署交接文档

版本：1.0  
日期：2026-07-16

## 1. 部署任务

将 City Front 桌面网页版 FPS 部署到以下服务器：

- SSH 主机：`175.178.194.44`
- SSH 用户：`chenyifan`
- SSH 命令：`ssh chenyifan@175.178.194.44`
- 项目本地目录：`/Users/nanazhou/Documents/chenyifan`
- 应用默认端口：`7460`

认证密码由用户单独提供。禁止把密码写入脚本、Git、部署文档、命令行参数或日志。部署完成后建议更换密码并配置 SSH 公钥。

## 2. 服务结构

后端入口：

```text
server/index.mjs
server/protocol.mjs
```

服务同时提供：

- `build/web-desktop` 静态网页；
- `/rooms` WebSocket 房间服务；
- 6 位房间码；
- 最多 10 名真人；
- 阵营平衡、房主开始、房主迁移；
- 玩家状态、射击、换弹、道具和世界快照转发。
- `/healthz` 进程健康检查；
- 消息频率、房间状态、阵营武器、弹量、坐标和世界快照校验；
- 房主迁移时交接最后一个权威快照。

启动命令：

```bash
npm start
```

默认监听：

```text
0.0.0.0:7460
```

客户端会根据网页地址自动选择 WebSocket：

- HTTP 页面使用 `ws://同域名/rooms`；
- HTTPS 页面使用 `wss://同域名/rooms`。

## 3. 必须上传的文件

只上传运行所需文件，不要上传本机缓存和开发工具目录。

```text
build/web-desktop/
server/index.mjs
package.json
package-lock.json
deploy/
ecosystem.config.cjs
```

不要上传：

```text
node_modules/
library/
temp/
test-results/
.DS_Store
```

不要在服务器上重新构建 Cocos 项目。服务器只运行本机已经生成并验收的 `build/web-desktop`。

## 4. 部署前本地检查

在项目目录执行：

```bash
cd /Users/nanazhou/Documents/chenyifan

test -f build/web-desktop/index.html
test -f build/web-desktop/src/settings.json
test -f server/index.mjs

rg '"CocosEngine":"3.8.7"' build/web-desktop/src/settings.json
rg 'builtin-standard' build/web-desktop/assets/*/config.json
node --check server/index.mjs
node tests/server-protocol.test.mjs
```

必须确认：

- Web Desktop 构建存在且文件时间为最新；
- `CocosEngine` 是 `3.8.7`；
- 构建依赖中包含 `builtin-standard`；
- `server/index.mjs` 语法检查通过。

任一条件失败时停止部署，不能上传旧构建冒充新版本。

## 5. 首次登录与只读检查

先登录服务器，不要立即安装或覆盖文件：

```bash
ssh chenyifan@175.178.194.44
```

检查系统和已有服务：

```bash
uname -a
cat /etc/os-release
node --version || true
npm --version || true
command -v nginx || true
command -v caddy || true
command -v pm2 || true
ss -lntp 2>/dev/null | grep ':7460' || true
ps -ef | grep '[s]erver/index.mjs' || true
```

要求：

- 不覆盖服务器上的其他项目；
- 如果 7460 已被其他应用占用，停止并报告，不得直接终止未知进程；
- 确认当前用户对部署目录有写权限；
- 优先使用 Node.js 20 LTS 或更新版本。

## 6. 建议目录结构

```text
/home/chenyifan/apps/city-front/
  current/
  releases/
  logs/
```

每次部署创建独立版本目录，例如：

```text
/home/chenyifan/apps/city-front/releases/20260716-160000/
```

验证成功后再让 `current` 指向新版本。不要直接覆盖上一个可运行版本。

## 7. 上传步骤

在服务器创建目录：

```bash
mkdir -p /home/chenyifan/apps/city-front/releases
mkdir -p /home/chenyifan/apps/city-front/logs
```

在本机设置一个唯一版本号：

```bash
RELEASE=20260716-160000
```

上传运行文件：

```bash
ssh chenyifan@175.178.194.44 \
  "mkdir -p /home/chenyifan/apps/city-front/releases/$RELEASE"

rsync -az \
  build/web-desktop \
  server \
  package.json \
  package-lock.json \
  chenyifan@175.178.194.44:/home/chenyifan/apps/city-front/releases/$RELEASE/
```

上传后检查文件：

```bash
ssh chenyifan@175.178.194.44
cd /home/chenyifan/apps/city-front/releases/20260716-160000
find build/web-desktop -maxdepth 2 -type f | head
node --check server/index.mjs
```

实际执行时必须使用本次真实的 `RELEASE`，不能照抄过期时间。

## 8. 安装生产依赖

进入新版本目录：

```bash
cd /home/chenyifan/apps/city-front/releases/<RELEASE>
npm ci --omit=dev
```

验证正式 WebSocket 依赖：

```bash
npm ls ws
```

必须使用 `ws` 包。生产环境不能依赖 Playwright 内部 WebSocket 回退。

## 9. 首次前台试运行

在新版本目录运行：

```bash
PORT=7460 NODE_ENV=production node server/index.mjs
```

预期输出：

```text
City Front web and room server: http://127.0.0.1:7460
```

在另一个 SSH 会话检查：

```bash
curl -I http://127.0.0.1:7460/
curl -I http://127.0.0.1:7460/src/settings.json
curl http://127.0.0.1:7460/healthz
```

预期：HTTP 200，且没有持续异常日志。前台验证完成后使用 `Ctrl+C` 正常停止，再配置进程守护。

## 10. 进程守护

优先使用 systemd；没有 sudo 权限时使用 PM2。

### 10.1 systemd 方案

项目已提供可直接安装的 `deploy/systemd/city-front.service`。服务配置为：

```ini
[Unit]
Description=City Front Web and Room Server
After=network.target

[Service]
Type=simple
User=chenyifan
WorkingDirectory=/home/chenyifan/apps/city-front/current
Environment=NODE_ENV=production
Environment=PORT=7460
ExecStart=/usr/bin/node server/index.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

保存为：

```text
/etc/systemd/system/city-front.service
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now city-front
sudo systemctl status city-front --no-pager
sudo journalctl -u city-front -n 100 --no-pager
```

在创建服务前，先设置当前版本：

```bash
cd /home/chenyifan/apps/city-front
ln -sfn releases/<RELEASE> current
```

### 10.2 PM2 备选方案

```bash
npm install -g pm2
cd /home/chenyifan/apps/city-front/current
PORT=7460 NODE_ENV=production pm2 start server/index.mjs --name city-front
pm2 save
pm2 startup
```

执行 `pm2 startup` 输出的命令后，再确认 `pm2 save`。

## 11. 公网访问方案

### 11.1 临时 IP 测试

没有域名和 TLS 证书时，只能先测试：

```text
http://175.178.194.44:7460
ws://175.178.194.44:7460/rooms
```

需要同时开放：

- 云服务器安全组 TCP 7460；
- 操作系统防火墙 TCP 7460。

不要把此方式描述为正式 HTTPS/WSS 部署。

### 11.2 正式 HTTPS/WSS

正式发布需要用户提供已解析到该服务器的域名。项目提供 `deploy/nginx/city-front.conf` 和 `deploy/Caddyfile`；将其中 `GAME_DOMAIN` 替换为正式域名。Nginx 核心代理规则如下：

```nginx
server {
    listen 80;
    server_name <GAME_DOMAIN>;

    location / {
        proxy_pass http://127.0.0.1:7460;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /rooms {
        proxy_pass http://127.0.0.1:7460;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 60s;
    }
}
```

配置完成后使用 Certbot 或 Caddy申请 TLS 证书。HTTPS 页面必须通过同域名的 WSS 连接 `/rooms`。

## 12. 部署验收

部署 AI 必须提供实际输出记录，不得只说“已部署”。

### 12.1 文件与进程

- `current` 指向本次版本；
- `build/web-desktop/index.html` 存在；
- `node_modules/ws` 已安装；
- 进程守护状态为 running；
- 重启进程后网页仍能访问。

### 12.2 HTTP

```bash
curl -I http://127.0.0.1:7460/
curl http://127.0.0.1:7460/src/settings.json | grep '3.8.7'
```

- 首页返回 200；
- `settings.json` 返回 200；
- CocosEngine 为 3.8.7；
- 静态 JS、JSON、BIN 和 WAV 文件没有 404。

### 12.3 WebSocket

- 连接 `/rooms` 后收到 `welcome`；
- 创建房间后收到 6 位房间码；
- 第二个客户端能够加入；
- 房主能够开始比赛；
- 房主断开后完成迁移；
- 服务端没有未捕获异常。

### 12.4 浏览器

- 10 秒内离开 Cocos splash；
- 主菜单正常出现；
- `globalThis.__FPS_GAME__` 可用；
- 单机和联机入口可用；
- Console 没有 `localSetLayout`、`SubModel.update`、`null.length` 或严重资源错误。

## 13. 回滚

新版本失败时：

1. 停止当前服务；
2. 将 `current` 恢复到上一个已验证版本；
3. 重新启动服务；
4. 验证首页和 `/rooms`；
5. 保留失败版本日志，不直接删除以便排查。

示例：

```bash
cd /home/chenyifan/apps/city-front
ln -sfn releases/<PREVIOUS_RELEASE> current
sudo systemctl restart city-front
sudo systemctl status city-front --no-pager
```

## 14. 安全要求

- 不在任何文件和命令中保存 SSH 密码；
- 部署后更换已在聊天中出现过的密码；
- 配置 SSH 公钥并逐步关闭密码登录；
- 不开放不必要端口；
- 使用 HTTPS/WSS 后关闭公网 7460，只允许反向代理访问；
- 定期检查 systemd/PM2 日志和异常连接；
- 不修改生成的 `cc.js` 来掩盖运行错误。

## 15. 最终交付信息

另一个 AI 完成部署后必须返回：

- 实际部署目录和版本号；
- Node.js 与 `ws` 版本；
- systemd 或 PM2 运行状态；
- 公网访问地址；
- HTTP 和 WebSocket 验证结果；
- 开放的端口及防火墙状态；
- HTTPS/WSS 是否完成；
- 发现的问题、处理方式和剩余风险。
