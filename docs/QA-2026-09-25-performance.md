# 启动与拖动卡顿修复

## 复现与定位

用户报告启动后鼠标和拖动卡顿数秒。独立 Electron 原生 GPU 探针（无 Python / OCR / renderer）调用旧外观路径相同参数的 `desktopCapturer.getSources` 三次：526 / 451 / 492ms。20ms 主线程心跳最大延迟 469ms。整张缩略图 PNG 编码另需 111 / 102 / 108ms；这个编码数字是诊断上界，不是实际裁剪区域的编码时间。桌面图像仅留在内存，没有保存或输出。

旧代码每 150ms 尝试采样；耗时采样完成后又很快开始下一次。移动期间旧结果被丢弃，也会继续重采。已经复现主线程明显阻塞，但没有声称独立探针复现了用户所述每一次数秒停顿。SVG 动画和 OCR 可能叠加负担，本轮未证明它们是独立根因。

## 修复取舍

- 默认不启动外观截图定时器，`canCapture` 同时守卫默认关闭状态。
- 默认保留透明和指针高光，不宣称完整 Liquid Glass / 背景折射。
- 位移贴图改为真实纹理到达后才生成，避免默认缩放操作持续计算 / PNG 编码；无纹理时不更新 SVG 折射参数。
- 旧截图折射仅可通过 `MWT_GLASS_CAPTURE=1` 开发实验启用，卡顿根因在实验路径仍存在。后续需设计低延迟背景来源，不能把 getSources 当作视频流。
- 翻页检测使用的截图路径未改变；本轮性能验收采用默认固定阅读模式。

## 验证

新增 `npm run test:responsive` 使用真实 main/preload/renderer、正常 GPU（gpu_compositing=enabled），无真实翻译请求。窗口始终点击穿透、不获取焦点；程序设置位置 / 大小并发送指针事件，不控制用户系统鼠标。修复前默认启动和移动共触发 14 次外观采样，零采样断言失败。修复后 35 次移动 / 缩放：外观采样 0 次、无位移贴图、主线程心跳最大延迟 12ms。测试加入 200ms 心跳上限。

通过：16 个 Node 测试、`test:glass`、`test:glass:app`、`test:ui`。后三者沿用软件合成测试；正常 GPU 性能覆盖来自新增 responsive 测试。未运行付费翻译；未代替用户手动拖动验收。原生测量可通过 `node tests/run-electron.cjs glass-capture-perf.cjs` 重现（只记录时间，不保存截图）。

按冗余审计检查 main、renderer、测试入口和相关调用：实验路径与普通路径均有用途，未发现安全删除建议。

## 后续：操作面板点击无响应

通过 Windows `WM_NCHITTEST` 原生命中复现：翻译、清除、查看原图、字号、锁定、退出和语言选择位置均返回 `HTCAPTION=2`，点击会被当作窗口拖动，不进入 DOM 按钮处理。隐藏 `.liquid-surface` 和单独关闭 backdrop-filter 均不能恢复；缩小拖动区域可以恢复。不是已证实的穿透状态或 OCR 问题。

修复：移除 `#toolbar` 的整面板 drag 声明，只给 `.heading` 设置 drag，控件继续 no-drag。不要给整个 toolbar 改成 no-drag：实测这会连标题拖动也排除。

新增 `npm run test:input`：真实 main/preload/renderer 和正常 GPU，原生命中断言控件为 `HTCLIENT=1`、标题为 `HTCAPTION=2`；随后使用 renderer 指针事件验证字号、锁定、原图、清除、翻译请求到主进程及受控失败恢复、退出确认。实际 OS 窗口始终穿透且不抢焦点，记录应用请求的穿透状态；不移动或点击用户系统鼠标。测试不会调用真实 OCR 或付费翻译。测试改动前失败，修复后通过。`test:responsive` 再次通过（35 次移动缩放，心跳最大延迟 21ms），`test:ui` 通过。

此前 DOM click / 程序化布局测试绕过了原生非客户区命中；本轮补齐这一验证层，但不声称执行过手动系统鼠标点击。冗余审计覆盖 CSS、HTML 调用位置、测试脚本 / PowerShell helper / package 入口，无安全清理建议。
