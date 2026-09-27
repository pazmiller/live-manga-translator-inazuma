## 2026-09-26 统一 validator

新增 `npm run validate`：基础 Node、UI、Windows 原生输入、正常 GPU 响应测试串行执行；30s / 60s 超时，超时仅清理当前测试进程树，失败后继续，总失败退出码 1。`.qa/validation/latest.json` 和逐项日志每次覆盖，执行中标 RUNNING。`npm run validate:glass` 单独验证实验折射，报告在 glass 子目录，不能替代默认回归。禁止同时运行多个 validator 以免共享测试文件 / GPU 相互影响。

脚本 `scripts/validate.cjs` 直接启动 Node / Electron，清除 ELECTRON_RUN_AS_NODE，不调用付费服务。首次素材仍需 make_fixture.py，Python 后端回归另跑；未覆盖真实 OCR / API、人工视觉 / 系统鼠标、混合 DPI。`tests/validate.test.cjs` 覆盖失败、缺失可执行程序、超时、后续继续与 JSON / 日志。完整默认入口已通过。代码及 package / 测试调用审计无额外冗余清理建议。

---
## 2026-09-26 译文字体描边试用

按字体清晰度反馈给译文 `.copy` 增加硬描边（字形 stroke 总宽度 clamp(1px, .1em, 2.4px)，paint-order:stroke fill 保留笔画内部）。原位描边采用 OCR 背景色，旁注浅色用白边、深色用暗边，不使用模糊阴影。已通过 test:ui 并查看 after-smart.png，小字、竖排和深色底保持可读。仅改译文字体，面板边框未改。审计 CSS 与 render 变量调用，无额外清理建议。

---

## 2026-09-26 文字清晰度

取消浅色 / 深色文字阴影及主要按钮文字阴影。工具栏基础字体改为 Microsoft YaHei UI 优先、13px，状态 12px、快捷键 11px；旁注控制字号 12px。工具栏使用 panel 衬底，浅色面板不透明度 90%、旁注正文 94%、输入区 96%，深色和柔和模式同步增强。装饰边框继续透明；原位译文的排版字号算法未改。

验证：`test:ui`、`test:input`、`test:responsive` 通过；正常 GPU 心跳最大延迟 14ms、装饰采样 0。已查看 `.qa/frame.png` 和 `.qa/after-cards.png`，文字 / 控件无裁切，旁注保留滚动。属于受控背景截图与自动交互验证，未代替用户实际显示器观感。审计三个 CSS 文件、关联 HTML / 变量引用和文档，无额外安全清理建议。

---
## 2026-09-25 操作面板点击修复（最新）

Windows 原生命中验证发现全部工具栏控件被判为 HTCAPTION（拖动区），DOM click 测试无法发现。修复为只允许顶部 `.heading` 拖动，移除 `#toolbar` 的整体 drag 声明；不要把整个 toolbar 设成 no-drag，否则标题也无法拖动。控件继续 no-drag。

新增 `npm run test:input`，结合原生 WM_NCHITTEST、主进程穿透决策和 renderer 指针事件 + 真实 IPC 验证按钮操作，不操控系统鼠标。改动前失败，改动后按钮 HTCLIENT、标题 HTCAPTION，字号 / 锁定 / 原图 / 清除 / 翻译入口及受控失败 / 退出确认通过。UI 回归和 GPU 响应测试也通过。详见 [本轮记录](docs/QA-2026-09-25-performance.md)。

---
## 2026-09-25 启动 / 拖动性能回退修复（优先于下文）

默认已关闭桌面截图折射，保留透明和指针高光；默认不生成 SVG 位移贴图。原因：原生截图实测每次 451–526ms，主线程心跳延迟达 469ms，旧定时器却每 150ms 尝试截图。不是普通透明本身需要几秒计算。`MWT_GLASS_CAPTURE=1` 仅保留为开发实验开关，该路径仍可能严重卡顿，不应默认开启。

新增 `npm run test:responsive`：正常 GPU 下真实 Electron 窗口程序驱动移动 / 缩放 35 次，默认外观采样 0 次，主线程心跳最大延迟 12ms；这不等同用户手动拖动验收。16 Node 测试及 UI / glass / glass-app 测试通过。翻页检测截图路径未改，性能测试使用默认固定模式。原因、取舍和验证边界见 [性能记录](docs/QA-2026-09-25-performance.md)。后续若恢复真实折射，需要低延迟背景来源与正常 GPU 输入延迟测试，不能继续高频调用 getSources。

---
# 项目交接说明

## 2026-09-23：修正玻璃效果，优先阅读

用户指出上轮只是浅色圆角，缺少 iPhone Liquid Glass 的流动和透明。反馈成立：旧 CSS 底色不透明度 79%–95%，Acrylic 也没有实际桌面折射。本轮替换这部分实现，下面旧记录中有关 Acrylic、材质及仅在阅读模式截图排除的说明不再适用。

- `renderer/liquid-glass.js`：自动发现工具栏、选区边框、编辑面板、旁注和悬浮控件。为圆角矩形生成二维位移图，经 SVG `feDisplacementMap` 折射本地背景纹理；高光位置、折射强度使用指针/拖动/按压驱动的阻尼动画。没有永久播放的装饰水波；静止后停止动画，避免持续占用。
- `glass-capture.js`：批量获取桌面缩略图，按注册的玻璃区域裁剪，只把局部纹理经 `glass:frame` 送给对应 renderer。附近交互/窗口变化约 150ms 更新，空闲约 750ms；同一时刻最多一项采样，每窗口最多 8 层和 120 万输出像素。全屏 overlay 的透明空白与选区中央不会误触高频采样。翻译/单条处理时暂停并清除旧纹理，避免阻塞翻译及显示冻结背景。
- 所有应用窗口在 Windows 10 build 19041+ 使用截图排除，避免纹理递归；固定阅读模式也必须保留。外部截图/录屏可能无法录到这些窗口。素材不写盘、不发送后端、不参与 OCR；测试图是例外，仅由测试脚本保存受控素材。
- `main.js` 不再给工具栏调用 Acrylic。它注册局部纹理区域，并复用原鼠标轮询，向 renderer 发送相对指针与窗口移动量。`preload.js` 新增 `glassRegions / onGlassFrame / onGlassMotion`。
- CSS 透明底色为 12%–18%，柔和档增加着色；保留真实 alpha 和局部文字衬底。背景明暗适配文本颜色，6px 选区边框有跟随光斑，中央 alpha 为零。减少动态效果会停止光学动画；减少透明度关闭纹理层，回退到实色可读 UI。
- 纹理失败、越屏或跨显示器时清空对应图层，不拉伸错误裁片。图片版本号阻止异步解码把过期背景重新显示。renderer 对玻璃层数量也有限制，清除/隐藏结果会停止其采样请求。

验证见 [本轮记录](docs/QA-2026-09-23-liquid.md)：16 项 Node、隐藏 Electron 视觉/交互、main/preload 集成均通过。本轮没有付费翻译调用。真实 Windows 截图排除通过受控图验证（软件合成模式），普通 GPU 路径首测出现环境 `UnknownVizError`，未单独证明其兼容性。不要将受控背景测试描述成所有显卡/多屏均已实测。

新增命令 `npm run test:glass`、`npm run test:glass:app`。原 `test:app:live` 的截图计数已区分外观采样与翻译截图；本轮未重新调用 DeepSeek，翻译链路的实网验证保留上一轮记录。

---

## 2026-09-22 第二轮：单条校正、恢复、独立选区与玻璃界面

本节覆盖下面的第一轮/初版记录中冲突的行为。用户本轮明确要求落实改进 1、2、3、5，并将整体 UI 调整成当前 iOS Liquid Glass 风格。

### 当前结构与行为

- `main.js` 创建三个界面层：`frame.html` 是可独立移动的工具栏（680px 宽，正常约 192px 高；恢复操作出现时约 228px，错误区在恢复按钮下方按需展开），`selection.html` 是只有 6px 边框和四角 16px 手柄的透明选区（最小外框 64×64），`overlay.html` 是每屏译文与单条编辑面板。选区内框坐标统一为四边减 6px，不再有 `TOOLBAR_H`。
- 主进程的鼠标轮询保留。工具栏、选区角手柄优先；编辑面板打开时 overlay 获得键盘焦点和鼠标优先级，阅读检测暂停。不要用 renderer 自身 mousemove 唤醒已穿透窗口。
- 单条编辑使用保存的截图，支持重新 OCR、修正文本、仅重译此条。`POST /bubble/ocr` 不要求翻译 key；`POST /bubble/translate` 对所有引擎都使用用户修正文本，Claude 在此处走文字接口。编辑关闭/清除时中止前端请求，迟到结果不会重新打开面板。
- 新批次暂存相交旧译文；成功后释放旧视图，失败/取消后保留已完成部分，工具栏显示完成数，可补译缺失 ID 或恢复上一版。`only_ids` 必须对应原截图 OCR 缓存；缓存过期会明确要求重新翻译选区，不能重新编号后误更新条目。
- 主进程保存最近三次截图供编辑，后端仍只缓存 OCR 元数据和译文；清除/退出释放本地截图。旧气泡截图过期时仍可阅读，但编辑需要重译选区。
- 默认固定位置。可选翻页检测每约 850ms 截取缩略选区、降采样成 64×64 灰度比较；明显变化后隐藏旧译文，静止约 1 秒后提示「翻译新页」，不自动发付费请求。回到基准画面恢复旧译文。移动选区会作废基准；编辑/拖动/翻译暂停检测。比较逻辑在 `reading-watch.js`。
- Windows 10 build 19041 起用 `setContentProtection(true)` 在检测期间排除本应用窗口，避免闪烁和把译文识别成翻页；退出检测后关闭排除。更老系统提示不支持并退回固定模式。实体桌面截图排除效果尚未验证，自动测试使用受控截图。
- `glass.css` 是共享材质变量。工具栏、编辑面板、旁注与操作控件采用圆角反光/半透明样式；支持通透/柔和和减少透明度/动态效果。正文智能贴合沿用原底色，不对漫画正文整体加玻璃。工具栏在 Windows 11 build 22621+ 调用 Acrylic；不要对全屏 overlay 开原生背景材质，会遮住漫画。CSS 无法真正折射另一个应用的桌面内容，不能宣称等同 Apple 原生 Liquid Glass。
- `/health` 协议版本现在是 **3**，旧服务占用端口会给出错误。新增两个单条接口共享原有并发上限 2。

### 验证与下一步

见 [第二轮测试记录](docs/QA-2026-09-22-glass.md)。测试命令仍为 `npm test`、`npm run test:ui`、`npm run test:app:live`，Python 改为 `-m unittest discover -s tests -p "test_*.py" -v`，包含新的单条与补译接口测试。

优先继续验证实体桌面穿透/截图排除、混合 DPI 双屏，以及更多真实整页的 OCR 和旁注排布。Google/MyMemory 网络超时仍未解决，Claude 没有实网 key；不要把它们描述为已通过真实服务测试。

---

## 2026-09-22 第一轮更新存档

本轮已完成显示策略、流式链路、连续操作和可重复测试的改进。下面的旧交接内容保留作历史背景；与这一节冲突时，以这一节为准。

### 当前行为

- 默认「智能贴合」：OCR 分组保留文本范围，检查各行和整组外围背景是否足够一致。能在默认最小 14px 下放得下的译文，用采样背景色覆盖文本组，保留漫画气泡轮廓，不加矩形边框/投影。颜色复杂、空间不足或放大字号后放不下时，转成有编号/连线的旁注卡片。
- 「全部旁注」适合希望完整保留原图的用户。卡片拖动后保持手动位置；拖动原位译文时会改成卡片，原文字恢复。长段文字可以在卡片内滚动，不裁掉。
- 原文按钮/双击对照 OCR 文本；「原图」按钮或 Ctrl+Shift+O 临时隐藏全部译文。字号、语言、引擎、模式保存在 Electron localStorage。
- 同一选区重复翻译会替换相交旧结果。清除和取消会中止前端请求，作废迟到事件；部分已完成的译文在单纯取消/失败时保留。清除会全部移除。每屏最多保留 120 个译文元素。
- 工具栏分两行，高度 **76px**，最小窗口 **380×160**。main.js 的 TOOLBAR_H 必须和 frame.css 对齐。取消翻译与开始翻译共用主按钮。
- Windows 点击穿透由主进程每 40ms 读取光标位置与 renderer 上报区域来决定，避免依赖已经穿透的 renderer 自行收到 mousemove；拖动期间固定接收输入。不要退回最初的 renderer-only 唤醒方案。

### 后端与性能

- POST /translate/stream 返回 NDJSON：progress → regions → progress → bubble（逐条）→ done；失败返回 error。界面不再用固定定时器伪装 OCR/翻译进度。原 POST /translate 保留兼容。
- 启动后台预热日文 OCR；OCR 调用有锁，最多保留 2 种语言引擎。截图哈希+源语言缓存最多 12 组 OCR **元数据**，不保留图片。翻译内存缓存最多 256 条，key 包括引擎、模型、源/目标语言和整组上下文；损坏/未完整返回的批次不进入缓存。
- DeepSeek 复用客户端并读取流式 JSON，完整字符串到达就显示；显式检查空结果、缺项、无效 JSON。超时为 30 秒，无 SDK 自动重试。Claude 超时 35 秒；前端整体任务 90 秒超时。
- 服务最多同时处理 2 个任务。取消能立即停止 UI 更新；已经进入同步 OCR/SDK 的调用不能硬中断，需要等当前调用返回/超时。Google/MyMemory 的旧第三方同步路径仍可能很慢、缺少底层网络超时，这一轮未改造成真正可中断的传输。
- 日文分组新增：同列片段从上到下；避开明显黑色分隔边界；满足强尺寸和相邻位置条件的小号右侧注音只参与遮罩，不重复混入正文。注音仍是启发式规则，不应宣称所有漫画适用。
- 跨屏框选按占比最大的显示器裁剪，不承诺一次拼接多屏。坐标转换使用实际缩略图尺寸；混合 DPI 的实体多屏尚未验证。

### 验证结果与入口

完整说明：[docs/QA-2026-09-22.md](docs/QA-2026-09-22.md)。实测截图位于被 gitignore 的 .qa/，可用脚本重建。

1. `backend/.venv/Scripts/python.exe tests/make_fixture.py`
2. `backend/.venv/Scripts/python.exe -m unittest discover -s tests -p test_backend.py -v`（16 项）
3. `npm test`（4 项 stream/坐标测试）
4. `npm run test:ui`（隐藏 Electron 中执行交互并截屏，不使用系统鼠标）
5. `backend/.venv/Scripts/python.exe tests/benchmark.py --live`（会使用 .env 的 DeepSeek key，产生真实请求）
6. `npm run test:app:live`（只替换截图输入，真实 main/preload/HTTP/OCR/DeepSeek/overlay 全链路）

六气泡 1000×740 测试图：修改前首次 OCR 4.69s、热 OCR 1.46s；预热后的新接口本轮 OCR 0.96s，首条译文 2.52s，总计 2.65s；重复接口请求 18ms。完整应用控件触发约 2.9s，重复显示「已复用」。这些是单次本机观测，不是统一硬件/网络条件下的统计基准，接口耗时不含原生截图。

两个公开竖排样例来自 https://github.com/kha-white/manga-ocr 的 assets/examples/01.jpg、02.jpg，仅本地实验，不作为再分发素材。注音误识别产生的多余数字已排除，但第一个样例仍有「穴.」的标点误识别，OCR 质量未完全解决。

### 后续优先事项

1. 实体桌面验证穿透、滚轮翻页、不同 DPI 双屏：本轮测试没有接管用户鼠标。一次尝试的原生桌面截图看到了其他桌面内容而非测试页，不能将之计为测试页截图验证成功；后续完整链路采用受控截图输入。
2. Google/MyMemory 的网络超时、逐条返回与取消；Claude 未配置 key，未做实网验证。不要把所有引擎都描述为已验证。
3. 更多真实整页漫画回归：尤其小字、注音、跨气泡错误合并、倾斜文字、复杂背景中的检测遗漏。当前色块贴合不是 inpainting。
4. 密集页面的旁注避让仍为几何启发式，可能挡住画面或交叉连线。用户可拖动/切换原图。当前仍不随漫画滚动，翻页前清除，再翻译。

---

## 初版交接存档

写给接手继续开发的人/AI。项目目前是可运行的原型，核心闭环已验证通过。

---

## 一句话说明

透明可拖拽的悬浮窗，用户把边框对准屏幕上任意位置的漫画/网页对话气泡，点"锁定翻译"后自动截图 → OCR → 翻译，译文气泡贴回原文位置，可单独拖拽。

与 GitHub 上已有项目（manga-image-translator、cotrans 等）的区别：那些都是"上传整张图片批处理"，这个是"实时框选屏幕任意区域 + 译文原位叠加"，交互形态不同。

---

## 技术栈与架构

```
Electron 主进程 (main.js)
├── frame 窗口 (renderer/frame.html)    — 粉色边框 + 顶部工具栏，中间透明镂空
├── overlay 窗口 (renderer/overlay.html) — 每个显示器一个全屏透明窗，画译文气泡和进度卡片
└── spawn Python 后端 (backend/server.py) — FastAPI，localhost:8765
     ├── ocr.py        — RapidOCR(ONNX) 识别 + 气泡分组 + 背景扩张
     └── translate.py  — DeepSeek / Claude / Google 三种翻译引擎
```

**为什么选 Electron 而不是 Tauri**：Windows 上透明窗口 + 点击穿透 + 多屏叠加，Electron 开箱即用；Tauri 要自己碰 Win32 API，坑多。代价是体积大（~370MB）。

**为什么选 RapidOCR 而不是 manga-ocr**：RapidOCR 是 ONNX 推理，无需 GPU，日文准确率实测 0.92–1.00，~3 秒；manga-ocr 对竖排更准但要拖 PyTorch，体积和启动开销大得多。

### 运行方式

```bash
npm start          # 等价于 node run.js
```

后端由 Electron 主进程自动 spawn，不用手动启动。

---

## 踩过的坑（重要，别重蹈覆辙）

### 1. `ELECTRON_RUN_AS_NODE=1` 让 Electron 退化成纯 Node

VS Code 的扩展宿主环境会设置这个环境变量。带着它启动 Electron，`require("electron")` 返回的 `app`、`ipcMain` 全是 `undefined`，而且 `--version` 会输出 Node 版本而不是 Electron 版本，极具迷惑性。

**解法**：[run.js](run.js) 在 spawn Electron 前 `delete env.ELECTRON_RUN_AS_NODE`。`package.json` 的 `start` 脚本指向 `node run.js` 而不是 `electron .`。

### 2. 点击穿透的"先有鸡还是先有蛋"死锁

`setIgnoreMouseEvents(true, {forward: true})` 状态下，Windows 把**所有**鼠标事件（移动、左键、右键）直接转发给底层窗口，渲染进程完全收不到。

原来的实现是"整窗口默认穿透，用 JS 的 mousemove 检测鼠标是否在控件上来决定要不要取消穿透"——但穿透时收不到 mousemove，所以永远无法自动取消穿透。表现为：**只有先划过左上角那个 16×16 的 grip 小方块（它有独立的 `pointer-events: auto`），整个窗口才会被"唤醒"，之后其他边框才能拖拽**。

**解法**：逻辑反转。默认**不穿透**（边框/工具栏永远能感知鼠标），只有鼠标移到中间透明区才切换成穿透。见 [frame.html](renderer/frame.html) 的 `setIgnore(false)` 初始化。

### 3. 同一个限制导致"右键切换穿透"做不了

用户曾要求"右键切换中间区域是否穿透"。因为上述原因，穿透状态下右键事件也收不到，**无法只拦截右键而保留左键穿透**（Electron 的 `forward` 选项是全有或全无）。

**最终方案**：工具栏加了个 🔓/🔒 按钮（按钮本身在不穿透的工具栏上，不受限制）。锁定时边框变深色（`--accent-locked`）作为视觉提示。

### 4. 拖拽缩放窗口卡顿 + 拖不大

两个独立原因叠加：
- 拖动时鼠标很快离开 16×16 的 grip 小方块，`elementFromPoint` 检测就判定"离开控件"，把穿透打开，**拖拽中途丢失**。实测拖 900×600px 窗口只长大 63×42px。
- 每次 mousemove 都发一次 IPC 做增量 `resizeBy(dx, dy)`，堆积后累加值失真。

**解法**：① 拖拽开始时置 `resizing = true`，整个拖拽过程强制保持非穿透，不再逐帧重新判定；② 改成每个动画帧最多发一次 IPC，且传**目标绝对尺寸**而非增量。修复后拖 900×600 精确跟手。

### 5. 竖排判定被前端覆盖

后端 `group_bubbles()` 是按**单行文本框的宽高比**判断竖排（正确），但 overlay 前端又用**整个气泡的宽高比**重新猜了一遍（错误），导致细长的横排多行气泡被误判成竖排，文字旋转 90 度。

**解法**：前端直接用后端返回的 `vertical` 字段，别自己猜。主进程转发气泡数据时也要记得带上这个字段。

### 6. 译文气泡盖不住原文

OCR 返回的框紧贴文字像素，直接按这个尺寸画白底气泡，原文会从边缘露出来。按比例加 padding 也解决不了——因为原文各行宽度不一，是结构性的缺口。

**解法**：[ocr.py](backend/ocr.py) 的 `grow_to_background()`，从 OCR 框向四周扩张，逐像素检测是否还在气泡留白区（与背景色差 < tol），碰到气泡黑边就停。实测右侧气泡从 125×180 长到 243×299，正好覆盖。

---

## 翻译引擎现状

| 引擎 | 状态 | 说明 |
|---|---|---|
| **DeepSeek** | 默认，已配好 key | OpenAI 兼容接口（`https://api.deepseek.com`，model `deepseek-chat`），用 `openai` SDK 调。实测 1.5 秒返回，不限流，译文自然 |
| **Claude** | 代码就绪，**未配 key** | `translate_claude_vision()` 走 Anthropic SDK，**视觉引擎**——直接把气泡截图喂给模型，跳过 OCR 误差，质量最好。需要 `ANTHROPIC_API_KEY` |
| **Google** | 可用但几乎必定限流 | `deep_translator` 调的免费网页端点，实测每次都触发 TooManyRequests，会自动降级到 MyMemory（也免费，需要 `ja-JP` 这种地区化语言码） |

Key 放在 `.env`（已被 gitignore），`.env.example` 是模板。后端 [server.py](backend/server.py) 顶部有手写的 `.env` 解析（没用 python-dotenv）。

---

## 已实现的交互细节

- **四角缩放**：四个角都能拖拽改尺寸。nw/ne/sw 三个角缩放时要**同时移动窗口 x/y**（因为窗口以左上角为锚点），否则窗口会往反方向跑
- **退出二次确认**：× 按钮点第一次变红显示"确定?"，3 秒内不点则自动还原
- **进度卡片**：点锁定翻译后，锁定区域中央浮现黑色胶囊卡片，依次显示"锁定气泡… → OCR 识别中… → 文本提取成功 → 开始翻译…"。**注意：这是按固定时间估算切换的，不是后端真实进度**——因为 `/translate` 是一个不透明的同步请求，中途没有进度事件。第 4 段不设结束时间，一直显示到请求真正返回（翻译耗时波动太大，不能编造完成时间）
- **气泡交互**：拖拽移动、双击切换原文/译文、右上角 × 单独关闭
- **快捷键**：`Ctrl+Shift+T` 锁定翻译，`Ctrl+Shift+C` 清除

---

## 迁移到新机器要做的事

**项目不是 git 仓库**，需要手动拷贝整个目录（或先 `git init`）。

拷贝时**排除**这两个目录（体积大且平台相关，新机器重新装）：
- `node_modules/`
- `backend/.venv/`

新机器上重建：

```bash
npm install
cd backend
python -m venv .venv
.venv\Scripts\pip install rapidocr onnxruntime fastapi uvicorn deep-translator pillow numpy anthropic openai
```

**注意**：`.env` 里有真实的 DeepSeek API key，拷贝时留意不要泄漏（比如别直接推到公开仓库）。

RapidOCR 首次运行会自动下载 ONNX 模型（存在 `.venv/Lib/site-packages/rapidocr/models/`），需要联网，之后离线可用。

---

## 待办 / 已知限制

按优先级排：

1. **竖排漫画没验证过** —— 测试图都是横排，真实日漫大量是竖排。`group_bubbles()` 里有竖排分支（按单行宽高比判定 + 按 x 降序排列），但没用真实竖排素材测过
2. **原文是白底覆盖，不是 inpainting** —— 讲究的话要抠掉原文再贴字，工作量不小
3. **单次锁定，不跟随滚动** —— 页面滚动后气泡不会自动刷新位置。用户最初设想里提过"锁定后动了位置，气泡保留原位"，目前行为已符合（气泡固定在屏幕绝对坐标），但"自动追踪漂移"没做
4. **体感速度还能优化** —— 曾讨论过的方向：流式显示（OCR 出结果就先显示占位框，翻译完一个填一个）、OCR 模型启动时预热（现在第一次锁定要等模型加载）

---

## 测试时的注意事项

开发过程中用 Python + ctypes 写过一些自动化脚本（模拟鼠标点击、拖拽、截图）来验证 UI，放在 scratchpad 目录里，**没有提交到项目**。

**重要教训**：如果用户正在用电脑，不要用合成鼠标事件做自动化测试——会和用户的实际操作冲突，测试结果也不可靠（曾经因此误判为代码 bug，实际是鼠标控制权被抢）。UI 交互类的验证最好让用户手动试。

后端逻辑的验证不受此限，可以直接用 HTTP 请求测 `/translate` 端点。





