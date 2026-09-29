// Localize application chrome only. OCR text, translations and input values are excluded.
(() => {
  const messages = Object.fromEntries(`
译窗|Inazuma
漫画翻译工具栏|Manga translation toolbar
漫画翻译选区|Manga translation region
拖动工具栏 · 四角调整选区|Drag toolbar · Resize region corners
选区归位|Recenter
将选区移回当前屏幕|Move the region to this screen
翻译AI配置|Translation AI
翻译AI设置|Translation AI
翻译AI配置：选择服务商、模型和 API Key|Translation AI: provider, model and API key
退出应用|Quit application
再次点击退出应用|Click again to quit
退出?|Quit?
源语言|Source language
目标语言|Target language
日语|Japanese
英语|English
中文|Chinese
韩语|Korean
简体中文|Chinese (S)
繁体中文|Chinese (T)
翻译引擎|Translation provider
翻译选区|Translate region
翻译选区 · Ctrl+Shift+T|Translate region · Ctrl+Shift+T
取消翻译|Cancel
加强 OCR|Enhance OCR
用 Manga OCR 精读这次选区截图中已找到的全部日文气泡，再更新译文|Refine all detected Japanese bubbles with Manga OCR, then update translations
清除|Clear
取消任务并清除译文 · Ctrl+Shift+C|Cancel and clear translations · Ctrl+Shift+C
译文显示方式|Translation display
智能贴合：纯色且能放下时原位显示，其余用旁注|Fit text over plain backgrounds when possible; otherwise use notes
智能贴合|Smart fit
全部旁注|Notes
译文字号|Translation font size
减小译文字号|Decrease translation font size
增大译文字号|Increase translation font size
查看原图|Original
返回译文|Translation
显示原漫画 · Ctrl+Shift+O|Show original manga · Ctrl+Shift+O
锁定选区|Lock region
已锁定选区|Region locked
锁定选区空白区域，避免点到下层网页|Lock the empty region to prevent clicks on the page below
玻璃外观|Glass appearance
通透|Clear
柔和|Soft
阅读模式|Reading mode
固定|Fixed
翻页检测|Page watch
固定选区，手动翻译|Keep region fixed; translate manually
检测翻页，确认后再翻译；不会自动调用翻译|Detect page changes; translate only after confirmation
固定选区，按需翻译|Fixed region; translate on demand
固定位置，手动翻译|Fixed position; translate manually
翻译当前页|Translate page
重试剩余|Retry remaining
恢复上一版|Restore previous
正在启动…|Starting…
暂时无法完成|Unable to complete
关闭提示|Dismiss message
请稍后重试。|Please try again later.
已取消|Cancelled
正在取消…|Cancelling…
继续翻译剩余文字…|Translating remaining text…
正在准备…|Preparing…
翻译未完成|Translation incomplete
未发现文字，请调整选区|No text found. Adjust the region.
已取消加强 OCR|OCR enhancement cancelled
正在加强 OCR…|Enhancing OCR…
加强 OCR 未完成|OCR enhancement incomplete
加强 OCR 完成 · 原文没有变化|OCR enhanced · Source text unchanged
暂无可恢复的上一版|No previous version to restore
已清除|Cleared
检测翻页，确认后再翻译|Detect page changes; confirm to translate
阅读模式切换失败，请重试|Could not switch reading mode. Try again.
选区已移回当前屏幕|Region moved to this screen
请在 翻译AI配置中填写密钥|Enter an API key in Translation AI
普通 OCR 预热中，可开始框选|OCR warming up; you can select a region
日漫精读后台载入中，可开始翻译|Manga OCR loading; translation is available
框选漫画后开始翻译|Select a manga region to translate
先打开 翻译AI配置，连接翻译服务|Open Translation AI to connect a provider
预热失败，翻译时将重试|Warmup failed; will retry when translating
服务不可用|Service unavailable
请选择你的AI LLM服务商，对应模型和API Key|Choose your AI provider, model and API key
连接你的 AI|Connect your AI
让故事，用你熟悉的语言继续|Keep reading in your language
选好服务商和模型，剩下的交给译窗。|Choose a provider and model. Inazuma handles the rest.
关闭设置|Close settings
AI 服务商|AI provider
未连接|Not connected
未配置|Not configured
已配置|Configured
模型与密钥|Model and API key
翻译模型|Translation model
↻ 同步可用模型|↻ Sync models
向所选服务商读取账户可用模型，不发送翻译内容|Fetch available models from this provider without sending translation content
正在载入…|Loading…
自定义模型名称|Custom model name
输入完整模型 ID，例如 gpt-6-luna|Enter the full model ID, e.g. gpt-6-luna
正在读取模型列表…|Loading models…
保存在本机|Stored locally
粘贴服务商的 API Key|Paste your provider API key
显示密钥|Show API key
隐藏密钥|Hide API key
显示|Show
隐藏|Hide
密钥使用系统加密保存，仅用于连接所选服务商。|Your key is encrypted by the operating system and used only with the selected provider.
API 地址已自动匹配|API endpoint set automatically
正在读取设置…|Loading settings…
保存后立即生效|Applies immediately
取消|Cancel
保存并使用|Save & use
手动输入模型名称…|Enter a model name…
已同步账户可用文本模型；服务商未提供的发布日期不作推断。|Account text models synced. Release dates are shown only when provided.
已保存密钥 · 留空沿用，输入可替换|Key saved · Leave blank to keep it, or enter a replacement
密钥已保存|Key saved
正在连接服务商，读取可用模型…|Connecting to the provider and fetching models…
同步中…|Syncing…
已连接，但未发现适用的文本模型。可以手动填写模型名称。|Connected, but no suitable text models were found. Enter a model name manually.
正在保存…|Saving…
保存中…|Saving…
设置读取失败，请关闭窗口后重新打开。|Could not load settings. Close and reopen this window.
轻量 · 推荐|Lightweight · Recommended
最新 · 推荐|Latest · Recommended
均衡|Balanced
高能力|High capability
最新|Latest
轻量|Lightweight
推荐|Recommended
近期|Recent
账户可用|Available to your account
日期未提供|Date unavailable
近期 · 账户可用|Recent · Available to your account
账户可用 · 日期未提供|Available to your account · Date unavailable
请选择 OpenAI、Gemini 或 DeepSeek|Choose OpenAI, Gemini or DeepSeek
请填写有效的模型名称（最多 128 个字符）|Enter a valid model name (up to 128 characters)
请输入有效的 API Key，不要包含空格或换行|Enter a valid API key without spaces or line breaks
有密钥无法解密，请为对应服务商重新输入。|A saved key could not be decrypted. Enter it again for that provider.
无法读取已保存的 翻译AI配置，请重新配置。|Could not read saved AI settings. Please configure them again.
系统密钥加密暂不可用，请稍后重试|System key encryption is unavailable. Try again later.
无法保存 翻译AI配置，请检查应用数据目录的写入权限|Could not save AI settings. Check access to the application data folder.
连接失败或超时，请检查网络后重试|Connection failed or timed out. Check your network and try again.
密钥无效或没有权限，请检查 API Key|Invalid key or access denied. Check your API key.
服务商暂时限流，请稍后重试|Provider rate limit reached. Try again later.
服务商返回的模型列表无效，请稍后重试|The provider returned an invalid model list. Try again later.
单条校正|Bubble correction
编辑与重新翻译|Edit and retranslate
关闭编辑|Close editor
修改这一条的识别文字，再使用原翻译服务保存。|Correct this bubble's source text, then save using its original translation provider.
已保存的截图|Saved screenshot
识别此条时的画面|Image used to recognize this bubble
此条原文的已保存截图|Saved image of this bubble's source text
正在读取截图…|Loading screenshot…
识别原文|Recognized text
可在这里修正错字|Correct recognition errors here
当前译文|Current translation
上次译文（原文已改，尚未重新翻译）|Previous translation (source changed; not yet retranslated)
重新识别截图|Run OCR again
日漫精读|Manga OCR
翻译并保存|Translate & save
原文|Source
译文|Translation
编辑|Edit
对照原文，也可双击译文|Compare source text, or double-click the translation
修正原文、重新识别或翻译|Correct source text, rerun OCR or translate again
编辑此条译文|Edit this translation
关闭此译文|Dismiss this translation
操作失败，请重试。|Operation failed. Please try again.
日漫精读仅支持日文气泡；请选日语并重新翻译选区。|Manga OCR supports Japanese bubbles only. Select Japanese and translate the region again.
此条截图已不可用；可直接编辑原文。|This screenshot is unavailable. You can edit the source text directly.
日漫精读模型正在后台加载；可点击尝试，未就绪时会提示重试。|Manga OCR is loading in the background. You can try it now; retry if it is not ready.
日漫精读模型未安装；请按 README 安装可选模型并重启。|Manga OCR is not installed. Follow the README to install the optional model and restart.
日漫精读模型启动失败；请检查模型安装后重启。|Manga OCR failed to start. Check the model installation and restart.
用 Manga OCR 识别已保存的气泡截图|Run Manga OCR on the saved bubble screenshot
日漫精读状态暂时不可用；可继续手动编辑原文。|Manga OCR status is unavailable. You can still edit the source text manually.
正在读取已保存的识别结果…|Loading saved recognition results…
此条截图已不可用，可直接编辑原文。|This screenshot is unavailable. Edit the source text directly.
可点击「日漫精读」；模型状态正在确认。|You can try Manga OCR while its status is being checked.
无法读取已保存的截图|Could not load the saved screenshot
正在重新识别已保存的截图…|Running OCR on the saved screenshot…
识别完成。检查原文后，点击「翻译并保存」。|OCR complete. Check the source text, then click Translate & save.
此条保存的截图已不可用，可手动修改原文。|This saved screenshot is unavailable. Edit the source text manually.
正在用 Manga OCR 精读已保存的气泡截图…|Running Manga OCR on the saved bubble screenshot…
未识别到文字，请保持原文或手动修改。|No text recognized. Keep the original or edit it manually.
精读完成。请核对原文，再点击「翻译并保存」。|Manga OCR complete. Check the source text, then click Translate & save.
请先填写要翻译的原文。|Enter the source text to translate first.
正在使用原翻译服务翻译这一条…|Translating this bubble with its original provider…
返回的译文不属于这一条，请重试。|The returned translation belongs to another bubble. Try again.
拖动调整选区|Drag to resize the region
正在连接翻译服务…|Connecting to translation service…
正在补译剩余内容…|Translating remaining bubbles…
正在识别文字…|Recognizing text…
正在检测翻页|Watching for page changes
操作完成后继续检测翻页|Page detection resumes after this operation
画面已稳定，点击翻译新页|Page is stable. Click to translate it.
画面变化，旧译文已隐藏|Page changed; previous translations hidden
选区已移动，停稳后可重新翻译|Region moved; translate again once it stops
暂时无法检测画面，可手动翻译选区|Page detection is unavailable. Translate the region manually.
已有翻译任务正在进行|A translation is already in progress
已有翻译任务正在进行，请稍候|A translation is in progress. Please wait.
请先完成或关闭 翻译AI配置|Finish or close Translation AI first
请先完成或关闭单条编辑|Finish or close the bubble editor first
请先关闭单条编辑，再打开 翻译AI配置|Close the bubble editor before opening Translation AI
设置窗口已关闭，请重新打开|Settings window closed. Open it again.
请等待当前翻译完成，或取消翻译后再保存设置|Wait for the current translation or cancel it before saving settings
画面已变化，请翻译新页；补译使用的是上一张截图|The page changed. Translate the new page; retry uses the previous screenshot.
没有可补译的任务，请重新翻译选区|Nothing to retry. Translate the region again.
翻译连接中断，可补译剩余内容|Translation connection lost. You can retry the remaining text.
翻译超时，可补译剩余内容|Translation timed out. You can retry the remaining text.
这条译文的截图已过期，请重新翻译选区|This screenshot has expired. Translate the region again.
请先翻译当前选区|Translate the current region first
加强 OCR 目前只支持日文选区|Enhanced OCR currently supports Japanese only
选区或画面已变化，请重新翻译选区|The region or page changed. Translate the region again.
当前选区没有可精读的气泡|No bubbles in this region can be refined
当前选区气泡过多，请缩小选区|Too many bubbles. Select a smaller region.
加强 OCR 失败，请重试|OCR enhancement failed. Try again.
翻译条数与精读原文不一致，请重试|Translation count does not match the refined source. Try again.
翻译结果与精读原文不对应，请重试|Translation does not match the refined source. Try again.
气泡已变化，请重新翻译选区后再加强 OCR|Bubbles changed. Translate the region again before enhancing OCR.
加强 OCR 超时，请重试|OCR enhancement timed out. Try again.
单条处理失败，请检查原文后重试|Bubble processing failed. Check the source and try again.
这条译文已变化，请重新打开编辑|This translation changed. Reopen the editor.
翻译返回的原文与当前气泡不一致，请重试|The returned source does not match this bubble. Try again.
选区在屏幕外，请重新框选|The region is outside the screen. Select it again.
无法截取屏幕，请检查屏幕录制权限|Could not capture the screen. Check screen recording permissions.
端口上是旧版服务，请退出旧版应用后重试|An older service is running. Close the older app and try again.
端口被旧版服务占用，请退出旧版应用后重试|An older service is using the port. Close the older app and try again.
后端启动超时，请检查 Python 环境后重启|Backend startup timed out. Check the Python environment and restart.
内置识别服务启动失败，请重新安装应用|The bundled OCR service failed to start. Reinstall the app.
Python 启动失败，请按 README 安装后端环境|Python failed to start. Set up the backend as described in README.
后端已停止，请重启应用|The backend stopped. Restart the app.
连续阅读需要 Windows 10 2004 或更新版本|Page watching requires Windows 10 2004 or later
当前系统不支持无闪烁的连续阅读|This system does not support flicker-free page watching
请求参数无效，请检查语言、模型和输入内容|Invalid request. Check the language, model and input.
请打开 翻译AI配置，为所选服务商填写 API Key|Open Translation AI and enter a key for the selected provider
选区过大，请缩小到 1200 万像素以内|Region too large. Reduce it to under 12 million pixels.
截图无效，请重新框选|Invalid screenshot. Select the region again.
原选区的识别缓存已失效，请重新翻译整个选区后再补翻气泡|Recognition cache expired. Translate the full region before retrying bubbles.
文字区域过多，请缩小选区|Too many text regions. Select a smaller area.
气泡编号与原选区不匹配，请重新翻译整个选区|Bubble IDs do not match. Translate the full region again.
翻译服务响应超时，请重试或更换引擎|Translation timed out. Retry or choose another provider.
翻译服务拒绝访问，请检查 API key|Translation access denied. Check your API key.
翻译服务限流，请稍后重试或更换引擎|Translation rate limit reached. Retry later or switch providers.
识别或翻译失败，请检查网络、模型和引擎配置后重试|OCR or translation failed. Check your network, model and provider settings.
识别服务忙，请稍后重试|OCR service busy. Try again shortly.
日漫精读仅支持日文原文|Manga OCR supports Japanese text only
尚未安装日漫精读模型|Manga OCR model is not installed
日漫精读模型正在后台载入，请稍候重试|Manga OCR is loading. Try again shortly.
日漫精读模型启动失败，请重启应用|Manga OCR failed to start. Restart the app.
翻译服务忙，请稍后重试|Translation service busy. Try again shortly.
翻译条数与原文不一致，请重试|Translation count does not match the source. Try again.
上一项任务正在结束，请稍后重试|The previous task is finishing. Try again shortly.
日漫精读模型启动失败，请检查可选依赖和模型缓存|Manga OCR failed to start. Check optional dependencies and the model cache.
日漫精读模型未就绪，请检查安装后重启应用|Manga OCR is not ready. Check its installation and restart.
日漫精读未返回有效文字，请重试|Manga OCR returned no valid text. Try again.
日漫精读响应超时，请重试|Manga OCR timed out. Try again.
日漫精读进程已停止，请重试|The Manga OCR process stopped. Try again.
翻译响应过大|Translation response too large
连接提前结束，请重试；已完成的译文已保留|Connection ended early. Retry; completed translations have been preserved.
翻译返回空内容或格式错误，请重试|Translation returned empty or malformed content. Try again.
翻译响应不完整，请重试|Incomplete translation response. Try again.
翻译返回多余条目，请重试|Translation returned extra entries. Try again.
翻译结果与原文对应错误，请重试|Translations do not match their source text. Try again.
翻译服务拒绝了这段内容，请修改原文或更换引擎|The provider rejected this content. Edit the source or switch providers.
翻译必须返回一条非空结果，请重试|Expected one nonempty translation. Try again.
翻译响应缺少气泡，请重试|Translation response is missing bubbles. Try again.
翻译返回空内容，请重试|Translation returned no content. Try again.
`.trim().split('\n').map(line => line.split('|')));
  const patterns = [
    [/^翻译服务错误 \((\d+)\)$/, 'Translation service error ($1)'],
    [/^本页完成 (\d+) \/ (\d+)$/, 'Completed $1 / $2'],
    [/^字号 (\d+)%$/, 'Font size $1%'],
    [/^编辑第 (\d+) 条译文$/, 'Edit translation $1'],
    [/^译文 (\d+)$/, 'Translation $1'],
    [/^近三个月文本模型 · 官方核对 (.+)$/, 'Recent text models · Checked $1'],
    [/^粘贴 (.+) 的 API Key$/, 'Paste your $1 API key'],
    [/^连接成功 · 已同步 (\d+) 个模型。模型实际可用性以翻译请求为准。$/, 'Connected · $1 models synced. Model access is confirmed when translating.'],
    [/^获取模型失败（(\d+)），可继续使用预置模型或手动输入$/, 'Could not fetch models ($1). Use a preset or enter a model manually.'],
    [/^已切换 (.+)$/, 'Switched to $1'],
    [/^正在翻译 (\d+)\/(\d+)…$/, 'Translating $1/$2…'],
    [/^正在精读气泡 (\d+)\/(\d+)…$/, 'Refining bubble $1/$2…'],
    [/^识别到 (\d+) 处，正在翻译…$/, '$1 regions found. Translating…'],
    [/^已精读 (\d+) 处，正在翻译 (\d+) 条更新的原文…$/, 'Refined $1 regions. Translating $2 updated sources…'],
    [/^第 (\d+) 条气泡未识别到文字，原有译文已保留$/, 'No text found in bubble $1. Previous translations preserved.'],
    [/^正在精读…已等待 (\d+) 秒，可点取消关闭。$/, 'Refining… $1 s elapsed. Click Cancel to close.'],
    [/^加强 OCR 完成 · 更新 (\d+) 处$/, 'OCR enhanced · $1 regions updated'],
    [/^已恢复上一版 · (\d+) 处$/, 'Previous version restored · $1 regions'],
    [/^已复用 · (\d+) 处$/, 'Reused · $1 regions'],
    [/^(\d+) 处(?: · ([\d.]+) 秒)?$/, (_, count, seconds) => `${count} regions${seconds ? ` · ${seconds} s` : ''}`],
    [/^识别 (\d+) ms \/ 翻译 (\d+) ms$/, 'OCR $1 ms / Translation $2 ms'],
  ];
  function english(source) {
    if(Object.hasOwn(messages, source)) return messages[source];
    for(const [pattern, replacement] of patterns) if(pattern.test(source)) return source.replace(pattern, replacement);
    // Model labels and document titles join a fixed name with localized metadata.
    if(source.includes(' · ')) return source.split(' · ').map(part => english(part)).join(' · ');
    return source;
  }
  const key = 'inazuma-ui-language';
  let locale = localStorage.getItem(key) === 'en' ? 'en' : 'zh-CN';
  const roots = '#toolbar, .titlebar, .intro, #settings-form, #bubble-editor, #progress, .controls, .selection-label, .grip, title';
  const excluded = '.copy, #editor-translation, #editor-provider, #endpoint, script, style, [data-language-toggle]';
  const records = new WeakMap();
  function translateValue(node, attribute, current) {
    let values = records.get(node);
    if(!values) {values = new Map(); records.set(node, values);}
    let record = values.get(attribute);
    if(!record || current !== record.output) record = {source: current, output: current};
    const trimmed = record.source.trim();
    const output = locale === 'en' ? record.source.replace(trimmed, english(trimmed)) : record.source;
    record.output = output; values.set(attribute, record);
    if(current !== output) {
      if(attribute === 'text') node.nodeValue = output;
      else node.setAttribute(attribute, output);
    }
  }
  function render(root) {
    if(root.nodeType === Node.TEXT_NODE) {
      const parent = root.parentElement;
      if(parent?.closest(roots) && !parent.closest(`${excluded}, textarea, input`)) translateValue(root, 'text', root.nodeValue);
      return;
    }
    if(root.nodeType !== Node.ELEMENT_NODE && root !== document) return;
    if(root.nodeType === Node.ELEMENT_NODE) {
      if(root.matches(excluded)) return;
      if(root.closest(roots)) for(const attribute of ['title', 'aria-label', 'placeholder', 'alt']) {
        if(root.hasAttribute(attribute)) translateValue(root, attribute, root.getAttribute(attribute));
      }
    }
    for(const child of root.childNodes) render(child);
  }
  function apply() {
    document.documentElement.lang = locale;
    render(document);
    for(const button of document.querySelectorAll('[data-language-toggle]')) {
      button.textContent = locale === 'en' ? '中文' : 'EN';
      button.setAttribute('aria-label', locale === 'en' ? 'Switch to Chinese' : 'Switch to English');
      button.title = button.getAttribute('aria-label');
    }
  }
  const observer = new MutationObserver(changes => {
    // Only changed UI nodes are visited; never poll or repeatedly scan manga text.
    for(const change of changes) {
      if(change.type === 'childList') for(const node of change.addedNodes) render(node);
      else render(change.target);
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    for(const button of document.querySelectorAll('[data-language-toggle]')) button.addEventListener('click', () => {
      locale = locale === 'en' ? 'zh-CN' : 'en'; localStorage.setItem(key, locale); apply();
    });
    apply();
    observer.observe(document.documentElement, {subtree:true, childList:true, characterData:true,
      attributes:true, attributeFilter:['title', 'aria-label', 'placeholder', 'alt']});
  });
  window.addEventListener('storage', event => {
    if(event.key === key) {locale = event.newValue === 'en' ? 'en' : 'zh-CN'; apply();}
  });
})();
