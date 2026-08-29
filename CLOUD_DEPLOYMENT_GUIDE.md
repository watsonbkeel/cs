# City Front 网页 FPS 云服务器部署任务

## 一、目标

把本机项目：

`/Users/nanazhou/Documents/chenyifan`

部署到 Debian 13 云服务器，最终通过以下地址访问：

`http://43.161.224.25`

服务器信息：

- IP：`43.161.224.25`
- SSH 用户：`chenyifan`
- 临时密码：与用户名相同
- 系统：Debian 13
- 项目服务端口：`7460`
- 公网端口：`80`

用户已授权安装部署此项目，但不要删除服务器上的无关文件。不要修改生成的 `cc.js`，不要在服务器上安装 Cocos Creator。

临时密码已经出现在会话和本文档中。部署成功并配置 SSH 密钥后，应提醒用户修改密码；没有确认前不要关闭密码登录，避免用户无法连接服务器。

## 二、部署架构

使用以下结构：

- Cocos Creator 3.8.7 Web Desktop 构建：静态游戏文件
- Node.js 20 或更高版本：运行 `server/index.mjs`
- systemd：保持游戏服务运行并自动重启
- Nginx：监听公网 `80` 端口
- `/rooms`：WebSocket 联机路径
- `7460`：只允许服务器本机访问，不直接暴露公网

Node 服务同时提供：

- `build/web-desktop` 静态文件
- `/healthz` 健康检查
- `/rooms` WebSocket 房间服务

## 三、部署前检查

先在本机项目目录检查：

```bash
cd /Users/nanazhou/Documents/chenyifan

test -f build/web-desktop/index.html
test -f server/index.mjs
test -f package.json
test -f package-lock.json

npm run check:server
npm run test:protocol
npm run test:rooms
```

确认构建来自 Cocos Creator `3.8.7`，不得用旧构建冒充新版本。

服务器不负责编译 Cocos 项目。若源码比构建文件新，先在本机完成 Web Desktop 构建，再上传。

## 四、首次连接服务器

在本机终端执行：

```bash
ssh chenyifan@43.161.224.25
```

首次连接时核对云服务控制台中的主机指纹，然后输入临时密码。

登录后确认 sudo 权限：

```bash
sudo -v
uname -a
cat /etc/debian_version
```

如果账号没有 sudo 权限，停止操作并让用户通过云服务控制台授予 sudo 权限，不要尝试绕过权限。

## 五、安装运行环境

在服务器执行：

```bash
sudo apt update
sudo apt install -y nodejs npm nginx curl rsync ufw
node --version
npm --version
```

Node.js 主版本必须不低于 `20`。如果 Debian 软件源提供的版本低于 20，再安装 Node.js 22 LTS，并重新确认：

```bash
node --version
command -v node
```

创建项目目录：

```bash
sudo mkdir -p /opt/city-front
sudo chown -R chenyifan:chenyifan /opt/city-front
```

## 六、上传项目

退出服务器，回到本机终端执行：

```bash
cd /Users/nanazhou/Documents/chenyifan

rsync -av --delete \
  build/web-desktop \
  server \
  package.json \
  package-lock.json \
  chenyifan@43.161.224.25:/opt/city-front/
```

不要上传本机的 `node_modules`、`library`、`temp`、Cocos 编辑器缓存或整个项目源码。

重新登录服务器：

```bash
ssh chenyifan@43.161.224.25
cd /opt/city-front
npm ci --omit=dev
node --check server/index.mjs
test -f build/web-desktop/index.html
```

## 七、创建 systemd 服务

确认 Node 路径：

```bash
command -v node
```

正常应为 `/usr/bin/node`。创建服务：

```bash
sudo tee /etc/systemd/system/city-front.service >/dev/null <<'EOF'
[Unit]
Description=City Front Web FPS Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=chenyifan
Group=chenyifan
WorkingDirectory=/opt/city-front
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=7460
Environment=ALLOWED_ORIGINS=http://43.161.224.25
ExecStart=/usr/bin/node /opt/city-front/server/index.mjs
Restart=always
RestartSec=3
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
```

如果 `command -v node` 不是 `/usr/bin/node`，应将 `ExecStart` 改成实际绝对路径。

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now city-front
sudo systemctl status city-front --no-pager
curl -fsS http://127.0.0.1:7460/healthz
```

健康检查应返回类似：

```json
{"ok":true,"rooms":0,"clients":0,"uptimeSeconds":1}
```

若失败，查看日志：

```bash
sudo journalctl -u city-front -n 100 --no-pager
```

## 八、配置 Nginx

创建站点配置：

```bash
sudo tee /etc/nginx/sites-available/city-front >/dev/null <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name 43.161.224.25 _;

    client_max_body_size 1m;

    location /rooms {
        proxy_pass http://127.0.0.1:7460;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:7460;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
```

启用配置：

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sfn /etc/nginx/sites-available/city-front /etc/nginx/sites-enabled/city-front
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

## 九、防火墙和云安全组

服务器本机防火墙：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw --force enable
sudo ufw status
```

云服务控制台安全组还需要允许：

- TCP `22`：建议只允许用户当前公网 IP
- TCP `80`：允许 `0.0.0.0/0`
- 不要开放 TCP `7460`

如果安全组没有开放 80，浏览器仍会显示无法访问，即使服务器内部运行正常。

## 十、部署验证

在服务器验证：

```bash
curl -I http://127.0.0.1/
curl -fsS http://127.0.0.1/healthz
sudo systemctl is-active city-front
sudo systemctl is-active nginx
ss -lntp | grep -E ':80|:7460'
```

预期：

- Nginx 监听 `0.0.0.0:80`
- Node 只监听 `127.0.0.1:7460`
- 两个 systemd 服务均为 `active`

在外部电脑访问：

`http://43.161.224.25`

浏览器验收：

1. 10 秒内离开加载画面并显示主菜单。
2. Console 没有 `localSetLayout`、`SubModel.update`、`null.length` 或资源 404。
3. `globalThis.__FPS_GAME__` 可用。
4. 可以进入单机战斗。
5. 鼠标锁定、射击、弹药、地图和 HUD 正常。
6. 能创建联机房间。
7. `/rooms` WebSocket 成功连接。
8. 另一台网络不同的电脑可以通过同一 IP 加入房间。

## 十一、更新部署

以后每次本机重新构建后执行：

```bash
cd /Users/nanazhou/Documents/chenyifan

rsync -av --delete \
  build/web-desktop \
  server \
  package.json \
  package-lock.json \
  chenyifan@43.161.224.25:/opt/city-front/
```

然后在服务器执行：

```bash
cd /opt/city-front
npm ci --omit=dev
sudo systemctl restart city-front
curl -fsS http://127.0.0.1:7460/healthz
sudo journalctl -u city-front -n 50 --no-pager
```

最后在 Chrome 中打开：

`http://43.161.224.25`

并按 `Command + Shift + R` 强制刷新。

## 十二、尚未包含的内容

当前只有公网 IP，因此首版使用 HTTP 和 `ws://`。

若后续提供域名，需要继续完成：

- 域名解析到 `43.161.224.25`
- HTTPS 证书
- Nginx 443 配置
- WebSocket 自动使用 `wss://`
- 将 `ALLOWED_ORIGINS` 改为正式 HTTPS 域名

不要为裸 IP 伪造 HTTPS 验收结果。

部署完成后，最终应向用户报告：访问地址、服务状态、健康检查结果、浏览器截图、WebSocket 测试结果及尚未完成的 HTTPS 配置。
