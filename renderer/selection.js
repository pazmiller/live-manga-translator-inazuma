let resize = null;
let pending = null;
let raf = 0;
let resizeToken = 0;

function updateSelection(data = {}) {
  const width = data.width ?? Math.max(0, window.innerWidth - 12);
  const height = data.height ?? Math.max(0, window.innerHeight - 12);
  document.getElementById('dimensions').textContent = `${Math.round(width)} × ${Math.round(height)}`;
  if (data.readingMode) document.getElementById('selectionMode').textContent = data.readingMode === 'watch' ? '翻页检测' : '固定';
  if (typeof data.stale === 'boolean') document.body.classList.toggle('stale', data.stale);
}
window.api.onSelectionState?.(updateSelection);
window.api.onOverlayPreferences?.(preferences => {
  document.documentElement.dataset.glassTone = preferences.glassTone === 'tinted' ? 'tinted' : 'clear';
});
window.addEventListener('resize', () => updateSelection());
updateSelection();

function flush() {
  raf = 0;
  if (pending) {
    window.api.resizeTo(...pending);
    pending = null;
  }
}
function endResize() {
  resizeToken++;
  resize = null;
  if (raf) cancelAnimationFrame(raf);
  flush();
  document.body.classList.remove('resizing');
  window.api.dragging(false);
}

for (const grip of document.querySelectorAll('.grip')) {
  grip.addEventListener('pointerdown', async event => {
    if (event.button !== 0) return;
    const token = ++resizeToken;
    grip.setPointerCapture(event.pointerId);
    window.api.dragging(true);
    document.body.classList.add('resizing');
    event.preventDefault();
    try {
      const bounds = await window.api.getBounds();
      if (token !== resizeToken) return;
      resize = { ...bounds, startX: event.screenX, startY: event.screenY, anchor: grip.dataset.anchor };
    } catch { if (token === resizeToken) endResize(); }
  });
  grip.addEventListener('lostpointercapture', endResize);
}
document.addEventListener('pointermove', event => {
  if (!resize) return;
  const dx = event.screenX - resize.startX;
  const dy = event.screenY - resize.startY;
  const west = resize.anchor.includes('w');
  const north = resize.anchor.includes('n');
  const width = Math.max(64, Math.round(resize.width + (west ? -dx : dx)));
  const height = Math.max(64, Math.round(resize.height + (north ? -dy : dy)));
  pending = [west ? resize.x + resize.width - width : resize.x,
    north ? resize.y + resize.height - height : resize.y, width, height, resize.anchor];
  if (!raf) raf = requestAnimationFrame(flush);
});
document.addEventListener('pointerup', endResize);
document.addEventListener('pointercancel', endResize);
window.addEventListener('blur', endResize);
