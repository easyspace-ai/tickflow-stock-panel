/**
 * PM2 生产部署 — tickflow-stock-panel
 *
 * ═══════════════════════════════════════════════════════════════════
 * 部署步骤 (在项目根目录执行)
 * ═══════════════════════════════════════════════════════════════════
 *
 * 0. 前置: Node ≥ 20 · Python ≥ 3.11 · uv · pnpm · PM2 · (可选) Node 供 stock-sdk
 *
 * 1. 配置环境
 *    cp .env.example .env
 *    # 编辑 .env: TICKFLOW_API_KEY、AUTH_PASSWORD(公网部署)、PORT 等
 *    chmod 600 .env
 *
 * 2. 构建前端 (dist 由 FastAPI 托管, 必须先 build)
 *    cd frontend && pnpm install && pnpm build && cd ..
 *
 * 3. 安装后端依赖
 *    cd backend && uv sync --no-dev
 *    # 需要回测:  uv sync --no-dev --extra backtest
 *    # 老 CPU:    uv sync --no-dev --extra legacy-cpu
 *    # 组合示例:  uv sync --no-dev --extra legacy-cpu --extra backtest
 *    cd ..
 *
 * 4. stock-sdk 插件 (非 Docker 部署需手动装 Node 依赖)
 *    cd backend/app/plugins/stocksdk && npm install && cd ../../../../
 *
 * 5. 启动 / 管理
 *    pm2 start ecosystem.config.cjs          # 首次
 *    pm2 reload ecosystem.config.cjs         # 更新代码后
 *    pm2 logs tickflow-stock-panel
 *    pm2 save && pm2 startup                 # 开机自启 (按 pm2 startup 提示执行)
 *
 * 6. (可选) Nginx 反向代理 — 示例见文件末尾
 *
 * 更新版本:
 *    git pull
 *    cd frontend && pnpm install && pnpm build && cd ..
 *    cd backend && uv sync --no-dev [--extra ...] && cd ..
 *    pm2 reload ecosystem.config.cjs
 *
 * 访问: http://<服务器IP>:3018  (或 .env 中 PORT)
 * 公网部署请在 .env 设置 AUTH_PASSWORD, 详见 docs/deployment.md
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const BACKEND = path.join(ROOT, "backend");
const LOG_DIR = path.join(ROOT, "logs");

/** 简易解析项目根 .env, 供 PM2 进程环境变量 (应用本身也会通过 pydantic-settings 再读一遍) */
function loadDotEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // 去掉行内注释 (不含引号包裹的值)
    if (!val.startsWith('"') && !val.startsWith("'")) {
      const hash = val.indexOf(" #");
      if (hash !== -1) val = val.slice(0, hash).trim();
    }
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const dotenv = loadDotEnv(path.join(ROOT, ".env"));
const PORT = dotenv.PORT || process.env.PORT || "3018";
const HOST = dotenv.HOST || process.env.HOST || "0.0.0.0";

module.exports = {
  apps: [
    {
      name: "tickflow-stock-panel",
      cwd: BACKEND,
      script: "uv",
      args: `run uvicorn app.main:app --host ${HOST} --port ${PORT}`,
      interpreter: "none",

      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 3000,
      kill_timeout: 15000,
      watch: false,

      env: {
        NODE_ENV: "production",
        TZ: "Asia/Shanghai",
        ...dotenv,
        // 覆盖 .env 中的相对路径, 避免 cwd=backend/ 时 ./data 解析错位
        DATA_DIR: path.join(ROOT, "data"),
        HOST,
        PORT,
      },

      error_file: path.join(LOG_DIR, "pm2-error.log"),
      out_file: path.join(LOG_DIR, "pm2-out.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};

/*
 * ── (可选) Nginx 反向代理示例 ──────────────────────────────────────
 *
 * server {
 *     listen 80;
 *     server_name panel.example.com;
 *
 *     location / {
 *         proxy_pass http://127.0.0.1:3018;
 *         proxy_http_version 1.1;
 *         proxy_set_header Host $host;
 *         proxy_set_header X-Real-IP $remote_addr;
 *         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 *         proxy_set_header X-Forwarded-Proto $scheme;
 *         # SSE / 长连接
 *         proxy_buffering off;
 *         proxy_read_timeout 86400s;
 *     }
 * }
 *
 * HTTPS: 用 certbot / acme.sh 申请证书后 listen 443 ssl 即可。
 * 反代后首次设密码需正确传递 X-Forwarded-For, 见 docs/deployment.md
 */
