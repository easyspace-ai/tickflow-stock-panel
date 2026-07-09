# 部署指南

本项目的几种运行方式，按推荐程度排序。配置项详解见 [configuration.md](./configuration.md)。

> 📌 前置依赖:Python ≥ 3.11 · Node ≥ 20 · [`uv`](https://docs.astral.sh/uv/) · `pnpm`（`npm i -g pnpm`）

---

## 方式 A:Dev 模式(二次开发推荐)

由于刚开源近期更新频繁,推荐开发模式运行,可随时 `git pull` 同步最新代码。

```bash
git clone https://github.com/shy3130/tickflow-stock-panel.git
cd tickflow-stock-panel
cp .env.example .env       # 按需填 TICKFLOW_API_KEY(留空 = None 模式)
./dev.sh                   # Windows: .\dev.ps1
```

`dev.sh` 自动检查 / 下载依赖、释放端口、同时起前后端,Ctrl-C 一并关闭。默认:

- 后端 → <http://localhost:3018> · 前端 → <http://localhost:9200>
- 自定义端口:`BACKEND_PORT=8000 FRONTEND_PORT=5173 ./dev.sh`

### 手动分别启动(不想用 dev.sh)

```bash
# 后端
cd backend && uv sync --extra backtest   # 含回测依赖
uv run uvicorn app.main:app --reload --port 3018

# 前端
cd frontend && pnpm install && pnpm dev   # http://localhost:9200
```

---

## 方式 B:Docker(部署最省心)

```bash
cp .env.example .env
docker compose up --build
# 打开 http://localhost:3018
```

Docker 采用两阶段构建,前端 dist 拷进后端镜像,**单容器**运行,数据完全在自己手里。

> 💡 镜像已内置 Node.js 运行时并预装 **stock-sdk** 插件依赖,Docker 部署下开箱即用,无需手动 `npm install`。

更新到新版本:

```bash
git pull
docker compose up --build -d
```

---

## 方式 C:PM2 生产部署(裸机 / VPS)

与 Docker 相同,生产环境**只有一个端口**:FastAPI(uvicorn)同时提供 API 和已构建的 `frontend/dist` 静态页面。**不会**单独启动 Vite,因此 **9200 端口在生产上不会监听**。

| 场景 | 端口 | 说明 |
|------|------|------|
| `dev.sh` 本地开发 | 3018 + **9200** | 后端 API + Vite 热更新(两个进程) |
| PM2 / Docker 生产 | **7300**(默认) | 单进程,API + 静态前端合一 |

> 若你曾在本地用 `http://localhost:9200` 访问面板,部署到服务器后应改为 `http://<服务器IP>:7300`。若防火墙/Nginx 已按其他端口配置,可在 `.env` 设 `PORT=...` 后 `pm2 reload`。

### 首次部署

```bash
cd /data/tickflow-stock-panel   # 或你的部署目录
cp .env.example .env            # 编辑 TICKFLOW_API_KEY、AUTH_PASSWORD(公网)等
chmod 600 .env

cd frontend && pnpm install && pnpm build && cd ..
cd backend && uv sync --no-dev && cd ..   # 老 CPU: --extra legacy-cpu

chmod +x scripts/start-pm2.sh
pm2 delete tickflow-stock-panel 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

### 更新版本

```bash
cd /data/tickflow-stock-panel
git pull
# frontend/dist 已纳入 git 时无需 pnpm build; 若仓库未带 dist 再执行:
# cd frontend && pnpm install && pnpm build && cd ..
cd backend && uv sync --no-dev && cd ..
pm2 reload ecosystem.config.cjs
```

### 服务器诊断命令

```bash
# 1. 前端是否已构建 (没有 dist 则页面空白)
ls -la frontend/dist/index.html

# 2. PM2 进程状态 (应为 online, 非 errored / restarting)
pm2 status
pm2 logs tickflow-stock-panel --lines 50

# 3. 端口监听 (生产看 PORT, 默认 7300; 9200 不应出现)
ss -tlnp | grep -E '7300|9200'

# 4. 健康检查
curl -s http://127.0.0.1:7300/health

# 5. 若改了 PORT=9200, 健康检查与防火墙也要对应
curl -s http://127.0.0.1:9200/health
```

### 常见问题

**更新后 9200 没开、页面打不开**

- 正常:生产不监听 9200。请访问 `http://<IP>:7300`(或 `.env` 中的 `PORT`)。
- 若 `pm2 status` 显示 `errored` / 反复重启:先执行 `cd backend && uv sync --no-dev`,再 `pm2 reload`。不要用 `uv run uvicorn` 直接给 PM2(每次重启会 sync,易超时崩溃)。
- 若 `curl .../health` 本机通、外网不通:检查云安全组 / `ufw` / `firewalld` 是否放行 `PORT`(默认 7300)。

```bash
# 示例: 放行 7300 (按实际 PORT 替换)
sudo ufw allow 7300/tcp
```

完整步骤与 Nginx 反代示例见仓库根目录 `ecosystem.config.cjs` 顶部注释。

---

## 方式 D:GitHub Actions 自行构建

Fork 本仓库后,手动触发 [Release 打包工作流](https://github.com/shy3130/tickflow-stock-panel/actions/workflows/release.yml) 自行构建桌面客户端安装包。

> ⚠️ 目前官方 Release 的安装包存在已知问题(修复中),如需桌面客户端请优先用此方式自行构建,或用上面的 Dev / Docker 方式运行。

---

## 老 CPU 兼容(avx2/fma 缺失)

如果运行时报 `avx2`/`fma` 缺失,或进程 `exit 132`,说明 CPU 不支持 AVX2 指令集(常见于老 VPS)。解决:

- **桌面客户端**:安装包已内置兼容内核,新老 CPU 通吃
- **Docker / 源码**:在 `.env` 打开 `BACKEND_EXTRAS=legacy-cpu` 后重建,会给 Polars 切到 `rtcompat` 运行时

```ini
BACKEND_EXTRAS=legacy-cpu          # 兼容老 CPU
BACKEND_EXTRAS=legacy-cpu backtest # 兼容老 CPU + 回测依赖
```

### 回测依赖说明

vectorbt → numba 体积较大,作为可选 extras(`uv sync --extra backtest`)。macOS / Intel 无预构建 wheel 时需 `brew install cmake` 现场编译。

---

## 更新代码(已部署用户必读)

拉取新版本只需一条命令:

```bash
git pull
```

**Docker 用户:** `docker compose up --build -d`

**PM2 用户:**

```bash
cd backend && uv sync --no-dev && cd ..
pm2 reload ecosystem.config.cjs
```

**整个 `data/` 目录都不纳入 git** —— 行情 K线、财务、自选、回测、监控记录,乃至概念/行业扩展数据,全部是程序运行时生成/拉取的用户数据,`git pull` 物理上无法影响它们。新用户首次启动时,概念/行业两份扩展数据会自动从远程接口拉取,无需任何手动操作。

> ⚠️ **切勿使用以下命令"解决冲突"或"清理",它们会一次性删光 `data/` 下所有未被 git 跟踪的数据:**
> - `git clean -fdx`(最危险,会删掉所有 `.gitignore` 忽略的文件)
> - `git reset --hard`
> - 直接删除整个项目文件夹重新 `git clone`
>
> 若 `git pull` 报冲突,通常是本地误改了被跟踪的文件,请先 `git stash` 暂存再 pull,或单独联系作者,不要直接执行上面的命令。

---

## 访问密码设置(公网部署必读)

面板部署在公网服务器时,首次设置访问密码有限制 —— **必须从本机或内网访问**,以防公网上陌生人抢先设置密码锁死你的面板。

如果你在公网浏览器直接打开页面,会看到提示:

> 首次设置密码仅允许本机或内网访问,请通过 SSH/本地浏览器操作

有两种方式解决,任选其一。

### 方式一:环境变量预置密码(最简单,推荐)

在 `.env` 文件(或 Docker / 系统环境变量)里设置 `AUTH_PASSWORD`:

```bash
AUTH_PASSWORD=你的密码
```

然后重启服务。启动时会自动:

1. 读取 `AUTH_PASSWORD`
2. 用 PBKDF2 哈希后写入 `auth.json`(`chmod 600`,只存哈希不存明文)
3. **之后这个环境变量就不再被读取** —— 是一次性的初始化

设完后即可用公网地址 + 这个密码正常登录。后续改密码请用页面 UI(`设置 → 修改密码`),不受环境变量影响。

**注意事项:**

- **密码至少 6 位**,否则会被跳过并记一条 warning 日志
- **仅在未设过密码时生效**。已设过密码后,改这里不会覆盖(避免重启时重置你在 UI 改的密码)
- `.env` 文件权限保持 `600`,**不要提交到 Git**
- 明文密码只存在于 `.env` / 环境变量中,落盘的是哈希,安全性等同 `auth.json`

**重置密码(忘密码时):** 删除或清空 `data/user_data/auth.json`,重启服务,会回到"未设密码"状态,此时 `AUTH_PASSWORD` 会重新生效。

```bash
rm data/user_data/auth.json   # 停服后执行,清空后重启
```

### 方式二:SSH 端口转发

不用改配置,在你**自己电脑**的终端执行(不是服务器上):

```bash
ssh -L 3018:127.0.0.1:3018 用户名@服务器IP
```

例如服务器是 `123.45.67.89`、用户名 `root`、面板端口 `3018`:

```bash
ssh -L 3018:127.0.0.1:3018 root@123.45.67.89
```

保持这个 SSH 连接**不要关**,然后在**自己电脑的浏览器**打开 `http://127.0.0.1:3018`。此时后端看到的客户端 IP 是 `127.0.0.1`(本机),能通过校验,正常显示设置密码界面。

**设完密码后**,SSH 连接可以断开 —— 密码已存进服务器,之后直接用公网地址 + 刚设的密码访问即可。

> 如果用 `PORT` 改过端口(比如 `PORT=8080`),两处都要替换:`ssh -L 8080:127.0.0.1:8080 root@IP`。

### 两种方式怎么选

| | 环境变量 | SSH 转发 |
|---|---|---|
| 操作 | 改一行配置 + 重启 | 一条 ssh 命令 |
| 需要改配置 | 是 | 否 |
| 适合 | Docker / 自动化部署 / 不熟 SSH | 临时设密码 / 能 SSH 到服务器 |
| 后续改密码 | UI(`设置 → 修改密码`) | 同左 |

推荐**方式一(环境变量)**,一次配置即可,Docker 部署尤其方便。

### 原理说明

- **为什么限制本机/内网?** 面板部署到公网后,任何人都能访问 URL。如果不限制,攻击者可以在你之前打开页面、设置一个密码,把你的面板锁死。
- **本机/内网如何判断?** 后端检查客户端 IP 是否属于 `127.0.0.1 / ::1 / 10.x / 192.168.x / 172.16-31.x`。
- **SSH 转发为什么有效?** `-L` 把本机端口通过 SSH 隧道转发到服务器的 `127.0.0.1`,等同于在服务器本地访问,客户端 IP 变成 `127.0.0.1`,通过校验。
- **反向代理注意:** 若面板在 Nginx 等反代之后,需正确配置 `X-Forwarded-For` 头,后端据此取真实客户端 IP。
