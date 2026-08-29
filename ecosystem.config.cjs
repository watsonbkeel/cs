module.exports = {
  apps: [{
    name: 'city-front',
    script: 'server/index.mjs',
    cwd: '/home/chenyifan/apps/city-front/current',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 3000,
    env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: 7460 },
    out_file: '/home/chenyifan/apps/city-front/logs/app.log',
    error_file: '/home/chenyifan/apps/city-front/logs/error.log',
    merge_logs: true,
    time: true,
  }],
};
