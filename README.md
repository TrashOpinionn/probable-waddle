---
title: 1chan Campus Anonymous Forum
emoji: 💬
colorFrom: indigo
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# 1chan · 校园匿名论坛（Hugging Face Spaces 免费部署版）

一个 4chan 风格、现代响应式界面的校园匿名论坛。
本项目使用 **Hugging Face Spaces（Docker SDK，免费 CPU 实例）** 运行 Node 服务，
数据库使用 **Supabase / Neon PostgreSQL**，图片使用 **Cloudinary / Supabase Storage**。

> 核心原理：
> Hugging Face Space 只负责运行 Docker 容器；
> 帖子和点赞存在外部 PostgreSQL；
> 图片存在对象存储。
> 因此 Space 休眠、重启或重新构建时，帖子和图片都不会丢失。

Space 会自动提供 `https://用户名-空间名.hf.space` 免费地址和 HTTPS，不需要购买域名。

---

## 1. 功能一览

- 全员匿名，无需注册登录
- 默认 5 个分区：综合、学业、生活、吐槽、二手
- 发主题、回复，支持 JPG / PNG / GIF / WEBP 图片
- 每条帖子和回复都可以点赞：同一访客只能点一次，数字实时更新，高赞回复排到前面
- 每条帖子都有分享按钮，生成 `post.html?id=xxx` 链接，其他人打开即可看到该帖
- 高赞帖延长保留：达到点赞阈值的帖子额外保留 15 天
- 隐藏管理后台：路径可配置、密码来自环境变量、防暴力破解
- 管理员可删除帖子、置顶、发管理员帖、改首页标题说明、增删改分区、上传论坛封面
- 每月 1 号清理发布超过 30 天的帖子、回复和图片
- 电脑与手机自适应

---

## 2. 技术架构

```text
                       ┌──────────────────────────────┐
   浏览器 ───────────▶ │  Hugging Face Space（Docker） │
                       │  Node.js + Express            │
                       │  监听 0.0.0.0:7860            │
                       └───────────┬──────────────────┘
                                   │
                   ┌───────────────┴────────────────┐
                   ▼                                ▼
        ┌──────────────────────┐          ┌──────────────────────┐
        │ PostgreSQL           │          │ 对象存储              │
        │ Supabase / Neon      │          │ Cloudinary /          │
        │ 帖子、回复、点赞      │          │ Supabase Storage      │
        └──────────────────────┘          └──────────────────────┘
```

Space 的本地文件系统是临时的，因此本项目在 Hugging Face 环境下会强制要求：

- 配置 `DATABASE_URL`（PostgreSQL）
- 配置 `STORAGE_DRIVER=cloudinary` 或 `supabase`

否则容器会拒绝启动，避免把数据写进临时磁盘后丢失。

---

## 3. 本地开发（不需要 Space / 云账号）

本地开发仍然可以使用 SQLite + 本地图片：

```bash
cd 1chan
npm install
cp .env.example .env      # Windows: copy .env.example .env

# 至少修改 .env 中的 ADMIN_PASSWORD、SESSION_SECRET
npm start
```

访问：

- 前台：<http://localhost:3000/>
- 后台：`http://localhost:3000/sch-admin-2026/`
- 当前模式：<http://localhost:3000/api/meta>

本地模式返回：

```json
{
  "database": "sqlite",
  "storage": "local",
  "maxUploadMb": 5
}
```

Space 上配置云服务后会变成：

```json
{
  "database": "postgres",
  "storage": "cloudinary",
  "maxUploadMb": 5
}
```

---

## 4. 创建免费 PostgreSQL（Supabase 推荐）

### 4.1 注册并创建项目

1. 打开 <https://supabase.com/>；
2. 使用 GitHub 或邮箱注册；
3. 点击 **New project**：
   - Name：例如 `1chan-forum`
   - Database Password：设置强密码并保存
   - Region：选择离你较近的区域（例如 Singapore）
4. 等待 1–2 分钟初始化完成。

### 4.2 获取连接串

1. 进入项目 → **Project Settings** → **Database**；
2. 找到 **Connection string**；
3. 推荐选择 **Session pooler**；
4. 复制连接串，把密码替换成真实密码：

```text
postgresql://postgres.xxxxxxxx:你的密码@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

这个值就是 Hugging Face Space 的 Secret：`DATABASE_URL`。

### 4.3 Neon（可选替代）

也可以使用 <https://neon.tech/> 的免费 PostgreSQL：

1. 注册并创建 Project；
2. 复制 Connection string；
3. 填入 `DATABASE_URL`；
4. 远程数据库保持 `PGSSL=true`。

---

## 5. 创建免费图片存储

### 5.1 方案 A：Cloudinary（推荐）

1. 打开 <https://cloudinary.com/>；
2. 注册免费账号；
3. 进入 **Dashboard**；
4. 复制 **Product Environment Credentials**：
   - Cloud name
   - API Key
   - API Secret

Space 中配置：

```env
STORAGE_DRIVER=cloudinary
CLOUDINARY_CLOUD_NAME=你的 cloud name
CLOUDINARY_API_KEY=你的 api key
CLOUDINARY_API_SECRET=你的 api secret
```

程序会自动使用 `posts/`、`replies/`、`admin/`、`cover/` 文件夹。

### 5.2 方案 B：Supabase Storage

1. Supabase → **Storage** → **New bucket**；
2. Bucket 名称：`1chan`；
3. 勾选 **Public bucket**；
4. 在 **Project Settings → API** 获取 Project URL 和 `service_role` key。

Space 中配置：

```env
STORAGE_DRIVER=supabase
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的 service_role key
SUPABASE_STORAGE_BUCKET=1chan
```

`service_role` key 权限很高，只能放在 Space Secret 中。

---

## 6. 全部环境变量

在 Hugging Face Space 页面：

**Settings → Variables and secrets**

- 普通配置可以放 **Variables**；
- 密码、连接串、API Secret 建议放 **Secrets**。

### 6.1 必填

| 变量 | 说明 |
| --- | --- |
| `ADMIN_PATH` | 隐藏后台路径，例如 `/sch-admin-2026` |
| `ADMIN_PASSWORD` | 管理员密码 |
| `SESSION_SECRET` | 管理员 Cookie 签名密钥，建议 32 位随机字符串 |
| `DATABASE_URL` | Supabase / Neon PostgreSQL 连接串 |
| `STORAGE_DRIVER` | `cloudinary` 或 `supabase` |
| `CLOUDINARY_CLOUD_NAME` | 使用 Cloudinary 时必填 |
| `CLOUDINARY_API_KEY` | 使用 Cloudinary 时必填 |
| `CLOUDINARY_API_SECRET` | 使用 Cloudinary 时必填 |
| `SUPABASE_URL` | 使用 Supabase Storage 时必填 |
| `SUPABASE_SERVICE_ROLE_KEY` | 使用 Supabase Storage 时必填 |
| `SUPABASE_STORAGE_BUCKET` | 使用 Supabase Storage 时填 `1chan` |
| `CRON_SECRET` | 外部定时清理接口的密钥 |

### 6.2 可选

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `7860` | Dockerfile 已设置为 7860，通常不用改 |
| `PGSSL` | `true` | 远程 PostgreSQL 保持 true |
| `POST_RETENTION_DAYS` | `30` | 普通帖子保留天数 |
| `CLEANUP_SCHEDULE` | `0 3 1 * *` | 容器常驻时的清理 cron |
| `HOT_POST_LIKE_THRESHOLD` | `5` | 达到多少赞算高赞帖，0 表示关闭延时 |
| `HOT_POST_EXTRA_DAYS` | `15` | 高赞帖额外保留天数 |
| `MAX_UPLOAD_MB` | `5` | 图片大小上限 |
| `COVER_MAX_MB` | `2` | 论坛封面上限 |
| `POST_COOLDOWN_SECONDS` | `10` | 发帖冷却，0 表示关闭 |
| `ANON_SALT` | 随机 | 匿名 ID 哈希盐 |

> Hugging Face 会自动注入 `SPACE_ID` 等环境变量；代码会识别到这是 Space 环境，
> 强制要求 `DATABASE_URL` 和云存储配置。

---

## 7. 创建 Hugging Face Space

### 7.1 注册账号

1. 打开 <https://huggingface.co/>；
2. 使用邮箱或 GitHub 注册；
3. 免费账号即可创建 CPU 基础版 Space。

### 7.2 新建 Space

1. 点击头像 → **New Space**；
2. 填写：
   - Owner：你的用户名
   - Space name：例如 `1chan-forum`
   - License：MIT
   - **Select the Space SDK**：选择 **Docker**
   - Docker template：选择 **Blank**
   - Space hardware：**CPU basic · 2 vCPU · 16 GB · FREE**
   - Visibility：Public（免费版通常只能公开）
3. 点击 **Create Space**。

### 7.3 上传项目文件

推荐使用 Git 推送。

先在 Hugging Face：

1. 头像 → **Settings** → **Access Tokens**；
2. 新建一个 **Write** 权限 token；
3. 保存 token。

在本地项目目录：

```bash
git remote add hf https://huggingface.co/spaces/你的用户名/你的空间名
git push hf main
```

如果提示输入账号密码：

- 用户名：你的 Hugging Face 用户名；
- 密码：刚才创建的 Access Token（不是登录密码）。

也可以使用网页上传：

1. 进入 Space → **Files** → **Add file** → **Upload files**；
2. 上传整个项目（必须包含 `Dockerfile`、`README.md`、`package.json`、`src/`、`public/`、`private/`、`server.js`）；
3. 不要上传 `.env`、`node_modules`、`data/` 里的数据文件。

### 7.4 Dockerfile 说明

项目根目录已有 `Dockerfile`：

```dockerfile
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7860
ENV HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund
COPY . .
RUN mkdir -p /app/uploads /app/data
EXPOSE 7860
CMD ["node", "server.js"]
```

说明：

- Hugging Face Docker Space 默认访问 7860 端口，`app_port: 7860` 已写在 README 顶部；
- `--omit=optional` 跳过本地开发用的 `better-sqlite3`，Space 上使用 PostgreSQL；
- 容器启动命令是 `node server.js`，它是一个常驻 Node 进程，`node-cron` 可以正常使用。

---

## 8. 配置 Space 环境变量

进入 Space 页面 → **Settings** → **Variables and secrets**，添加：

必需的 Secrets：

```env
ADMIN_PASSWORD=你的管理密码
SESSION_SECRET=随机字符串
DATABASE_URL=Supabase Session pooler 连接串
CLOUDINARY_API_SECRET=你的 Cloudinary secret
CRON_SECRET=随机字符串
```

必需的 Variables：

```env
ADMIN_PATH=/sch-admin-2026
PGSSL=true
STORAGE_DRIVER=cloudinary
CLOUDINARY_CLOUD_NAME=你的 cloud name
CLOUDINARY_API_KEY=你的 api key
```

如果使用 Supabase Storage：

```env
STORAGE_DRIVER=supabase
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的 service_role key
SUPABASE_STORAGE_BUCKET=1chan
```

保存后 Space 会自动重启。

---

## 9. 访问与验证

Space 页面地址：

```text
https://huggingface.co/spaces/你的用户名/你的空间名
```

直接访问应用（推荐用于后台和点赞）：

```text
https://你的用户名-你的空间名.hf.space
```

后台：

```text
https://你的用户名-你的空间名.hf.space/sch-admin-2026/
```

检查运行模式：

```text
https://你的用户名-你的空间名.hf.space/api/meta
```

必须看到：

```json
{
  "database": "postgres",
  "storage": "cloudinary"
}
```

如果显示 `sqlite` 或 `local`，说明 Secrets / Variables 没配置成功。

> 建议使用 `*.hf.space` 直接地址登录后台和点赞。
> Hugging Face 页面会把应用放在 iframe 中，浏览器第三方 Cookie 策略可能影响登录状态和点赞去重。

---

## 10. 数据持久化说明

配置完成后：

| 场景 | 数据是否丢失 | 原因 |
| --- | --- | --- |
| Space 休眠后唤醒 | 不丢 | 数据在外部 PostgreSQL / 对象存储 |
| Space 重启 | 不丢 | 同上 |
| Space 重新构建 | 不丢 | 只重建容器，不删除外部数据 |
| Space 被回收重建 | 不丢 | 同上 |
| 本地 SQLite 文件被删 | 会丢 | 本地开发模式没有外部持久化 |

需要特别说明：

- 管理员登录会话使用签名 Cookie，重启后仍可用（只要 `SESSION_SECRET` 不变）；
- 登录失败次数记录在 PostgreSQL 中，跨重启有效；
- 发帖冷却状态在内存中，重启后清零；
- `better-sqlite3` 在 Space 上不安装，只使用 PostgreSQL。

---

## 11. 自动清理与高赞延时

清理规则：

- 普通帖子：发布超过 `POST_RETENTION_DAYS`（默认 30 天）后清理；
- 高赞帖子：点赞数达到 `HOT_POST_LIKE_THRESHOLD`（默认 5）后，
  额外保留 `HOT_POST_EXTRA_DAYS`（默认 15）天，最多约 45 天；
- 删除范围包括 PostgreSQL 记录、回复、点赞和对应的云端图片。

Space 常驻时，`node-cron` 会按 `CLEANUP_SCHEDULE` 执行；
Space 休眠时不会执行，但容器下次启动会补扫一次。

如果需要严格每月执行，建议使用免费的 [cron-job.org](https://cron-job.org/)：

1. 新建任务；
2. URL 填写：

```text
https://你的用户名-你的空间名.hf.space/api/cron/cleanup?key=你的CRON_SECRET
```

3. 计划设置为每月 1 号执行一次。

手动测试清理：

```text
https://你的用户名-你的空间名.hf.space/api/cron/cleanup?key=你的CRON_SECRET&force=1
```

---

## 12. 验证点赞与分享

### 12.1 点赞

1. 打开一个主题，楼主和回复都应显示「赞」按钮；
2. 浏览器 1 点赞回复 A：数字变成 1，按钮变「已赞」；
3. 浏览器 1 再点 A：按钮已禁用，数字不增加；
4. 用无痕窗口（浏览器 2）点赞 A 和 B；
5. B 的点赞数更高时，B 会排到前面；
6. 点赞楼主（主题帖），数字同样保存到 PostgreSQL；
7. 刷新页面，点赞数和排序保持。

### 12.2 分享

1. 每条帖子都有「分享」按钮；
2. 手机点击会调用系统分享菜单；
3. 桌面点击会复制链接，例如：

```text
https://你的用户名-你的空间名.hf.space/post.html?id=123
```

4. 其他人打开后会看到这条单独的帖子，以及「查看完整主题」按钮；
5. 从主题页打开带锚点的链接会自动滚动并高亮目标帖子。

---

## 13. 验证管理员功能

1. 访问：

```text
https://你的用户名-你的空间名.hf.space/sch-admin-2026/
```

2. 连续输错 5 次密码会被锁定 15 分钟，并且只提示「密码错误」；
3. 正确登录后可以：
   - 修改首页标题和说明；
   - 上传 / 更换 / 移除 JPG/PNG 封面（≤2MB）；
   - 增删改分区；
   - 发布带「管理员」标识的帖子并置顶；
   - 删除任意帖子、回复，云端图片同步删除；
   - 查看分区、主题、回复、点赞统计；
4. 在 Space 重新构建后重新登录，数据仍然存在。

---

## 14. 注意事项与免费额度

### 14.1 Hugging Face Space

- 免费 CPU basic 实例可以长期使用；
- 免费 Space 通常在 48 小时无访问后进入休眠，首次访问需要唤醒，可能需要几十秒；
- 休眠期间 node-cron 不执行，但启动后会补扫清理；
- Space 的本地文件系统是临时的，本项目的持久化依赖外部数据库和对象存储；
- 免费 Space 默认是 Public，帖子内容本身也是公开的。

### 14.2 Supabase / Neon

- 免费额度以官网为准；
- Supabase 免费项目长期无请求可能暂停，需要 Dashboard 手动恢复；
- 建议使用 Session pooler 连接串；
- 删除项目会导致数据丢失。

### 14.3 Cloudinary / Supabase Storage

- 免费额度以官网为准；
- 删除帖子时程序会同步删除云端图片；
- Supabase Storage 必须使用 Public bucket；
- `SERVICE_ROLE_KEY` 只能放在 Space Secret 中。

### 14.4 Cookie 与 iframe

Hugging Face 页面把应用放在 iframe 中，浏览器可能限制第三方 Cookie。
建议把 `*.hf.space` 直接地址发给用户，后台也从直接地址登录。

---

## 15. 常见问题

**Q1：Space 构建失败？**

- 确认仓库根目录有 `Dockerfile` 和带 YAML 头部的 `README.md`；
- 确认 README 头部有 `sdk: docker` 和 `app_port: 7860`；
- 查看 Space 的 **Build logs**。

**Q2：容器启动后马上退出？**

- 查看 Space **Logs**；
- 常见原因是缺少 `DATABASE_URL`、`SESSION_SECRET` 或云存储配置；
- 代码在 Space 环境下会强制检查数据库和云存储配置。

**Q3：访问 404 或端口错误？**

- Dockerfile 必须监听 `0.0.0.0:7860`；
- README 顶部必须有 `app_port: 7860`；
- 本项目已配置好，不要改成 3000。

**Q4：图片上传成功但重启后 404？**

- 检查 `/api/meta` 是否显示 `storage: cloudinary` 或 `supabase`；
- `local` 表示图片在临时磁盘，重启会丢。

**Q5：帖子重启后消失？**

- 检查 `/api/meta` 是否显示 `database: postgres`；
- `sqlite` 表示数据在临时磁盘。

**Q6：Supabase 连接失败？**

- 使用 Session pooler 连接串；
- `PGSSL=true`；
- 检查 Supabase 项目是否被暂停。

**Q7：Cron 没有执行？**

- Space 休眠时不会执行；
- 建议用 cron-job.org 调用 `/api/cron/cleanup?key=CRON_SECRET`；
- `CRON_SECRET` 必须配置。

**Q8：本地还能运行吗？**

可以。不设置 `DATABASE_URL`、使用 `STORAGE_DRIVER=local` 时自动使用 SQLite + 本地图片。

---

## 16. 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/meta` | 数据库模式、图片存储模式、限制配置 |
| GET | `/api/home` | 首页标题、说明、封面、分区列表 |
| GET | `/api/boards/:code` | 分区主题列表 |
| GET | `/api/threads/:id` | 主题详情与按点赞排序的回复 |
| GET | `/api/posts/:id` | 单条帖子（分享页） |
| POST | `/api/boards/:code/threads` | 发主题（multipart，可带 image） |
| POST | `/api/threads/:id/replies` | 回复（multipart，可带 image） |
| POST | `/api/posts/:id/like` | 给帖子或回复点赞 |
| GET | `/api/cron/cleanup` | 清理接口（需要 CRON_SECRET） |
| POST | `ADMIN_PATH/api/login` | 管理员登录 |
| GET | `ADMIN_PATH/api/overview` | 后台统计与帖子列表 |
| POST | `ADMIN_PATH/api/cover` | 上传 / 更换封面 |
| DELETE | `ADMIN_PATH/api/cover` | 移除封面 |
| PUT | `ADMIN_PATH/api/settings` | 修改首页标题和说明 |
| POST / PUT / DELETE | `ADMIN_PATH/api/boards...` | 增删改分区 |
| POST / DELETE | `ADMIN_PATH/api/posts...` | 发布管理帖、删除帖子 |
| PUT | `ADMIN_PATH/api/posts/:id/sticky` | 置顶 / 取消置顶 |

---

## 17. 部署确认清单

- [ ] Hugging Face Space 已创建，SDK 选择 Docker
- [ ] README 头部包含 `sdk: docker` 和 `app_port: 7860`
- [ ] `Dockerfile`、`package.json`、`src/`、`public/`、`private/` 已推送
- [ ] Supabase / Neon 已创建，并配置 `DATABASE_URL`
- [ ] Cloudinary 或 Supabase Storage 已配置
- [ ] Space Secrets / Variables 已填写
- [ ] Space 构建成功，容器监听 7860
- [ ] `/api/meta` 显示 `postgres` 与云存储
- [ ] 发帖、回复、点赞、分享正常
- [ ] 上传图片后能在 Cloudinary / Supabase Storage 看到文件
- [ ] 后台登录、删帖、置顶、封面、分区管理正常
- [ ] 重启 / 重新构建 Space 后，帖子与图片仍然存在

全部完成后，本项目就是「Hugging Face 免费运行 + PostgreSQL 持久化 + 对象存储持久化」的可用匿名论坛。
