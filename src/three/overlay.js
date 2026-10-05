// A transparent 2D canvas over the 3D view for crisp interface marks:
// health bars, construction progress and the drag-selection box.

export class Overlay {
  constructor(stage, glCanvas) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay3d';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    glCanvas.after(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /**
   * @param {{x:number,y:number,w:number,pct:number,full:boolean,progress?:number}[]} bars
   *   x/y: screen position of the bar's centre-bottom; w: width in px.
   * @param {{x:number,y:number,w:number,h:number}|null} dragRect
   */
  draw(bars, dragRect) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    for (const b of bars) {
      if (!b.full && b.pct >= 1 && b.progress === undefined) continue;
      const x = Math.round(b.x - b.w / 2);
      const y = Math.round(b.y - 5);
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(x - 1, y - 1, b.w + 2, 6);
      ctx.fillStyle = b.pct > 0.6 ? '#3bd14a' : b.pct > 0.3 ? '#e8c33a' : '#e5412f';
      ctx.fillRect(x, y, Math.max(0, b.w * b.pct), 4);
      if (b.progress !== undefined) {
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(x - 1, y + 6, b.w + 2, 5);
        ctx.fillStyle = '#e6b84f';
        ctx.fillRect(x, y + 7, b.w * b.progress, 3);
      }
    }
    if (dragRect) {
      ctx.strokeStyle = '#7dff8a';
      ctx.fillStyle = 'rgba(125,255,138,0.08)';
      ctx.fillRect(dragRect.x, dragRect.y, dragRect.w, dragRect.h);
      ctx.strokeRect(dragRect.x + 0.5, dragRect.y + 0.5, dragRect.w, dragRect.h);
    }
  }

  dispose() {
    this.canvas.remove();
  }
}
