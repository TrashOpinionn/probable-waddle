# 1chan · 校园匿名论坛（Render 免费 + 数据持久版）

一个 4chan 风格、现代响应式界面的校园匿名论坛。
本项目已经完成架构升级，可以在 **继续使用 Render 免费 Web Service** 的前提下，
把数据库放到 **Supabase / Render PostgreSQL**，把图片放到 **Cloudinary / Supabase Storage**，
从而避免 Render 免费实例重启或重新部署后数据丢失。

> 一句话架构：
> **Render 免费实例只负责运行 Node 程序；帖子和点赞存 PostgreSQL；图片存对象存储。**
>
> 这样即使 Render 实例休眠、重启或重新部署，帖子和图片仍然保留在云端。

---

## 1. 功能与改动概览

### 论坛功能

- 全员匿名，无需注册登录
- 默认 5 个分区：综合、学业、生活、吐槽、二手
- 发主题、回复，支持 JPG / PNG / GIF / WEBP 图片
- 每条回复可点赞：同一访客只能点一次，数字实时更新，高赞回复排到前面
- 图片上传校验真实文件内容，默认单张最大 5MB
- 同一 IP 两次发帖默认间隔 10 秒，避免刷屏
- 隐藏管理后台：路径可配置、密码从环境变量读取、防暴力破解
- 管理员可删除帖子、置顶、发管理员帖、改首页标题说明、增删改分区、上传论坛封面
- 每月 1 号 03:00 清理发布超过 30 天的帖子、回复和图片
- 电脑和手机自适应

### 本次架构改动

| 项目 | 之前 | 现在 |
| --- | --- | --- |
| 数据库 | 本地 SQLite | 有 `DATABASE_URL` 时使用 PostgreSQL（Supabase / Render PG）；没有时回退本地 SQLite |
| 图片 | 本地 `uploads/` | 有云存储配置时使用 Cloudinary / Supabase Storage；没有时回退本地 `uploads/` |
| 图片删除 | 删除本地文件 | 删除帖子时同步删除云存储文件 |
| 代码兼容 | better-sqlite3 同步 API | 统一异步数据访问层，业务 SQL 基本保持不变 |

因此：

- 本地开发不需要任何云账号，仍然可以直接 `npm install && npm start`；
- Render 上只要配置好 `DATABASE_URL` 和对象存储环境变量，数据就会持久保存；
- 即使 Render 免费实例被回收、休眠或重新部署，帖子和图片也不会丢。

---

## 2. 技术栈

| 用途 | 方案 |
| --- | --- |
| 运行时 | Node.js 20+（推荐 22 LTS；`render.yaml` 固定 22.17.0） |
| Web 框架 | Express 4 |
| 数据库 | PostgreSQL（`pg`）/ SQLite（`better-sqlite3`，本地回退） |
| 图片存储 | Cloudinary / Supabase Storage / 本地 `uploads/` |
| 图片上传 | multer（云模式使用内存，本地模式使用磁盘）+ 文件头校验 |
| 定时任务 | node-cron |
| 配置 | dotenv（`.env`） |
| 前端 | 原生 HTML + CSS + JavaScript |
| 免费部署 | Render Free Web Service + `onrender.com` 免费子域名 |

---

## 3. 免费 + 持久 的原理

Render 免费 Web Service 的文件系统是临时的，所以不能把 SQLite 和图片放在实例本地。
本项目的做法是把它们外置：

```text
                    ┌─────────────────────────────┐
                    │  Render Free Web Service    │
   浏览器  ───────▶ │  Node.js + Express 应用      │
                    └───────────┬─────────────────┘
                                │
                ┌───────────────┴────────────────┐
                ▼                                ▼
      ┌──────────────────┐            ┌────────────────────┐
      │ PostgreSQL       │            │ 对象存储            │
      │ Supabase / Render│            │ Cloudinary /        │
      │ 帖子、回复、点赞  │            │ Supabase Storage    │
      └──────────────────┘            └────────────────────┘
```

- Render 实例重启：数据库和图片都在外部，帖子、点赞、图片不受影响；
- Render 重新部署：同理，数据仍在 Supabase / Cloudinary；
- Render 免费实例休眠：唤醒后继续读写同一份云端数据；
- 只有管理员登录会话、发帖冷却、登录失败锁定状态保存在内存中，重启后会清空，这是正常现象。

---

## 4. 本地开发：不用云账号也能跑

项目保留完整的本地回退模式：

- 不设置 `DATABASE_URL` → 自动使用本地 SQLite（`data/forum.db`）
- `STORAGE_DRIVER=local`（默认）→ 图片保存到本地 `uploads/`

### 4.1 安装依赖并启动

```bash
cd 1chan
npm install
cp .env.example .env      # Windows: copy .env.example .env

# 至少修改 .env 中的 ADMIN_PASSWORD
npm start
```

访问：

- 前台：<http://localhost:3000/>
- 后台：`http://localhost:3000/sch-admin-2026/`

### 4.2 本地验证数据库/存储模式

打开 <http://localhost:3000/api/meta>，会看到类似：

```json
{
  "ok": true,
  "database": "sqlite",
  "storage": "local",
  "maxUploadMb": 5,
  "postCooldownSeconds": 10,
  "retentionDays": 30
}
```

配置云服务后，`database` 会变成 `postgres`，`storage` 会变成 `cloudinary` 或 `supabase`。

---

## 5. 注册 Supabase 并创建免费数据库

Supabase 免费版提供 PostgreSQL 数据库和 Storage 对象存储，适合小型校园论坛。

### 5.1 注册

1. 打开 <https://supabase.com/>；
2. 使用 GitHub 或邮箱注册；
3. 新建一个 Project：
   - Name：例如 `1chan-forum`
   - Database Password：设置一个强密码并保存
   - Region：选择离你或 Render 较近的区域（例如 Singapore）
4. 等待 1–2 分钟初始化完成。

### 5.2 获取 PostgreSQL 连接串

1. 进入项目 → **Project Settings** → **Database**；
2. 找到 **Connection string**；
3. 推荐选择 **Session pooler**（适合 Render 这类长期运行的 Node 服务，支持事务）；
4. 复制形如下面的连接串：

```text
postgresql://postgres.xxxxxxxx:你的数据库密码@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

5. 把 `[YOUR-PASSWORD]` 替换成创建项目时设置的数据库密码；
6. 这个值就是 `DATABASE_URL`。

> 也可以用 **Transaction pooler**（6543 端口），但本项目包含事务清理逻辑，
> 更推荐 **Session pooler**。
> 远程数据库需要 SSL，保持 `PGSSL=true` 即可。

### 5.3 可选：创建 Supabase Storage 桶（用 Supabase 存图片时）

如果打算用 Supabase Storage 而不是 Cloudinary：

1. Supabase 左侧 → **Storage** → **New bucket**；
2. Bucket 名称填 `1chan`（或你自己喜欢的名字）；
3. 勾选 **Public bucket**，这样图片可以通过公开 URL 访问；
4. 然后在 `.env` / Render 环境变量中设置：

```env
STORAGE_DRIVER=supabase
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的 service_role key
SUPABASE_STORAGE_BUCKET=1chan
```

`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 在
**Project Settings → API** 中获取。
`service_role` key 权限很高，只能放在服务端环境变量里，绝对不能提交到 GitHub。

---

## 6. 注册 Cloudinary 并创建免费图片存储

Cloudinary 免费额度对小型论坛通常够用，配置也比 Supabase Storage 简单。

### 6.1 注册与获取密钥

1. 打开 <https://cloudinary.com/>；
2. 注册免费账号（Free Plan）；
3. 进入 **Dashboard**；
4. 找到 **Product Environment Credentials**，复制：
   - Cloud name → `CLOUDINARY_CLOUD_NAME`
   - API Key → `CLOUDINARY_API_KEY`
   - API Secret → `CLOUDINARY_API_SECRET`

### 6.2 配置

```env
STORAGE_DRIVER=cloudinary
CLOUDINARY_CLOUD_NAME=你的 cloud name
CLOUDINARY_API_KEY=你的 api key
CLOUDINARY_API_SECRET=你的 api secret
```

程序会自动创建 `posts/`、`replies/`、`admin/`、`cover/` 文件夹。
上传成功后保存的是 Cloudinary 的公开 URL，而不是本地文件名。

---

## 7. 全部环境变量说明

本地创建 `.env`，Render 则在 **Environment** 中逐项填写。

### 7.1 基础

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | 本地默认 3000；Render 会自动注入，不需要设置 |
| `ADMIN_PATH` | 是 | 隐藏管理路径，例如 `/sch-admin-2026` |
| `ADMIN_PASSWORD` | 是 | 管理密码，不要提交到仓库 |
| `ANON_SALT` | 建议 | 生成匿名 ID 的随机盐 |

### 7.2 内容与清理

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `POST_RETENTION_DAYS` | `30` | 超过多少天删除帖子 |
| `CLEANUP_SCHEDULE` | `0 3 1 * *` | 每月 1 号 03:00 清理 |
| `MAX_UPLOAD_MB` | `5` | 帖子图片大小上限 |
| `COVER_MAX_MB` | `2` | 论坛封面大小上限 |
| `POST_COOLDOWN_SECONDS` | `10` | 同一 IP 发帖最短间隔，`0` 表示关闭 |

### 7.3 数据库（PostgreSQL）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 生产必填 | Supabase / Render PostgreSQL 连接串；不填则回退本地 SQLite |
| `SUPABASE_DB_URL` | 可选 | `DATABASE_URL` 的同义变量，二选一 |
| `PGSSL` | 否 | 默认 `true`；远程数据库保持 true，本地 PG 可设 false |

程序会自动建表、创建默认分区、创建点赞表；
如果数据库已有表，会自动补齐新字段，不会覆盖帖子数据。

### 7.4 图片存储

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `STORAGE_DRIVER` | 生产必填 | `cloudinary` 或 `supabase`；不填且没有云密钥时使用 `local` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary 必填 | Cloudinary Cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary 必填 | Cloudinary API Key |
| `CLOUDINARY_API_SECRET` | Cloudinary 必填 | Cloudinary API Secret |
| `SUPABASE_URL` | Supabase 必填 | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 必填 | Supabase service_role key |
| `SUPABASE_STORAGE_BUCKET` | 否 | 默认 `1chan`，必须是 Public bucket |

---

## 8. 部署到 Render 免费版

### 8.1 准备

1. 已按第 5 节创建 Supabase 数据库；
2. 已按第 6 节创建 Cloudinary（或按 5.3 创建 Supabase Storage）；
3. 把代码推送到 GitHub：

```bash
git init
git add .
git commit -m "1chan persistent forum"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库.git
git push -u origin main
```

注意：`.env` 已加入 `.gitignore`，不要把数据库密码或 API Secret 提交到仓库。

### 8.2 方式 A：使用 render.yaml 一键部署（推荐）

仓库根目录已包含 `render.yaml`：

1. 登录 <https://render.com>；
2. 点击 **New +** → **Blueprint**；
3. 选择 GitHub 仓库，Render 会自动识别 `render.yaml`；
4. 按提示填写标记为 `sync: false` 的变量：

   | 变量 | 填写内容 |
   | --- | --- |
   | `ADMIN_PASSWORD` | 你的管理密码 |
   | `DATABASE_URL` | Supabase Session pooler 连接串 |
   | `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
   | `CLOUDINARY_API_KEY` | Cloudinary API key |
   | `CLOUDINARY_API_SECRET` | Cloudinary API secret |

5. 点击 **Apply**，等待构建完成；
6. 打开 Render 分配的免费子域名：

```text
https://你的服务名.onrender.com
```

后台：

```text
https://你的服务名.onrender.com/sch-admin-2026/
```

### 8.3 方式 B：手动创建 Web Service

1. Render → **New +** → **Web Service**；
2. 连接 GitHub 仓库；
3. 填写：

   | 配置 | 值 |
   | --- | --- |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Plan | Free |
   | Health Check Path | `/api/meta` |

4. Environment 中至少添加：

```env
NODE_VERSION=22.17.0
ADMIN_PATH=/sch-admin-2026
ADMIN_PASSWORD=你的管理密码

DATABASE_URL=Supabase Session pooler 连接串
PGSSL=true

STORAGE_DRIVER=cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

POST_RETENTION_DAYS=30
CLEANUP_SCHEDULE=0 3 1 * *
MAX_UPLOAD_MB=5
COVER_MAX_MB=2
POST_COOLDOWN_SECONDS=10
```

5. 点击 **Create Web Service**。

如果使用 Supabase Storage 而不是 Cloudinary，则改为：

```env
STORAGE_DRIVER=supabase
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的 service_role key
SUPABASE_STORAGE_BUCKET=1chan
```

### 8.4 部署后确认

1. 打开 `https://你的服务名.onrender.com/api/meta`，确认：

```json
{
  "database": "postgres",
  "storage": "cloudinary"
}
```

2. 发一条带图片的帖子；
3. 在 Cloudinary Media Library 或 Supabase Storage 中能看到图片；
4. 在 Render Dashboard 点击 **Manual Deploy → Deploy latest commit**（或等待下一次部署）；
5. 部署完成后刷新帖子，**帖子和图片仍然存在**，说明持久化配置成功。

---

## 9. 持久化说明：为什么重启和重新部署不会丢数据

配置完成后：

| 场景 | 数据是否丢失 | 原因 |
| --- | --- | --- |
| Render 免费实例休眠后唤醒 | 不丢 | 数据在外部 PostgreSQL / 对象存储 |
| Render 实例重启 | 不丢 | 同上 |
| Render 重新部署新版本 | 不丢 | Render 只替换代码，不删除外部数据 |
| Render 免费实例被回收 | 不丢 | 同上 |
| 本地 SQLite 文件被删 | 会丢 | 本地开发模式没有外部持久化 |
| Cloudinary / Supabase 账号被删除 | 会丢 | 数据在对应云服务中 |

需要特别说明：

- 管理员登录会话存在内存中，重启后需要重新登录；
- 发帖冷却、登录失败锁定状态也在内存中，重启后清零；
- 定时清理任务依赖 Node 进程运行；Render 免费实例休眠期间不会执行，
  但服务唤醒后会自动执行一次「启动补扫」，保证过期帖子最终被清理。

---

## 10. 自动清理规则

- 执行时间：每月 1 号 03:00（`0 3 1 * *`）
- 删除条件：执行时发布时间超过 30 天的帖子
- 删除范围：
  - PostgreSQL 中的帖子、回复、点赞记录
  - Cloudinary / Supabase Storage 中对应的图片
- 启动补扫：每次服务启动后 500ms 补跑一次
- 日志示例：

```text
[cleanup] 自动清理已启用：0 3 1 * *（删除发布超过 30 天的帖子）
[cleanup] 定时清理开始（删除发布超过 30 天的帖子及图片）
[cleanup] 定时清理完成：帖子 12，图片 8，孤儿文件 0
```

修改保留期或清理周期：

```env
POST_RETENTION_DAYS=30
CLEANUP_SCHEDULE=0 3 1 * *
```

---

## 11. 验证点赞功能

### 11.1 浏览器验证

1. 打开任意主题，发两条回复 A、B；
2. 浏览器 1 点赞 A：数字立即变为 1，按钮变「已赞」；
3. 浏览器 1 再点 A：按钮已禁用，数字不再增加；
4. 用无痕窗口（浏览器 2）点赞 A 和 B；
5. B 的点赞数更高时，B 会自动移动到列表前面；
6. 刷新页面，点赞数和排序保持（说明 PostgreSQL 持久化成功）；
7. 主题帖（楼主）没有点赞按钮，直接请求接口会返回「只有回复可以点赞」。

### 11.2 接口验证

```bash
# 用真实回复 ID 替换 1
curl -X POST https://你的服务名.onrender.com/api/posts/1/like \
  -H "Cookie: forum_vid=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

# 第二次请求 same visitor：likeCount 不变、added=false
curl -X POST https://你的服务名.onrender.com/api/posts/1/like \
  -H "Cookie: forum_vid=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
```

返回示例：

```json
{ "ok": true, "liked": true, "likeCount": 1, "added": true }
```

---

## 12. 验证管理员功能

1. 首页不显示任何后台入口；
2. 访问 `https://你的服务名.onrender.com/sch-admin-2026/`；
3. 连续输错密码 5 次会被锁定 15 分钟，且只提示「密码错误」；
4. 正确登录后检查：
   - 统计卡片显示分区、主题、回复、点赞数量；
   - 顶部提示显示当前数据库与图片存储模式（应为 `postgres` + `cloudinary/supabase`）；
   - 修改首页标题和说明，前台立即生效；
   - 上传 JPG/PNG 论坛封面（≤2MB），首页标题上方显示封面；
   - 添加 / 修改 / 删除分区；
   - 发布带「管理员」标识的帖子并置顶；
   - 删除任意回复或主题，云存储中的图片同步删除；
5. 在 Render 重新部署后再次登录后台，帖子、点赞、封面仍然存在。

---

## 13. 注意事项与免费额度

### 13.1 Render 免费实例

- 约 15 分钟无请求后休眠；
- 唤醒需要约 30–60 秒；
- 休眠期间不运行 node-cron，但唤醒后会自动补扫过期帖子；
- 免费子域名形如 `https://<service>.onrender.com`，HTTPS 自动启用；
- 不需要购买域名。

### 13.2 Supabase 免费版

- 免费数据库容量和带宽以 Supabase 官网为准；
- 长期没有任何请求时，免费项目可能被暂停，需要在 Dashboard 手动恢复；
  正常有人使用的论坛通常不会触发；
- 建议使用 Session pooler 连接串；
- 删除数据、暂停或删除项目会丢失数据。

### 13.3 Cloudinary 免费版

- 免费额度以官网为准，小型论坛通常够用；
- 超出免费额度后可能限制上传或产生费用，请留意用量；
- 删除帖子时程序会调用 Cloudinary destroy，避免长期堆积。

### 13.4 Supabase Storage 免费版

- 免费额度以官网为准；
- 必须使用 Public bucket 才能通过公开 URL 访问图片；
- `service_role` key 只能放在服务端环境变量中。

### 13.5 Render PostgreSQL（替代方案）

Render 也提供 PostgreSQL，但免费计划通常有有效期限制（例如 30 天），
到期后数据库可能被删除。若希望长期免费，优先使用 Supabase 免费数据库。
如果使用 Render 同区域的 **Internal Database URL**，通常不需要 SSL，
请把 `PGSSL` 设为 `false`；使用 External URL 或 Supabase 时保持 `true`。

### 13.6 SQLite 本地数据迁移

旧版本使用的 `data/forum.db` **不会自动迁移**到 PostgreSQL。
如果本地有重要数据，可以在本地继续用 SQLite 模式浏览，
或使用数据库工具导出后手动导入 Supabase。
新部署的论坛从空库开始，之后的帖子和图片都会持久保存。

---

## 14. 常见问题

**Q1：Render 重新部署后帖子没了？**

检查 `/api/meta` 返回的 `database` 是否为 `postgres`。
如果仍是 `sqlite`，说明 `DATABASE_URL` 没有配置成功。

**Q2：图片上传成功但重启后 404？**

检查 `/api/meta` 的 `storage` 是否为 `cloudinary` 或 `supabase`。
如果仍是 `local`，说明云存储环境变量不完整。

**Q3：Supabase 连接失败？**

- 使用 Session pooler 连接串；
- 确认密码已替换，密码不要带未转义的特殊字符；
- 保持 `PGSSL=true`；
- 检查 Supabase 项目是否被暂停。

**Q4：Cloudinary 上传失败？**

- 检查 Cloud name / API key / API secret 是否复制正确；
- 确认 `STORAGE_DRIVER=cloudinary`；
- 查看 Render Logs 中的具体错误。

**Q5：Supabase Storage 图片无法访问？**

Bucket 必须是 Public；检查 `SUPABASE_STORAGE_BUCKET` 名称是否一致。

**Q6：管理后台被锁定了？**

等待 15 分钟，或在 Render 重启服务；锁定状态只存在内存中。

**Q7：清理任务没有按时间执行？**

Render 免费实例休眠时不会执行 cron。唤醒后会立即执行一次启动补扫。
如果需要严格定时执行，需要升级实例或使用外部定时服务。

**Q8：本地开发还需要 Supabase / Cloudinary 吗？**

不需要。不配置 `DATABASE_URL`、`STORAGE_DRIVER=local` 时会自动使用 SQLite 和本地 `uploads/`。

---

## 15. 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/meta` | 返回当前数据库模式、图片存储模式、限制配置 |
| GET | `/api/home` | 首页标题、说明、封面、分区列表 |
| GET | `/api/boards/:code` | 分区主题列表 |
| GET | `/api/threads/:id` | 主题详情与按点赞排序的回复 |
| POST | `/api/boards/:code/threads` | 发主题（multipart，可带 image） |
| POST | `/api/threads/:id/replies` | 回复（multipart，可带 image） |
| POST | `/api/posts/:id/like` | 给回复点赞（同一访客只记一次） |
| POST | `ADMIN_PATH/api/login` | 管理员登录 |
| GET | `ADMIN_PATH/api/overview` | 后台统计、分区、最近帖子 |
| POST | `ADMIN_PATH/api/cover` | 上传 / 更换论坛封面 |
| DELETE | `ADMIN_PATH/api/cover` | 移除论坛封面 |
| PUT | `ADMIN_PATH/api/settings` | 修改首页标题和说明 |
| POST / PUT / DELETE | `ADMIN_PATH/api/boards...` | 增删改分区 |
| POST / DELETE | `ADMIN_PATH/api/posts...` | 发布管理帖、删除帖子 |
| PUT | `ADMIN_PATH/api/posts/:id/sticky` | 置顶 / 取消置顶 |

---

## 16. 本地与部署确认

- 本地：不配置云服务也能运行（SQLite + 本地图片）；
- 生产：配置 `DATABASE_URL` + `STORAGE_DRIVER` 后，Render 免费实例重启、
  休眠、重新部署都不会丢帖子和图片；
- 点赞、管理员、清理、封面、图片校验等功能均已在 SQLite 与 PostgreSQL 兼容模式下验证；
- Render 免费子域名无需购买域名，HTTPS 自动生效。
