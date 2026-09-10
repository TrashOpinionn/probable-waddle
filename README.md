# 1chan · 校园匿名论坛（Vercel 免费部署版）

一个 4chan 风格、现代响应式界面的校园匿名论坛。
本项目已完成 Serverless 适配，可以部署在 **Vercel Hobby（免费、通常不需要支付方式）**，
数据库使用 **Supabase / Neon 等免费 PostgreSQL**，图片使用 **Cloudinary / Supabase Storage**。

> 核心原理：
> Vercel 只运行 Node 程序，本身不保存数据；
> 帖子和点赞存 PostgreSQL，图片存对象存储。
> 所以 Vercel 重新部署、冷启动、实例切换都不会丢数据。

Vercel 会自动分配 `https://你的项目.vercel.app` 免费子域名和 HTTPS，无需购买域名。

---

## 1. 功能一览

- 全员匿名，无需注册登录
- 默认 5 个分区：综合、学业、生活、吐槽、二手
- 发主题、回复，支持 JPG / PNG / GIF / WEBP 图片
- 每一条帖子和回复都可以点赞：同一访客只能点一次，数字实时更新，高赞回复排到前面
- 每条帖子都有「分享」按钮，点击生成独立链接，其他人打开即可看到该帖
- 图片上传校验真实文件内容
- 同一 IP 发帖间隔限制，防止刷屏
- 隐藏管理后台：路径可配置、密码来自环境变量、防暴力破解
- 管理员可删除帖子、置顶、发管理员帖、改首页标题说明、增删改分区、上传论坛封面
- 每月 1 号清理发布超过 30 天的帖子、回复和图片（Vercel Cron 每天触发，代码判断月份）
- 电脑与手机自适应

---

## 2. Vercel 版本的技术架构

```text
                       ┌──────────────────────────────┐
   浏览器 ───────────▶ │  Vercel Hobby（免费）         │
                       │  Serverless Function          │
                       │  api/index.js → Express app   │
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

Vercel 免费实例的文件系统是临时的，因此：

- 数据库必须使用外部 PostgreSQL（`DATABASE_URL`）；
- 图片必须使用对象存储（`STORAGE_DRIVER=cloudinary` 或 `supabase`）；
- 不配置这些环境变量时，代码会拒绝在 Vercel 上启动，避免数据静默丢失。

---

## 3. 本地开发（不需要 Vercel / 云账号）

项目保留了本地回退模式：

- 不设置 `DATABASE_URL` → 使用本地 SQLite（`data/forum.db`）
- `STORAGE_DRIVER=local` → 图片保存到本地 `uploads/`

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

本地模式下 `/api/meta` 返回：

```json
{
  "database": "sqlite",
  "storage": "local",
  "maxUploadMb": 5
}
```

部署到 Vercel 后会变成：

```json
{
  "database": "postgres",
  "storage": "cloudinary",
  "maxUploadMb": 4
}
```

---

## 4. 创建免费 PostgreSQL（Supabase 推荐）

Supabase 免费版提供 PostgreSQL 和 Storage，通常不需要支付方式。

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
3. 推荐选择 **Session pooler**（适合 Serverless / 长期 Node 服务，支持事务）；
4. 复制连接串，把密码替换成真实密码：

```text
postgresql://postgres.xxxxxxxx:你的密码@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

这个值就是 Vercel 环境变量 `DATABASE_URL`。

### 4.3 Neon（可选替代）

如果 Supabase 注册不便，也可以使用 <https://neon.tech/> 的免费 PostgreSQL：

1. 注册并创建 Project；
2. 在 Dashboard 复制 Connection string；
3. 同样填入 `DATABASE_URL`；
4. 远程数据库保持 `PGSSL=true`。

---

## 5. 创建免费图片存储

### 5.1 方案 A：Cloudinary（推荐，最简单）

1. 打开 <https://cloudinary.com/>；
2. 注册免费账号；
3. 进入 **Dashboard**；
4. 复制 **Product Environment Credentials**：
   - Cloud name
   - API Key
   - API Secret

Vercel 环境变量：

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
3. 勾选 **Public bucket**（图片需要公开访问）；
4. 在 **Project Settings → API** 获取 Project URL 和 `service_role` key。

Vercel 环境变量：

```env
STORAGE_DRIVER=supabase
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的 service_role key
SUPABASE_STORAGE_BUCKET=1chan
```

`service_role` key 权限很高，只能放在服务端环境变量中。

---

## 6. 全部环境变量

Vercel Dashboard → 你的 Project → **Settings** → **Environment Variables**。

### 6.1 必填

| 变量 | 说明 |
| --- | --- |
| `ADMIN_PATH` | 隐藏后台路径，例如 `/sch-admin-2026` |
| `ADMIN_PASSWORD` | 管理员密码 |
| `SESSION_SECRET` | 管理员无状态会话签名密钥，建议 32 位随机字符串 |
| `DATABASE_URL` | Supabase / Neon PostgreSQL 连接串 |
| `STORAGE_DRIVER` | `cloudinary` 或 `supabase` |
| `CLOUDINARY_CLOUD_NAME` | 使用 Cloudinary 时必填 |
| `CLOUDINARY_API_KEY` | 使用 Cloudinary 时必填 |
| `CLOUDINARY_API_SECRET` | 使用 Cloudinary 时必填 |
| `SUPABASE_URL` | 使用 Supabase Storage 时必填 |
| `SUPABASE_SERVICE_ROLE_KEY` | 使用 Supabase Storage 时必填 |
| `SUPABASE_STORAGE_BUCKET` | 使用 Supabase Storage 时填 `1chan` |
| `CRON_SECRET` | Vercel Cron 调用清理接口的密钥，建议随机字符串 |

### 6.2 可选

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PGSSL` | `true` | 远程 PostgreSQL 保持 true |
| `POST_RETENTION_DAYS` | `30` | 帖子保留天数 |
| `CLEANUP_SCHEDULE` | `0 3 1 * *` | 本地/常驻实例的清理 cron；Vercel 用 vercel.json |
| `MAX_UPLOAD_MB` | `5` | Vercel 会自动收敛到 4MB（平台请求体限制） |
| `COVER_MAX_MB` | `2` | 论坛封面上限 |
| `POST_COOLDOWN_SECONDS` | `10` | 发帖冷却，0 表示关闭 |
| `HOT_POST_LIKE_THRESHOLD` | `5` | 达到多少赞算高赞帖（0 表示关闭延时保留） |
| `HOT_POST_EXTRA_DAYS` | `15` | 高赞帖额外保留天数 |
| `ANON_SALT` | 随机 | 匿名 ID 哈希盐 |

> 注意：Vercel Serverless Function 的请求体上限约 4.5MB，因此图片上限会被自动限制到 4MB。

---

## 7. 部署到 Vercel

### 7.1 准备：推送到 GitHub

```bash
git init
git add .
git commit -m "1chan vercel forum"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库.git
git push -u origin main
```

`.env` 已在 `.gitignore` 中，不要把密钥提交到仓库。

### 7.2 方式 A：Vercel Dashboard 部署（推荐）

1. 打开 <https://vercel.com/>，用 GitHub 注册/登录；
2. 点击 **Add New…** → **Project**；
3. 选择你的 GitHub 仓库，点击 **Import**；
4. 配置：

   | 配置项 | 值 |
   | --- | --- |
   | Framework Preset | Other |
   | Root Directory | 默认（仓库根目录） |
   | Build Command | 留空或 `npm install` |
   | Output Directory | 留空 |
   | Install Command | `npm install` |

5. 展开 **Environment Variables**，添加第 6 节的变量；
6. 点击 **Deploy**，等待构建完成；
7. 得到免费地址：

```text
https://你的项目名.vercel.app
```

后台地址：

```text
https://你的项目名.vercel.app/sch-admin-2026/
```

### 7.3 方式 B：使用 Vercel CLI

```bash
# 安装 CLI（也可以直接用 npx vercel）
npm i -g vercel

# 登录（浏览器授权）
vercel login

# 在项目根目录关联并部署
vercel

# 配置生产环境变量（逐条执行）
vercel env add ADMIN_PATH production
vercel env add ADMIN_PASSWORD production
vercel env add SESSION_SECRET production
vercel env add DATABASE_URL production
vercel env add PGSSL production
vercel env add STORAGE_DRIVER production
vercel env add CLOUDINARY_CLOUD_NAME production
vercel env add CLOUDINARY_API_KEY production
vercel env add CLOUDINARY_API_SECRET production
vercel env add CRON_SECRET production

# 部署到生产环境
vercel --prod
```

### 7.4 vercel.json 说明

仓库根目录的 `vercel.json` 已配置好：

```json
{
  "functions": {
    "api/index.js": {
      "maxDuration": 30,
      "includeFiles": "private/**"
    }
  },
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api" },
    { "source": "/sch-admin-2026", "destination": "/api" },
    { "source": "/sch-admin-2026/:path*", "destination": "/api" }
  ],
  "crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }
  ]
}
```

含义：

- `api/index.js` 导出 Express app，处理所有 API 和后台请求；
- `private/**` 被包含进函数包，后台页面可以正常访问；
- `/api/*` 和 `/sch-admin-2026/*` 重写到 Serverless Function；
- Vercel Cron 每天 03:00 UTC 调用一次清理接口。

> 如果你修改了 `ADMIN_PATH`，必须同步修改 `vercel.json` 里的两条 `/sch-admin-2026` 重写规则。

---

## 8. Vercel Cron 与自动清理

Vercel Hobby 的 Cron 限制：

- 每个项目最多 2 个 Cron；
- 免费版每天最多触发一次；
- 因此本项目使用「每天触发 + 代码判断月份」的方案。

清理接口：`GET /api/cron/cleanup`

执行规则：

1. 校验 `Authorization: Bearer $CRON_SECRET`；
2. 如果 UTC 日期是 1 号，执行清理；
3. 如果距上次清理已超过 32 天，即使不是 1 号也会补做（防止平台漏跑）；
4. 删除超过 `POST_RETENTION_DAYS`（默认 30 天）的帖子、回复、点赞和云端图片；
5. 高赞帖延长保留：点赞数达到 `HOT_POST_LIKE_THRESHOLD`（默认 5）的帖子，
   会额外保留 `HOT_POST_EXTRA_DAYS`（默认 15）天，也就是最多保留 45 天；
   主题内任意一条帖子达到阈值时，该主题整体延后到 45 天再清理。

日志示例：

```text
[cleanup] 定时清理完成：帖子 12，图片 8，孤儿文件 0
[cleanup] Vercel Cron 清理完成：{"removedPosts":12,"removedFiles":8,"orphanFiles":0}
```

手动测试清理（把密钥换成你的 `CRON_SECRET`）：

```bash
curl "https://你的项目.vercel.app/api/cron/cleanup?key=你的CRON_SECRET&force=1"
```

不执行清理时返回：

```json
{
  "ok": true,
  "skipped": true,
  "reason": "未到每月 1 号（UTC），且距上次清理不足 32 天"
}
```

---

## 9. 确认数据持久化

### 9.1 检查运行模式

部署后打开：

```text
https://你的项目.vercel.app/api/meta
```

必须看到：

```json
{
  "database": "postgres",
  "storage": "cloudinary"
}
```

如果显示 `sqlite` 或 `local`，说明环境变量没有配置成功。

### 9.2 验证帖子不丢

1. 在 Vercel 前台发一条带图片的主题；
2. 在 Supabase Table Editor 中能看到 `posts` 表新增记录；
3. 在 Cloudinary Media Library 或 Supabase Storage 中能看到图片；
4. 回到 Vercel → Deployments → 对最新部署点击 **Redeploy**；
5. 重新部署完成后刷新论坛，帖子和图片仍然存在。

这说明：

- Vercel 实例重启/重新部署不会丢帖子（PostgreSQL 保存）；
- 图片不会丢（对象存储保存）；
- 管理员登录、发帖冷却等临时状态会重置，这是正常的。

---

## 10. 验证点赞功能

### 10.1 验证点赞

1. 打开一个主题，主题帖（楼主）和回复都应该显示「赞」按钮；
2. 浏览器 1 点赞回复 A：数字立即变成 1，按钮变「已赞」；
3. 浏览器 1 再点 A：按钮已禁用，数字不增加；
4. 用无痕窗口（浏览器 2）点赞 A 和 B；
5. B 的点赞数更高时，B 会移动到列表前面；
6. 点赞主题帖（楼主），数字同样会更新并保存到 PostgreSQL；
7. 刷新页面，点赞数和排序仍然保持。

### 10.2 验证分享功能

1. 主题页每条帖子（楼主和回复）都有「分享」按钮；
2. 手机浏览器点击「分享」会调用系统分享菜单；
3. 桌面浏览器点击「分享」会把链接复制到剪贴板，并提示「分享链接已复制」；
4. 把链接发给另一个人，或在无痕窗口打开；
5. 链接形如：

```text
https://你的项目.vercel.app/post.html?id=123
```

6. 打开后会单独显示这条帖子，并提供「查看完整主题」按钮；
7. 从主题页带 `#p123` 打开时，会自动滚动并高亮这条帖子。

接口验证：

```bash
curl -X POST https://你的项目.vercel.app/api/posts/1/like \
  -H "Cookie: forum_vid=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
```

```json
{ "ok": true, "liked": true, "likeCount": 1, "added": true }
```

---

## 11. 验证管理员功能

1. 前台首页不显示后台入口；
2. 访问 `https://你的项目.vercel.app/sch-admin-2026/`；
3. 输入错误密码 → 只显示「密码错误」；
4. 连续错误 5 次 → 锁定 15 分钟（记录在 PostgreSQL 中，跨实例生效）；
5. 正确登录后：
   - 顶部显示 `数据库 postgres · 图片 cloudinary`；
   - 修改首页标题和说明；
   - 上传 JPG/PNG 封面（≤2MB）；
   - 添加/修改/删除分区；
   - 发布带「管理员」标识的帖子并置顶；
   - 删除帖子或回复，云端图片同步删除；
6. 在 Vercel 重新部署后重新登录，数据仍然存在。

> 管理员会话使用 HMAC 签名 Cookie（依赖 `SESSION_SECRET`），
> 因此在 Vercel 多实例、冷启动之间都能正常使用。

---

## 12. 注意事项

### 12.1 Vercel Hobby 免费版

- Serverless 函数按请求运行，不保证常驻；
- 冷启动通常几百毫秒到几秒；
- 请求体上限约 4.5MB，所以图片上限自动为 4MB；
- Cron 免费版每天最多一次；
- 函数默认超时较短，`vercel.json` 已设置 `maxDuration: 30`；
- 免费额度以 Vercel 官网为准。

### 12.2 文件系统是临时的

- 不要把 SQLite 或 `uploads/` 当作生产存储；
- 代码在 Vercel 检测到 `STORAGE_DRIVER=local` 或缺少 `DATABASE_URL` 时会直接报错，
  防止数据静默丢失；
- 本地开发不受影响。

### 12.3 Supabase / Neon 免费数据库

- Supabase 免费项目长期无请求可能暂停，需要在 Dashboard 手动恢复；
- 连接串使用 Session pooler；密码包含特殊字符时要 URL 编码；
- 删除项目会丢失全部数据；
- Neon 免费实例会自动缩容，冷启动可能需要几秒。

### 12.4 Cloudinary / Supabase Storage 免费额度

- 免费额度以官网为准；
- 删除帖子时程序会同步删除云端图片；
- Cloudinary 的公开 URL 可直接展示；
- Supabase Storage 必须使用 Public bucket。

### 12.5 管理员路径变更

修改 `ADMIN_PATH` 后，必须同步修改 `vercel.json` 中两条重写规则的路径，
否则新后台地址会被 Vercel 交给静态文件处理并返回 404。

---

## 13. 常见问题

**Q1：部署成功但访问显示 500 / 启动失败？**

查看 Vercel → Deployments → Functions 日志。
常见原因是缺少 `DATABASE_URL`、`SESSION_SECRET` 或云存储密钥。

**Q2：访问后台 404？**

- 确认 `ADMIN_PATH` 与 `vercel.json` 重写规则一致；
- 默认路径是 `/sch-admin-2026`。

**Q3：上传图片返回 413 或失败？**

- Vercel 请求体上限约 4.5MB；
- 本项目在 Vercel 上自动把上限降为 4MB；
- 如需更小，设置 `MAX_UPLOAD_MB=2`。

**Q4：图片上传成功但刷新后 404？**

- 检查 `/api/meta` 是否显示 `storage: cloudinary` 或 `supabase`；
- 如果是 `local`，说明云存储环境变量不完整。

**Q5：帖子在重新部署后消失？**

- 检查 `/api/meta` 是否显示 `database: postgres`；
- 如果还是 `sqlite`，说明 `DATABASE_URL` 未生效。

**Q6：Supabase 连接超时？**

- 使用 Session pooler 连接串；
- `PGSSL=true`；
- 检查 Supabase 项目是否被暂停。

**Q7：Cron 没有执行清理？**

- 确认 Vercel 环境变量中设置了 `CRON_SECRET`；
- Vercel Cron 只在部署到 Production 后生效；
- Hobby 每天最多执行一次；
- 可以手动访问 `?key=CRON_SECRET&force=1` 测试。

**Q8：管理员登录状态丢失？**

- 检查 `SESSION_SECRET` 是否设置且没有变化；
- 修改 `SESSION_SECRET` 会使所有旧登录失效。

**Q9：本地还能直接运行吗？**

可以。不设置 `DATABASE_URL`、使用 `STORAGE_DRIVER=local` 时自动使用 SQLite + 本地图片。

---

## 14. 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/meta` | 数据库模式、图片存储模式、上传限制 |
| GET | `/api/home` | 首页标题、说明、封面、分区列表 |
| GET | `/api/boards/:code` | 分区主题列表 |
| GET | `/api/threads/:id` | 主题详情与按点赞排序的回复 |
| GET | `/api/posts/:id` | 单条帖子（分享页使用） |
| POST | `/api/boards/:code/threads` | 发主题（multipart，可带 image） |
| POST | `/api/threads/:id/replies` | 回复（multipart，可带 image） |
| POST | `/api/posts/:id/like` | 给帖子或回复点赞（同一访客只记一次） |
| GET | `/api/cron/cleanup` | Vercel Cron 清理入口（需要 CRON_SECRET） |
| POST | `ADMIN_PATH/api/login` | 管理员登录 |
| GET | `ADMIN_PATH/api/overview` | 后台统计与帖子列表 |
| POST | `ADMIN_PATH/api/cover` | 上传 / 更换封面 |
| DELETE | `ADMIN_PATH/api/cover` | 移除封面 |
| PUT | `ADMIN_PATH/api/settings` | 修改首页标题和说明 |
| POST / PUT / DELETE | `ADMIN_PATH/api/boards...` | 增删改分区 |
| POST / DELETE | `ADMIN_PATH/api/posts...` | 发布管理帖、删除帖子 |
| PUT | `ADMIN_PATH/api/posts/:id/sticky` | 置顶 / 取消置顶 |

---

## 15. 部署确认清单

- [ ] GitHub 仓库已推送，`.env` 没有被提交
- [ ] Supabase / Neon 已创建，`DATABASE_URL` 已配置
- [ ] Cloudinary 或 Supabase Storage 已配置
- [ ] Vercel 环境变量已填写
- [ ] 部署成功，`/api/meta` 显示 `postgres` 与云存储
- [ ] 发帖、回帖、点赞正常
- [ ] 上传图片后，在 Cloudinary / Supabase Storage 能看到文件
- [ ] 后台登录、删帖、置顶、封面、分区管理正常
- [ ] 重新部署后帖子与图片仍然存在

全部完成后，本项目就是「Vercel 免费运行 + PostgreSQL 持久化 + 对象存储持久化」的可用匿名论坛。
