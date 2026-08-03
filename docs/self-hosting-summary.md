# Readest 自部署交接文档

> 用于跨会话交接，新会话先读此文档再继续工作。

---

## 当前状态：服务已运行，注册已关闭

| 项目 | 状态 |
|------|------|
| 域名 | `https://read-tp.zsxink.qzz.io`（Cloudflare 解析，Let's Encrypt 证书） |
| 服务器 | tp（192.168.166.52，SSH 端口 2026，用户 xian） |
| Docker 6 容器 | 全部 Up（healthy） |
| Web 端 | ✅ 可访问，可登录阅读 |
| HTTPS | ✅ nginx 反代 + 自动续期证书 |
| 用户注册 | ❌ 已关闭（DISABLE_SIGNUP=true），仅允许已有账号登录 |
| 已注册用户 | 仅 `yqylooq@qq.com` 一个账号 |
| 存储配额 | 20GB/用户 |
| **电子书上传** | ✅ **已修复**（2026-07-31）：DB 迁移 001–017 全部应用 + nginx 加 `/readest-files/` 路由到 MinIO |

---

## 一、服务器配置清单

### 1.1 仓库

- 路径：`~/readest`
- 分支：`publish`（`origin/publish`，GitHub: `zsxink/readest`）
- 子模块已初始化：`foliate-js`、`simplecc-wasm`
- 配置文件：`~/readest/docker/.env`

### 1.2 Docker 容器

```
client:3000  — ghcr.io/readest/readest:latest（预构建镜像）
kong:8000    — kong:2.8.1（API 网关，路由 /auth/* 和 /rest/*）
auth:9999    — supabase/gotrue:v2.185.0（JWT 认证）
rest:3000    — postgrest/postgrest:v14.3（数据库 REST API）
db:5432      — supabase/postgres:15.8.1.085（PostgreSQL）
minio:9000   — minio/minio（S3 文件存储）
```

### 1.3 认证与密钥

```
JWT_SECRET=DPYmntqeSbnr-R7IN5pOm1dD-7irmE6l2w20veeIiU8

ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg1MjQ1NzgxLCJleHAiOjIxMDA2MDU3ODF9.1pb3KWy-yKqqV3hMuF3hRJVdukGX3BdijXNTFtwwoB8

SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODUyNDU3ODEsImV4cCI6MjEwMDYwNTc4MX0.j6mbXOR7HQuf_lfoyyubngGMrnv24NkS3F9Phryxuo0

POSTGRES_PASSWORD=ZH3bbC9Dn4x1xwqIU1VTviMmgPSyJHouEXR7TgTwECA
MINIO_ROOT_PASSWORD=PkMgzn7gtWP7H1KvODl_RmoSPE7930_Ja-nutChFBS8
```

### 1.4 注册与登录配置

| 变量 | 值 | 效果 |
|------|-----|------|
| `DISABLE_SIGNUP` | `true` | 阻止新用户注册 |
| `ENABLE_EMAIL_SIGNUP` | `true` | 允许邮箱方式登录 |
| `ENABLE_EMAIL_AUTOCONFIRM` | `true` | 注册自动确认（无需验证邮件） |
| `STORAGE_FIXED_QUOTA` | `21474836480` (20GB) | 每个用户存储限额 |

### 1.5 nginx 反代

- 配置文件：`/etc/nginx/conf.d/read-tp.zsxink.qzz.io.conf`
- **80 → 443 HTTPS 重定向**
- `443 ssl http2` 监听
- SSL 证书：`/etc/nginx/ssl/read-tp.zsxink.qzz.io/fullchain.pem`
- 路由：
  - `/` → **`http://127.0.0.1:3000`**（Next.js SSR — 页面路由）
  - `/auth/v1/` → **`http://127.0.0.1:8000`**（Kong → gotrue API）
  - `/rest/v1/` → **`http://127.0.0.1:8000`**（Kong → PostgREST API）
  - `/storage/` → **`http://127.0.0.1:9000`**（MinIO S3）
  - `/readest-files/` → **`http://127.0.0.1:9000`**（MinIO S3，path-style 预签名上传下载）
- `client_max_body_size` 需设为 `100M`（电子书上传）

> ⚠️ **重要**: `/auth/` 路由必须只匹配 `/auth/v1/`，不能匹配 `/auth/`。否则页面请求（如 `/auth/`、`/auth/callback`）会被发到 Kong 返回 `"no Route matched with those values"`。`/rest/` 同理。

### 1.6 运行时配置（容器内）

client 容器的运行时环境变量通过 `compose.yaml` 注入，用户访问 `/runtime-config.js` 获取：

```json
{
  "supabaseUrl": "https://read-tp.zsxink.qzz.io",
  "supabaseAnonKey": "eyJh...",
  "apiBaseUrl": "https://read-tp.zsxink.qzz.io",
  "objectStorageType": "s3",
  "storageFixedQuota": 21474836480,
  "translationFixedQuota": 50000
}
```

---

## 二、本分支（publish）修改过的文件

这些是区别于上游 `main` 的自部署改动：

| 文件 | 改动 |
|------|------|
| `Dockerfile` | node:24-slim digest 更新 + `NPM_CONFIG_REGISTRY` build-arg 支持 |
| `apps/readest-app/next.config.mjs` | Turbopack 别名：`js-mdict`、`tauri-plugin-turso` stub |
| `apps/readest-app/src/middleware.ts` | `allowedOrigins` 需添加 `https://read-tp.zsxink.qzz.io` |

**tp 服务器上的现场修改（未入 git）：**

| 修改位置 | 内容 |
|----------|------|
| `~/readest/docker/compose.yaml` | `SUPABASE_PUBLIC_URL` 和 `S3_PUBLIC_ENDPOINT` 改为 `${SITE_URL}` |
| `~/readest/docker/compose.build.yaml` | 构建参数改为 `https://read-tp.zsxink.qzz.io` |
| `~/readest/docker/.env` | `DISABLE_SIGNUP=true`、`ENABLE_EMAIL_SIGNUP=false→true`、`STORAGE_FIXED_QUOTA=21474836480` |

**现场 nginx 修改（未入 git）：**
- `/etc/nginx/conf.d/read-tp.zsxink.qzz.io.conf` — `/auth/` → `/auth/v1/`，`/rest/` → `/rest/v1/`
- 同文件新增 `location /readest-files/` → `http://127.0.0.1:9000`，含 `proxy_set_header Authorization "";` 与 `client_max_body_size 100M;`（MinIO 上传必需，否则预签名 URL 的 PUT 会 404/400）

---

## 三、常用运维命令

```bash
# SSH 登录
ssh -p 2026 tp

# 容器管理（在 ~/readest/docker 目录下）
cd ~/readest/docker
docker compose ps                          # 查看状态
docker compose logs -f --tail=50 client    # 查看客户端日志
docker compose logs -f --tail=50 kong      # 查看 API 网关日志
docker compose logs -f --tail=50 db        # 查看数据库日志
docker compose up -d                       # 启动所有
docker compose up -d --force-recreate auth # 重启 auth（修改 .env 后）
docker compose up -d --force-recreate client # 重启 client（修改环境变量后）

# 更新代码
cd ~/readest && git pull --ff-only

# 查看运行时配置
curl https://read-tp.zsxink.qzz.io/runtime-config.js

# 检查健康
curl https://read-tp.zsxink.qzz.io/auth/v1/health

# nginx
sudo nginx -t
sudo systemctl reload nginx
```

---

## 四、todo：GitHub Actions 构建客户端

### 4.1 GitHub Secrets 需手动添加

在 GitHub 仓库 `zsxink/readest` → **Settings → Secrets and variables → Actions** 添加：

| Secret | 值 |
|--------|-----|
| `SUPABASE_URL` | `https://read-tp.zsxink.qzz.io` |
| `ANON_KEY` | 见 §1.3 的 `ANON_KEY` |
| `API_BASE_URL` | `https://read-tp.zsxink.qzz.io` |

如需为 Tauri 的应用内更新生成 `.sig` 文件，还需配置下列密钥。私钥和密码只存放在 GitHub Actions Secrets，绝不提交到仓库：

| Secret / 配置 | 值 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `readest-updater.key` 的完整私钥内容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成该私钥时使用的密码 |
| `apps/readest-app/src-tauri/tauri.conf.json` → `plugins.updater.pubkey` | 与上述私钥匹配的公钥：`dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDhFQkY2QjY4QkUzMEEyClJXU2lNTDVvYTcrT0FOQ0ZWZVNjNGcrWHN3ODRqQXJVTkc1dUFHUHJVclo3OU9IN2R5NTJnM3FHCg==` |

### 4.2 创建工作流文件

创建 `.github/workflows/build-selfhosted.yml`（基于 `docs/self-hosting-guide.md` §5 模板扩写）。

需要包含三个 job：

**① Android**
- `runs-on: ubuntu-latest`（免费）
- 流程：checkout → pnpm install → `pnpm tauri android build`
- 产物：`.apk` + `.aab`
- 注意：无开发者签名，直接输出 unsigned APK

**② macOS**
- `runs-on: macos-latest`（付费 runner）
- 流程：checkout → pnpm install → `pnpm tauri build`
- 产物：`.dmg`
- 注意：**无 Apple Developer 证书** → 需在 `tauri.conf.json` 关掉签名：
  ```json
  "bundle": {
    "macOS": {
      "signing": false
    }
  }
  ```
  自用情况下，用户首次打开时右键 → "打开" 即可绕过 Gatekeeper

**③ Windows**
- `runs-on: windows-latest`（免费但有额度限制）
- 流程：checkout → pnpm install → `pnpm tauri build`
- 产物：`.msi`
- 注意：无签名时 SmartScreen 会弹未知发布者警告，自用可忽略

### 4.3 关键构建参数（在 workflow 的 env 中设置）

```yaml
env:
  NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.ANON_KEY }}
  NEXT_PUBLIC_APP_PLATFORM: tauri
  NEXT_PUBLIC_API_BASE_URL: ${{ secrets.API_BASE_URL }}
```

Tauri 构建是静态导出，`NEXT_PUBLIC_*` 在编译时内联进 JS bundle，无法运行时修改。

### 4.4 Tauri CSP 配置

`apps/readest-app/src-tauri/tauri.conf.json` 中需要确保 `security.csp` 允许自部署域名，否则客户端内的 WebView 会阻止发往服务器的请求。

---

## 五、发布分支维护

```bash
# 从上游拉取新版本
git checkout publish
git fetch upstream
git merge upstream/main
# 解决冲突后推送，触发 GitHub Actions
git push origin publish
```

注意：`publish` 分支的 `Dockerfile` 和 `next.config.mjs` 有手动修改，merge 时可能冲突。

---

## 六、已知注意事项

1. **SMTP 未配** → 密码重置功能不可用，邮箱注册自动确认
2. **本地 build 客户端镜像失败** → tp 到 npmjs.org 网络慢导致 pnpm install 超时；当前用 `ghcr.io/readest/readest:latest` 预构建镜像代替
3. **CORS** → 只影响 Next.js 自身的 API handler（`/api/*`），Supabase 请求直接发给 Kong，不经过 Next.js CORS。页面上注册/登录不受影响
4. **9router** → tp 上另一个运行中的容器（端口 20128），与 readest 无冲突
5. **Cloudflare 代理** → 域名使用 Cloudflare 橙色云代理，源站无公网 IP 时外部 HTTPS 请求会 522 超时。当前修复方式：从同网络（内网）访问或配置 Cloudflare Tunnel
6. **nginx 路由精度** → `/auth/` 不可匹配到 Kong，必须用 `/auth/v1/`，否则页面路由被 Kong 拦截
