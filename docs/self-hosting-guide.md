# Readest 自部署文档

> 本文档涵盖从服务器部署到客户端构建的全过程，使您能够完全拥有自己的阅读同步基础设施。

---

## 目录

1. [架构概览](#1-架构概览)
2. [服务器部署 (Docker)](#2-服务器部署-docker)
3. [Nginx 反向代理与 HTTPS](#3-nginx-反向代理与-https)
4. [客户端构建配置](#4-客户端构建配置)
5. [GitHub Actions Android 构建](#5-github-actions-android-构建)
6. [配置变更清单](#6-配置变更清单)
7. [验证与排错](#7-验证与排错)

---

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                       公网 (IPv6)                           │
│   域名: your-domain.example.com (AAAA → 240e:...:98e3)     │
└──────────────────────┬─────────────────────────────────────┘
                       │ :443 (HTTPS)
┌──────────────────────▼─────────────────────────────────────┐
│                    Nginx (系统代理)                          │
│                   /etc/nginx/sites-enabled/                  │
│   ┌─────────────────┴─────────────────────────────────┐    │
│   │ /readest/* → localhost:3000  (Next.js)            │    │
│   │ /auth/* → localhost:8000   (Kong/gotrue)          │    │
│   │ /rest/* → localhost:8000   (Kong/postgREST)       │    │
│   │ /storage/* → localhost:9000 (MinIO S3)            │    │
│   └─────────────────┬─────────────────────────────────┘    │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│                  Docker Compose (readest)                   │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  client  │  │   kong   │  │   auth   │  │   rest   │   │
│  │ :3000    │  │ :8000    │  │ :9999    │  │ :3000    │   │
│  │ Next.js  │  │ Kong 2.8 │  │ gotrue   │  │PostgREST │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │              │        │
│       └──────────────┼──────────────┼──────────────┘        │
│                      │              │                       │
│              ┌───────▼──────────────▼───────┐               │
│              │           db                 │               │
│              │      PostgreSQL 15          │               │
│              └──────────────────────────────┘               │
│                                                              │
│  ┌──────────┐ ┌──────────────┐                              │
│  │  minio   │ │ minio-setup  │                              │
│  │ :9000    │ │ (一次性)     │                              │
│  │ S3存储   │ │ 建桶         │                              │
│  └──────────┘ └──────────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

**核心原理**: 所有同步数据（阅读进度、笔记、书签、电子书文件）经由 Supabase API + MinIO S3 传输，完全脱离第三方服务。

**六个 Docker 容器**：
| 容器 | 镜像 | 角色 |
|------|------|------|
| `client` | `ghcr.io/readest/readest:latest` | Next.js 前端（含 SSR） |
| `kong` | `kong:2.8.1` | API 网关（路由 + 鉴权） |
| `auth` | `supabase/gotrue:v2.185.0` | 用户认证（JWT） |
| `rest` | `postgrest/postgrest:v14.3` | PostgreSQL REST API |
| `db` | `supabase/postgres:15.8.1.085` | 数据库（含 Supabase 扩展） |
| `minio` | `minio/minio` | S3 对象存储（电子书文件） |

---

## 2. 服务器部署 (Docker)

### 2.1 准备环境

```bash
# 本机 → tp 服务器
ssh tp

# 克隆仓库
git clone https://github.com/readest/readest.git ~/readest
cd ~/readest

# 初始化 git 子模块（foliate-js 和 simplecc-wasm，本地构建时需要）
git submodule update --init packages/foliate-js packages/simplecc-wasm

# 进入 docker 目录
cd docker
```

### 2.2 配置 .env

```bash
cp .env.example .env
```

编辑 `docker/.env`，以下是针对 tp 服务器的推荐配置：

```bash
# === 数据库 ===
POSTGRES_PASSWORD=<生成 32+ 字符的强密码>
POSTGRES_PORT=5432
POSTGRES_DB=readest

# === JWT (使用 jwt.io 生成 HS256 签名) ===
JWT_SECRET=<生成 32+ 字符的随机密钥>
JWT_EXPIRY=86400

# === API 密钥 ===
# ANON_KEY: payload {"role": "anon"}  用 JWT_SECRET 签名
# SERVICE_ROLE_KEY: payload {"role": "service_role"}  用 JWT_SECRET 签名
ANON_KEY=<用 JWT_SECRET 签发的 HS256 JWT>
SERVICE_ROLE_KEY=<用 JWT_SECRET 签发的 HS256 JWT>

# === 主机配置（IPv6 域名） ===
HOST_IP=your-domain.example.com
KONG_HTTP_PORT=8000

# === 站点 URL ===
API_EXTERNAL_URL=https://your-domain.example.com
SITE_URL=https://your-domain.example.com

# === MinIO S3 ===
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=<生成强密码>
S3_BUCKET_NAME=readest-files

# === 用户注册 ===
DISABLE_SIGNUP=false           # true 则关闭公开注册
ENABLE_EMAIL_SIGNUP=true       # 启用邮箱登录
ENABLE_EMAIL_AUTOCONFIRM=true  # 自动确认（无需验证邮件）
ENABLE_ANONYMOUS_USERS=false

# === SMTP (可选，用于密码重置) ===
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_ADMIN_EMAIL=
SMTP_SENDER_NAME=Readest

# === 存储配额 (字节) ===
STORAGE_FIXED_QUOTA=2147483648     # 2 GB
TRANSLATION_FIXED_QUOTA=50000

# === Docker 镜像 ===
READEST_IMAGE=ghcr.io/readest/readest:latest
```

> **生成密钥命令参考** (在 macOS/Linux 终端执行)：
> ```bash
> # 生成随机密码
> openssl rand -base64 32
> # 生成 JWT (需要 jwt-cli 工具)
> # 或访问 https://jwt.io 在线生成
> ```

### 2.3 启动服务

```bash
cd ~/readest/docker

# 拉取并启动所有容器（使用预构建镜像）
docker compose up -d

# 检查状态
docker compose ps

# 验证 MinIO 桶已创建
docker compose logs minio-setup
```

启动后各容器端口：
| 端口 | 服务 | 说明 |
|------|------|------|
| `8000` | Kong API 网关 | Supabase API 入口 |
| `3000` | Next.js 客户端 | Readest 前端 |
| `9000` | MinIO S3 | 对象存储 API |
| `9001` | MinIO 控制台 | S3 管理后台 |

### 2.4 本地构建（可选）

如果不想拉取 ghcr.io 的镜像，可以本地构建：

```bash
cd ~/readest/docker
docker compose -f compose.yaml -f compose.build.yaml up --build -d
```

---

## 3. Nginx 反向代理与 HTTPS

### 3.1 为什么需要 nginx

- **Android Release 构建**会阻断明文 HTTP（详见 §6.1），必须通过 HTTPS 访问
- tp 服务器 80/443 端口已被系统 nginx 占用，正好作为 TLS 终结代理
- 统一入口，内部服务无需直接暴露

### 3.2 nginx 配置示例

在 tp 上创建 `/etc/nginx/sites-available/readest`：

```nginx
# SSL 通用配置（与现有 metacubexd 共用证书）
# 证书路径：/etc/nginx/ssl/your-domain.top/

# Readest HTTP → HTTPS 重定向
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.example.com;
    return 301 https://$host$request_uri;
}

# Readest HTTPS 主站点
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name your-domain.example.com;

    ssl_certificate     /etc/nginx/ssl/your-domain.top/your-domain.crt;
    ssl_certificate_key /etc/nginx/ssl/your-domain.top/your-domain.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    # 增加文件上传大小限制（电子书文件）
    client_max_body_size 100M;

    # Readest 客户端（Next.js SSR）
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3.3 启用站点

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/readest /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重载 nginx
sudo systemctl reload nginx
```

### 3.4 内部服务访问策略

nginx 反向代理到 Docker 容器的内部端口（`127.0.0.1:3000` 等）。
Docker 容器的关键环境变量配置（`docker/.env`）：

```
# 不需要外部暴露 Kong/MinIO 端口
# KONG_HTTP_PORT 可以在 .env 中改为内部端口，以避免暴露
# 如果需要从外部调试，可以在 nginx 中添加对应的 location 块
```

> **重要**：如果你只通过 nginx 访问，可以在 docker compose 中去掉 `kong` 和 `minio` 的 `ports:` 暴露，使它们只在 Docker 内部网络可达。

---

## 4. 客户端构建配置

### 4.1 概念：运行时 vs 构建时

| 部署模式 | 配置注入方式 | URL 来源 |
|----------|-------------|----------|
| **Docker (Web)** | 运行时环境变量 → `window.__READEST_RUNTIME_CONFIG` | `SUPABASE_PUBLIC_URL`, `API_BASE_URL` |
| **Tauri Desktop** | 构建时 `NEXT_PUBLIC_*` 变量（无运行时注入） | `NEXT_PUBLIC_SUPABASE_URL` |
| **Tauri Android** | 构建时 `NEXT_PUBLIC_*` 变量 | `NEXT_PUBLIC_SUPABASE_URL` |

**核心区别**：Docker 运行的是 Next.js 服务器模式（SSR），可以在运行时注入配置。Tauri 构建是静态导出，必须在**构建时**通过环境变量固化 URL。

### 4.2 本地构建 macOS/Windows 客户端

```bash
# 设置自定义服务器地址
export NEXT_PUBLIC_SUPABASE_URL=https://your-domain.example.com
export NEXT_PUBLIC_SUPABASE_ANON_KEY=<你的 ANON_KEY>
export NEXT_PUBLIC_APP_PLATFORM=tauri
export NEXT_PUBLIC_API_BASE_URL=https://your-domain.example.com

# 构建 Tauri 桌面客户端
pnpm tauri build

# 产物位置（macOS）
# apps/readest-app/src-tauri/target/release/bundle/macos/Readest.app
# apps/readest-app/src-tauri/target/release/bundle/dmg/Readest_*.dmg

# 产物位置（Windows）
# apps/readest-app/src-tauri/target/release/bundle/msi/Readest_*.msi
# apps/readest-app/src-tauri/target/release/bundle/nsis/Readest_*.exe
```

对于 Android 本地调试：

```bash
# 设置环境变量（同上）
export NEXT_PUBLIC_SUPABASE_URL=https://your-domain.example.com
export NEXT_PUBLIC_SUPABASE_ANON_KEY=<你的 ANON_KEY>
export NEXT_PUBLIC_APP_PLATFORM=tauri
export NEXT_PUBLIC_API_BASE_URL=https://your-domain.example.com

# 初始化 Android（首次或重新生成配置时需要）
pnpm tauri android init

# 连接设备并运行
pnpm tauri android dev

# 构建 Release APK/AAB
pnpm tauri android build
```

### 4.3 构建时 URL 解析链路

```
Tauri 客户端构建时：
  NEXT_PUBLIC_SUPABASE_URL → process.env 编译时内联
                            → supabase.ts 中读取为 supabaseUrl
                            → createBrowserClient(supabaseUrl, supabaseAnonKey)

Docker 运行时：
  容器 env SUPABASE_PUBLIC_URL → getServerRuntimeConfig()
                               → window.__READEST_RUNTIME_CONFIG.supabaseUrl
                               → supabase.ts getRuntimeConfig()?.supabaseUrl
                               → createBrowserClient(supabaseUrl, supabaseAnonKey)
```

---

## 5. GitHub Actions Android 构建

### 5.1 标准 Workflow 修改

从原有 `.github/workflows/release.yml` 出发，为自定义服务器添加一个 workflow 文件。

创建 `.github/workflows/build-android-selfhosted.yml`：

```yaml
name: Build Android (Self-Hosted)

on:
  workflow_dispatch:   # 手动触发
  push:
    branches: [main]
    paths:
      - 'apps/readest-app/**'
      - '.github/workflows/build-android-selfhosted.yml'

# 请将以下 Actions secrets 添加到 GitHub 仓库：
# ANON_KEY: 你的 ANON_KEY (HS256 JWT)
# SUPABASE_URL: https://your-domain.example.com
# API_BASE_URL: https://your-domain.example.com

env:
  NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.ANON_KEY }}
  NEXT_PUBLIC_APP_PLATFORM: tauri
  NEXT_PUBLIC_API_BASE_URL: ${{ secrets.API_BASE_URL }}

jobs:
  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: latest

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi,x86_64-linux-android,i686-linux-android

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
        with:
          api-level: 34
          ndk-version: '28.2.12483966'

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build Tauri Android
        run: pnpm tauri android build
        working-directory: apps/readest-app

      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: readest-android-apk
          path: apps/readest-app/src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk

      - name: Upload AAB
        uses: actions/upload-artifact@v4
        with:
          name: readest-android-aab
          path: apps/readest-app/src-tauri/gen/android/app/build/outputs/bundle/release/*.aab
```

### 5.2 所需 GitHub Actions Secrets

在 GitHub 仓库的 Settings → Secrets and variables → Actions 中添加：

| Secret | 值 | 用途 |
|--------|-----|------|
| `SUPABASE_URL` | `https://your-domain.example.com` | 传递给构建时的 `NEXT_PUBLIC_SUPABASE_URL` |
| `ANON_KEY` | 你生成的 ANON_KEY JWT | Supabase 匿名密钥 |
| `API_BASE_URL` | `https://your-domain.example.com` | API 基础 URL |

### 5.3 关键构建参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | **必须** | Kong API 网关地址。Android 客户端将直接向此地址发请求 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **必须** | Supabase 匿名 API 密钥 |
| `NEXT_PUBLIC_APP_PLATFORM` | 推荐 `tauri` | 影响少数平台相关逻辑 |
| `NEXT_PUBLIC_API_BASE_URL` | 可选 | 等于 `SUPABASE_URL` 时可不设（会 fallback） |

---

## 6. 配置变更清单

以下是在本仓库中需要修改的文件。

### 6.1 Android 网络安全策略 (重要)

**问题**：Release 构建 `usesCleartextTraffic=false`，会阻断 HTTP 明文连接。

**方案 A — 使用 HTTPS（推荐）**：通过 nginx 提供 HTTPS（详见第 3 节），无需修改代码。

**方案 B — 允许特定域名明文 HTTP（选读）**：如果你的场景需要使用 HTTP（如仅局域网访问）：

创建 `apps/readest-app/src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">your-domain.example.com</domain>
        <!-- 局域网调试 -->
        <domain includeSubdomains="true">192.168.166.52</domain>
    </domain-config>
</network-security-config>
```

修改 `apps/readest-app/src-tauri/gen/android/app/src/main/AndroidManifest.xml`，在 `<application>` 标签中增加：

```xml
<application
    ...
    android:networkSecurityConfig="@xml/network_security_config"
    ...>
```

### 6.2 CORS Middleware (可选，Web 端)

`apps/readest-app/src/middleware.ts` 中的 `allowedOrigins` 是硬编码列表。如果你通过自部署域名访问 Web 端，需要添加：

```typescript
const allowedOrigins = [
  'https://web.readest.com',
  'https://tauri.localhost',
  'http://tauri.localhost',
  'http://localhost:3000',
  'http://localhost:3001',
  'tauri://localhost',
  // 添加自部署域名
  'https://your-domain.example.com',
  'https://*.your-domain.example.com',
];
```

> 注：CORS 仅在 API 路由（`/api/*`）上起作用。Supabase 请求直接发给 Kong（端口 8000），不经过 Next.js CORS。只有 Readest 自身的 API handler 需要这个配置。对于仅使用 Tauri 客户端的场景，可以不修改此项。

### 6.3 Docker Compose 端口冲突

tp 服务器 80/443 已被 nginx 使用。Docker 容器无需直接暴露这些端口：

```
docker/.env 中：
KONG_HTTP_PORT=8000    # 仅容器内部使用，不直接暴露
```

nginx 反向代理到 `127.0.0.1:3000`（client）和 `127.0.0.1:8000`（Kong）。

> 如果后续需要暴露其他端口，请确保不与其他服务冲突。

---

## 7. 验证与排错

### 7.1 部署后验证流程

```bash
# 检查容器健康
ssh tp
cd ~/readest/docker
docker compose ps

# 验证 nginx 配置
sudo nginx -t
sudo systemctl status nginx

# 测试 HTTPS 连接
curl -I https://your-domain.example.com

# 查看日志
docker compose logs -f --tail=50 client
docker compose logs -f --tail=50 kong
docker compose logs -f --tail=50 rest
docker compose logs -f --tail=50 db
```

### 7.2 客户端连接测试

```bash
# 测试 Kong API 网关
curl https://your-domain.example.com/auth/v1/health
# 应返回 200

curl -H "apikey: $ANON_KEY" \
     https://your-domain.example.com/rest/v1/
# 应返回 Supabase REST API 信息
```

### 7.3 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| Android 客户端无法连接 | Release 构建阻断 HTTP | 使用 HTTPS 或配置 `network_security_config.xml` |
| Web 端 CORS 错误 | `allowedOrigins` 硬编码 | 在 `middleware.ts` 添加自部署域名 |
| Docker 容器日志显示连接拒绝 | 容器启动顺序问题 | `docker compose up -d` 会自动处理依赖 |
| nginx 502 Bad Gateway | Docker 容器尚未就绪 | 等待容器启动或检查 `docker compose ps` |
| IPv6 无法访问 | AAAA 记录未配置 | 检查 DNS 记录和防火墙允许 IPv6 |
| 构建时 `NEXT_PUBLIC_SUPABASE_URL` 未生效 | 环境变量未传递到构建进程 | 确保 `export` 了变量或通过 GitHub Secrets 传递 |

---

## 附录

### A. tp 服务器硬件摘要

| 项目 | 值 |
|------|------|
| 主机名 | `xian` |
| CPU | Intel i5-3210M |
| 内存 | 7.6 GB (可用约 6 GB) |
| 磁盘 | 98 GB (已用 12 GB, 可用 82 GB) |
| 系统 | Ubuntu 24.04, Kernel 6.8.0-136 |
| Docker | 29.6.0 |
| SSH 端口 | 2026 |
| IPv4 | 192.168.166.52 |
| IPv6 | 240e:47e:3269:dbc:6af7:28ff:fe32:98e3 |
| 防火墙 | 无 (ufw 未安装，iptables 规则全开) |

### B. 相关文件参考

| 文件 | 用途 |
|------|------|
| `docker/.env.example` | 环境变量模板 |
| `docker/compose.yaml` | 完整服务编排 |
| `docker/compose.build.yaml` | 本地构建覆盖 |
| `docker/volumes/api/kong.yml` | Kong API 网关路由 |
| `docker/volumes/db/roles.sql` | 数据库用户密码 |
| `docker/volumes/db/init/schema.sql` | 数据库初始化 schema |
| `apps/readest-app/src/utils/supabase.ts` | Supabase 客户端初始化 |
| `apps/readest-app/src/services/runtimeConfig.ts` | 运行时配置注入机制 |
| `apps/readest-app/src/services/environment.ts` | API base URL 解析 |
| `apps/readest-app/src/middleware.ts` | CORS 中间件 |
| `apps/readest-app/src-tauri/tauri.conf.json` | Tauri CSP 配置 |
| `apps/readest-app/src-tauri/gen/android/app/src/main/AndroidManifest.xml` | Android 清单 |
