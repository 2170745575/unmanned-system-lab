# 发布到 GitHub（让别人也能打开）

这份作品集是**纯静态**的：不需要构建、不需要服务器，推到 GitHub 后再开一下 Pages，任何人用浏览器就能打开。

> 发布前的准备我都做完了（根 `index.html` 跳转页、`.nojekyll`、`.gitignore`、一键脚本、路径兼容性核对）。
> 唯一需要你本人的是 **GitHub 授权**——这一步没法由我代替。

---

## 路线 A：不装 Git，用 GitHub API 直接上传（最省事）

**第 1 步**：生成一个 Fine-grained token → <https://github.com/settings/personal-access-tokens/new>
- 权限只要两项：**Contents: Read and write**、**Administration: Read and write**（后者仅用于建仓库与开启 Pages）
- 有效期建议 **7 天**，用完立刻吊销

**第 2 步**：双击 `upload.cmd`，按提示粘贴 token 与仓库名（默认 `unmanned-system-lab`）

脚本会自动：校验 token → 创建仓库（已存在则复用）→ 把 86 个文件（约 4.6 MB）作为**一次提交**上传 → 开启 GitHub Pages → 打印站点地址。

**第 3 步**：约 1 分钟后，任何人都可以通过这个地址打开：

```
https://你的用户名.github.io/unmanned-system-lab/
```

根路径会自动跳到作品展台 `dji-hub/`。

> 命令行等价写法（Windows 默认禁止运行 .ps1，所以要用 `-ExecutionPolicy Bypass`）：
> ```powershell
> $env:GH_TOKEN = 'github_pat_xxx'
> powershell -NoProfile -ExecutionPolicy Bypass -File .\upload-to-github.ps1 -RepoName unmanned-system-lab
> ```

---

## 路线 B：用 Git 标准流程（本机已就绪）

本机没有系统级 Git，我已经装好了**便携版 MinGit**（`%LOCALAPPDATA%\MinGit`，2.56.0，无需管理员权限、不改系统设置），`publish.ps1` 会自动找到它——**所以这一步你不需要任何安装**。仓库也已经初始化好：**86 个文件已暂存、0 次提交、分支 main**。

**第 1 步**：在 GitHub 上新建一个**空**仓库 → <https://github.com/new>
（**不要**勾 Add README / .gitignore / license，名字例如 `unmanned-system-lab`）

**第 2 步**：双击 `publish.cmd`，按提示输入用户名与仓库名；
或者用命令行（Windows 默认禁止运行 .ps1，必须带 `-ExecutionPolicy Bypass`）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\publish.ps1 -GitHubUser 你的用户名 -RepoName unmanned-system-lab
```

脚本会自动：设置提交身份 → 提交 86 个文件 → `branch -M main` → 配置 origin → 推送 → 打印 Pages 设置步骤。
（首次推送会弹出浏览器让你登录 GitHub；脚本是幂等的，重复执行只会追加提交。）

**第 3 步**：开启 GitHub Pages → 打开 `https://github.com/你的用户名/unmanned-system-lab/settings/pages`，
Source 选 **Deploy from a branch** → Branch 选 **main** / **/(root)** → Save。

---

## 仓库里有什么、没有什么

| 内容 | 入库 | 说明 |
| --- | --- | --- |
| `dji-hub/` + 五个机型目录 | ✅ | 真正的作品，**合计约 4.1 MB** |
| `dji-hub/assets/*.png` | ✅ | 5 张机型缩略图（门户卡片用） |
| 各目录的 `vendor/three.min.js` | ✅ | 离线兜底用的 Three.js r149（每个 608 KB，共 5 份） |
| `README.md`、各目录 README、`PUBLISH.md` | ✅ | 作品说明与发布说明 |
| `index.html`（根） | ✅ | 自动跳转到 `dji-hub/`，让 Pages 根路径可用 |
| `.nojekyll` | ✅ | 关闭 Pages 的 Jekyll 处理（否则下划线开头的目录会被忽略、部分文件会被改写） |
| `_dji_selftest/*.js`、`*.py` | ✅ | 测试与审计工具（冒烟测试、红线验证、穿模审计、Pages 路径核对、PBR 离线渲染器） |
| `_dji_selftest/*.json`、`*.png` | ❌ | 测试产物（**约 222 MB** 的几何转储与渲染图），已在 `.gitignore` 排除 |
| `upload.cmd`、`upload-to-github.ps1`、`publish.ps1` | ✅ | 发布脚本 |

**总计入库约 86 个文件 / 4.6 MB。** 页面运行时完全不依赖 `_dji_selftest`，所以也可以把整个目录排除掉让仓库更轻。

---

## 部署后的路径兼容性（已实测）

- 全部引用都是**相对路径**，实测 **0 处绝对路径 / `file://` 引用** → 挂在 `https://用户名.github.io/仓库名/` 这种子目录下能正常工作
- 门户里五张卡片的跳转目标全部存在
- Three.js 走 **CDN 优先、3.5 秒超时回退本地 `vendor/three.min.js`** → HTTPS 下两条路都可用，断网也能跑
- `dsh-startup.json` 通过 `fetch` 读取（HTTP/HTTPS 下生效）；`file://` 下自动改用孪生文件 `dsh-startup.js`
- `dji-hub` 是纯 HTML/CSS/Canvas 2D，**不需要 Three.js**（所以它目录里没有 `vendor/`，这是正常的）

---

## 其它可选事项

- **私有仓库也能用 Pages**：在 Pages 设置里把可见性改成 Public 即可（免费账号的 Pages 站点是公开的）。
- **自定义域名**：在 Pages 设置里填 CNAME，或直接在仓库根目录放一个 `CNAME` 文件。
- **许可证**：仓库目前没有 `LICENSE` 文件。要开源给别人用的话建议加一个（MIT / CC BY-NC 4.0 等，看比赛要求）。
- **仓库描述**：建议写 `Procedural Three.js showcase of five unmanned airframes — no external models, textures or audio.`

---

## 路线 A：一条命令（推荐）

**第 1 步**：安装 Git → <https://git-scm.com/download/win>（装完**重开一个 PowerShell 窗口**）

**第 2 步**：在 GitHub 上新建一个**空仓库**（不要勾 Add README / .gitignore / license），例如叫 `unmanned-system-lab`

**第 3 步**：在本目录执行

```powershell
.\publish.ps1 -GitHubUser 你的用户名 -RepoName unmanned-system-lab
```

首次推送会弹出浏览器让你登录 GitHub。脚本是幂等的，重复执行只会追加提交。

**第 4 步**：开启 Pages —— 打开 `https://github.com/你的用户名/unmanned-system-lab/settings/pages`，
Source 选 **Deploy from a branch** → Branch 选 **main** / **/(root)** → Save。

约 1 分钟后，任何人都可以通过这个地址打开：

```
https://你的用户名.github.io/unmanned-system-lab/
```

根路径会自动跳到作品展台 `dji-hub/`。

---

## 路线 B：手动几条命令

```bash
git init
git add -A
git commit -m "Unmanned System Lab - 5 airframes 3D showcase"
git branch -M main
git remote add origin https://github.com/你的用户名/unmanned-system-lab.git
git push -u origin main
```

然后同上面的第 4 步开启 Pages。

---

## 仓库里有什么、没有什么

| 内容 | 入库 | 说明 |
| --- | --- | --- |
| `dji-hub/` + 五个机型目录 | ✅ | 真正的作品，**合计约 4.1 MB** |
| `dji-hub/assets/*.png` | ✅ | 5 张机型缩略图（门户卡片用） |
| 各目录的 `vendor/three.min.js` | ✅ | 离线兜底用的 Three.js r149（每个 608 KB） |
| `README.md`、各目录 README | ✅ | 作品说明 |
| `index.html`（根） | ✅ | 自动跳转到 `dji-hub/`，让 Pages 根路径可用 |
| `.nojekyll` | ✅ | 关闭 GitHub Pages 的 Jekyll 处理（否则下划线开头的目录会被忽略、部分文件会被改写） |
| `_dji_selftest/*.js`、`*.py` | ✅ | 测试与审计工具（冒烟测试、红线验证、穿模审计、PBR 离线渲染器） |
| `_dji_selftest/*.json`、`*.png` | ❌ | 测试产物（**约 222 MB** 的几何转储与渲染图），已在 `.gitignore` 排除 |
| `publish.ps1`、`PUBLISH.md` | ✅ | 本发布脚本与说明 |

`.gitignore` 已经配好，`git add -A` 不会把那些大文件带进去。如果你想让仓库更轻，也可以把 `_dji_selftest/` 整个排除掉（不影响网站运行——**页面运行时完全不依赖它**）。

---

## 部署后的路径兼容性（已核对）

- 全部引用都是**相对路径**，实测 **0 处绝对路径 / `file://` 引用** → 挂在 `https://用户名.github.io/仓库名/` 这种子目录下能正常工作
- 门户里五张卡片的跳转目标全部存在（`../dji-xxx/index.html`）
- Three.js 走 **CDN 优先、3.5 秒超时回退本地 `vendor/three.min.js`** → HTTPS 下两条路都可用，断网也能跑
- `dsh-startup.json` 通过 `fetch` 读取（HTTP/HTTPS 下生效）；`file://` 下自动改用孪生文件 `dsh-startup.js`

---

## 其它可选事项

- **私有仓库也能用 Pages**：在 Pages 设置里把可见性改成 Public 即可（免费账号的 Pages 站点是公开的）。
- **自定义域名**：在 Pages 设置里填 CNAME，或直接在仓库根目录放一个 `CNAME` 文件。
- **许可证**：仓库目前没有 `LICENSE` 文件。要开源给别人用的话，建议加一个（例如 MIT 或 CC BY-NC 4.0，看你的比赛/展示要求）。
- **仓库描述**：建议写上 `Procedural Three.js showcase of five unmanned airframes — no external models, textures or audio.`，方便别人一眼看懂。