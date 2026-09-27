// Compare downsampled selection pixels, never run OCR or paid translation here.
function difference(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 20) changed++;
  return changed / a.length;
}

class ReadingWatch {
  constructor(stableMs = 1000) { this.stableMs = stableMs; this.reset(); }
  reset() { this.reference = null; this.last = null; this.state = 'watching'; this.lastChange = 0; this.invalidated = false; }
  invalidate() { this.invalidated = true; this.state = 'watching'; }
  accept(sample) { this.reference = Buffer.from(sample); this.last = Buffer.from(sample); this.state = 'watching'; this.lastChange = 0; this.invalidated = false; }
  observe(sample, now = Date.now()) {
    if (!this.reference && !this.invalidated) { this.accept(sample); return {state:'watching', stale:false}; }
    if (!this.invalidated && difference(this.reference, sample) < .055) {
      const wasChanged = this.state !== 'watching';
      this.state = 'watching'; this.last = Buffer.from(sample);
      return wasChanged ? {state:'watching', stale:false} : null;
    }
    const moving = difference(this.last, sample) > .025;
    this.last = Buffer.from(sample);
    if (this.state === 'watching' || moving) {
      this.lastChange = now;
      const previous = this.state;
      this.state = 'changed';
      return previous !== 'changed' ? {state:'changed', stale:true} : null;
    }
    if (this.state !== 'stable' && now - this.lastChange >= this.stableMs) {
      this.state = 'stable'; return {state:'stable', stale:true};
    }
    return null;
  }
}

module.exports = {ReadingWatch, difference};
