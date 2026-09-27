// Stream framing and physical-pixel -> display-coordinate conversion are shared
// by the native capture path and the deterministic integration tests.
async function readEvents(response, onEvent) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `翻译服务错误 (${response.status})`);
  }
  const decoder = new TextDecoder();
  let pending = '';
  let complete = false;
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, {stream:true});
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).trim();
      pending = pending.slice(end + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'done') complete = true;
      await onEvent(event);
    }
    if (pending.length > 4_000_000) throw new Error('翻译响应过大');
  }
  if (!complete) throw new Error('连接提前结束，请重试；已完成的译文已保留');
}

function localBubble(b, capture) {
  const {rect, display, scale} = capture;
  const x = rect.x-display.bounds.x, y = rect.y-display.bounds.y;
  const convert = r => ({x:x+r.x/scale, y:y+r.y/scale, w:r.w/scale, h:r.h/scale});
  return {...b, ...convert(b), masks:(b.masks || []).map(convert)};
}

function intersect(a, b) {
  const x = Math.max(a.x,b.x), y = Math.max(a.y,b.y);
  return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),
              height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};
}

module.exports = {readEvents, localBubble, intersect};
