# manga-window-translator

在屏幕上框选漫画文字，识别并翻译后显示在原位置，或作为可拖动的旁注。适用于 Windows。

## 安装与启动

```powershell
npm install
py -3.13 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm start
```

已有环境直接运行 `npm start`。启动器会清除 `ELECTRON_RUN_AS_NODE`，Electron 自动启动本地 Python 服务，不必另开后端。首次使用某种 OCR 语言可能需要下载模型；默认预热日文。

启动后点击工具栏 **AI 设置**，选择 **OpenAI / Gemini / DeepSeek**、模型，粘贴对应服务商的 **API Key**，点击 **保存并使用**。API 地址会自动匹配，无需编辑文件；保存后下一次翻译立即使用新配置，无需重启。三家服务商的模型和密钥分别记忆，密钥输入框留空表示沿用已保存的密钥。

模型预设覆盖 2026-06-29 至 2026-09-29 官方发布的近期文本模型，核对日期为 2026-09-29。选择 **手动输入模型名称…** 可使用未列出的模型。填写密钥后，**同步可用模型**会直接向所选服务商读取账户可用文本模型，不发送漫画或发起翻译；有创建日期时筛选近期模型，未提供日期的明确标注，不推断发布时间。同步成功不代表账户有每个模型的调用权限或额度。

模型资料：[OpenAI 更新记录](https://developers.openai.com/api/docs/changelog)、[Gemini 更新记录](https://ai.google.dev/gemini-api/docs/changelog)、[DeepSeek 更新记录](https://api-docs.deepseek.com/updates/)。预设和端点统一保存在 `backend/provider-catalog.json`；新的官方发布可通过同步或手动输入使用。

密钥使用 Electron `safeStorage`（Windows DPAPI）加密，保存在应用用户数据目录的 `ai-settings.json`；不会向界面回填明文。旧开发版 `.env` / 旧安装版 `settings.env.txt` 可继续读取，在设置窗口保存时写入加密配置，原文件不会被修改或删除。`.env.example` 仅供开发者可选使用，普通用户不需要它。不要分享旧明文配置。OCR 本地运行，翻译服务会接收提取的文字。

## 使用

工具栏和 AI 配置窗口右上方的 **EN / 中文** 按钮可即时切换界面语言，并在下次启动时保留。工具栏、配置窗口、气泡编辑器和进度/错误提示同步切换；不会改变漫画原文、已有译文、API Key 或源/目标语言选择。

在 `v1.0.0-mangaOCR` 开发分支，先点击 **翻译选区**；日文选区完成翻译后，按钮下方会出现 **加强 OCR**。点击后会用本地 Manga OCR 精读这次保存的截图中所有已找到、仍显示的气泡；原文有变化的气泡会批量重新翻译，全部成功后一起更新，失败则保留原有译文。它复用普通 OCR 找到的气泡位置，因此无法找回普通 OCR 完全漏掉的气泡。气泡“编辑”窗口的 **日漫精读** 仍可用于单条修正：它只把结果填入可编辑原文框，核对后再点“翻译并保存”。修改原文后，下方旧译文会标为“上次译文（原文已改，尚未重新翻译）”。仅支持日文；模型未安装或尚在后台载入时，点击会显示原因。当前安装包尚未包含这个可选模型。

要在开发版启用（需要本机 Python 3.10；本机实测可选虚拟环境约 1.6 GiB，模型缓存约 0.85 GiB）：

```powershell
py -3.10 -m venv .manga-ocr-venv
.\.manga-ocr-venv\Scripts\python.exe -m pip install -r backend\requirements-manga-ocr.txt
.\.manga-ocr-venv\Scripts\python.exe -c "from manga_ocr import MangaOcr; MangaOcr()"
npm run start
```

实验环境也可用 `MWT_MANGA_OCR_PYTHON` 指向另一份装有 Manga OCR 的 Python。应用启动时会在后台分别预热普通 OCR 和可选 Manga OCR；Manga OCR 模型常驻工作进程，之后点击“日漫精读”会复用它，退出应用时关闭。启动时可能暂时占用较多 CPU 和内存，编辑窗口会显示模型准备状态，同时仍可手动编辑。精读只读取当前已保存的气泡截图；应用不重新截屏、不自动替换已有译文。真实对照可运行 `backend/.venv/Scripts/python.exe tests/manga-ocr-live.py`（需要 `.qa/real-01.jpg`、`real-02.jpg` 及对应结果 JSON）。

1. 拖动蓝色边框、四角调整选区；拖动工具栏顶部标题区域可以单独移动面板，不再限制选区大小。最小外框 64×64，内部截图区域 52×52 像素。
2. 选择源语言、目标语言和引擎，点击 **翻译选区**（Ctrl+Shift+T）。
3. 识别位置先显示虚线，译文准备好一条就显示一条。再次点击主按钮可取消。

**智能贴合**是默认模式：纯色背景且译文能放下时，使用原气泡底色原位显示，保留原轮廓；背景复杂或译文太长时自动显示编号旁注。**全部旁注**保留原漫画文字，适合复杂画面和较长译文。

- **A− / A+**：立即调整译文字号；放不下时自动转旁注。
- **原图 / Ctrl+Shift+O**：临时隐藏译文，再按一次恢复。
- **拖动译文**：自由移动。原位译文拖动后会成为旁注，并恢复源位置的漫画。
- **双击 / 原文按钮**：对照 OCR 原文；再次操作返回译文。
- **编辑**：在单条译文上点击编辑，查看保存的原图裁片、修正识别文字，再「翻译并保存」。也可先重新识别这张裁片，不必重跑整页。
- **卡片内部滚动**：阅读很长的译文；右上角 × 关闭单个结果。
- **清除 / Ctrl+Shift+C**：停止当前任务，清空所有译文。
- **重复翻译同一选区**：成功后替换原结果；失败时可「补译剩余」或「恢复上一版」。补译保留已完成条目，并使用原任务截图和语言/引擎。

- **固定 / 翻页检测**：默认固定。开启检测后，画面变化会隐藏旧译文，稳定后出现「翻译新页」；点击后才调用翻译服务。回到原画面会恢复原译文。编辑、拖动和翻译期间暂停检测。
- **锁定选区**：切换选区空白部分是否接收点击；工具栏和译文本身可交互。
- **通透 / 柔和**：切换玻璃界面的清透与着色效果；复杂画面下可选柔和来提高对比度。
- **退出 ×**：3 秒内点击两次确认。

语言、显示模式、字号、玻璃外观和阅读模式会自动保存。错误会显示可关闭的提示。最近三次选区截图只保存在应用内存中供单条编辑，清除或退出会释放；旧译文的截图过期后需要重新框选。

默认控制层使用透明背景和跟随指针的高光，不再连续截图模拟折射。此前桌面采样实测每次约 451–526ms，严重影响输入响应，因此截图折射已退出默认路径；默认模式也不生成位移贴图。装饰边缘保留透明效果；文字清晰度优先，面板底色不透明度为 90% 起，旁注正文为 94% 起，柔和模式进一步增加着色。已取消文字光晕，面板基础字号为 13px。系统「减少动态效果 / 减少透明度」偏好也会生效。默认效果不包含真实桌面折射。

实验性截图折射仅供开发验证：设置环境变量 `MWT_GLASS_CAPTURE=1` 后启动，需要 Windows 10 2004 或更新版本，仍可能造成严重卡顿，不建议日常启用。背景画面只在本机内存处理，传给界面的仅是玻璃覆盖区域，不写入磁盘、不进入 OCR 或翻译接口。应用窗口仍从系统截图中排除，因此外部截图/录屏可能看不到这些窗口。窗口横跨两台显示器或截图失败时，回退为透明高光效果。此实现未使用 Apple 原生材质引擎。

## 验证

Windows 安装版：运行 `dist/Inazuma-Setup-1.0.0-x64.exe`，安装后通过桌面 / 开始菜单的 **Inazuma** 启动。安装包包含 Python 运行时和本地 OCR 模型，无需安装 Node.js、Python 或手动启动后端。也可直接运行 `dist/win-unpacked/Inazuma.exe`，但必须保留整个 win-unpacked 文件夹。

新版源码通过工具栏 **AI 设置**配置服务商，无需创建 `.env`；构建白名单不包含开发者密钥。现有旧安装包仍是旧配置界面，需要重新构建才会包含本次更改。当前测试包未作代码签名，Windows 可能提示未知发布者。

开发者构建 Windows x64 安装包（先完成 Python / npm 开发依赖安装）：

```powershell
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-build.txt
npm run dist:win
npm run test:packaged
```

构建时预热并收集各源语言模型；首次构建可能下载模型和 Electron / NSIS 工具。生成物在 `.build/` 和 `dist/`，不入 Git。`test:packaged` 验证真实 exe、内置 OCR、无密钥配置及退出清理；不会访问翻译服务。需要先生成下文的测试素材。

日常修改后统一运行（不调用真实 OCR 或付费翻译）：

```powershell
npm run validate
```

依次运行基础测试、UI 功能与布局、AI 设置与模型切换、Windows 原生输入、正常 GPU 响应性能测试。设置测试使用真实 Electron 窗口、preload、IPC 和系统加密，模拟服务商响应，覆盖三家切换、自定义模型、同步失败、留空保留密钥及保存后立即翻译；也可单独运行 `npm run test:settings`。基础测试超时为 30 秒，每项 Electron 测试为 60 秒；失败或超时后继续其余项目，最终以非零退出码报告失败。日志和报告写入 `.qa/validation/`，总报告为 `latest.json`，每次运行覆盖该入口的上一次报告。运行中报告标为 `RUNNING`，不能当作通过。

实验折射单独运行 `npm run validate:glass`，报告位于 `.qa/validation/glass/latest.json`；它不能替代默认验证。请勿同时运行多个验证命令，以免窗口、GPU 负载和截图文件互相影响。

验证器明确列出未覆盖项：真实 OCR / 翻译服务、人工视觉和系统鼠标验收、混合 DPI 双屏。UI 截图生成不代表人工视觉通过。首次准备测试素材仍使用下方 `make_fixture.py` 命令；Python 后端回归也需单独运行。

离线回归和界面测试：

```powershell
backend/.venv/Scripts/python.exe tests/make_fixture.py
backend/.venv/Scripts/python.exe -m unittest discover -s tests -p "test_*.py" -v
npm test
npm run test:ui
npm run test:glass
npm run test:glass:app
```

真实 DeepSeek 测试（需要配置 key，会产生 API 请求）：

```powershell
backend/.venv/Scripts/python.exe tests/benchmark.py --live
npm run test:app:live
```

测试在隐藏的 Electron 页面内触发输入，不移动系统鼠标。完整应用测试仅注入受控屏幕图片，之后经过真实的截图坐标裁剪、IPC、HTTP、OCR、翻译和渲染。测试素材、截图和计时写到 `.qa/`，不纳入版本管理。

[动态玻璃验证](docs/QA-2026-09-23-liquid.md) · [功能测试记录](docs/QA-2026-09-22-glass.md) · [此前布局与性能测试](docs/QA-2026-09-22.md) · [交接与后续事项](HANDOFF.md)

## 当前边界

- 原位贴合是经过背景检查的色块覆盖，不是图像修复；复杂背景采用旁注。
- 译文不追踪滚动坐标；翻页检测通过画面变化隐藏旧译文，再由用户确认翻译新页。检测需要 Windows 10 2004 或更新版本。
- 竖排已测公开小样例，注音和特殊字形仍可能误识别。密集页面的卡片可能需要手动挪动。
- 跨显示器选区只处理主要显示器内的部分；实体混合 DPI 多屏尚未验证。
- 取消会立刻停止显示后续结果；已经开始的同步 OCR/网络调用需要等返回。Google/MyMemory 底层网络超时和快速取消仍待改进。

