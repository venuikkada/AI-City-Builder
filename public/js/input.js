// Mouse, touch and keyboard controls.
// Touch: one finger pans, a tap acts (inspect, place, or mark the ends of a
// road or zone), two fingers pinch-zoom. Mouse and pen: with a build tool, drag
// paints (roads in a line, zones in a rectangle); with Explore, drag pans and a
// click inspects. Right/middle drag always pans; the wheel zooms.

const TAP_SLOP = { touch: 12, mouse: 5 }; // px a pointer may wander and still count as a tap

export class Input {
  constructor(canvas, renderer, handlers) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.h = handlers;
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.drag) this.h.onHover(null);
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  local(e) {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  onDown(e) {
    if (!this.h.isActive()) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y });
    this.h.onPointerType?.(e.pointerType);
    if (this.pointers.size === 2) {
      // Second finger: switch to pinch/pan and drop any half-finished build drag.
      if (this.drag?.mode === 'build') this.h.onBuildCancel();
      this.drag = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;
    const touch = e.pointerType === 'touch';
    const panOnly = e.button === 1 || e.button === 2;
    const tile = this.renderer.screenToTile(x, y);
    if (touch || panOnly || this.h.getTool() === 'inspect' || !tile) {
      this.drag = { mode: 'pan', lastX: x, lastY: y, startX: x, startY: y, moved: false, button: e.button, tile, touch };
      return;
    }
    this.drag = { mode: 'build', start: tile, end: tile };
    this.h.onBuildPreview(tile, tile);
  }

  onMove(e) {
    const [x, y] = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });

    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.renderer.pan(mx - this.pinch.mx, my - this.pinch.my);
      if (this.pinch.dist > 0) this.renderer.zoomAt(dist / this.pinch.dist, mx, my);
      this.pinch = { dist, mx, my };
      return;
    }

    const drag = this.drag;
    if (drag?.mode === 'pan' && this.pointers.has(e.pointerId)) {
      if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) > (drag.touch ? TAP_SLOP.touch : TAP_SLOP.mouse)) {
        drag.moved = true;
        this.h.onPanStart?.();
      }
      // Hold still until the finger has clearly moved, so taps don't nudge the map.
      if (drag.moved || !drag.touch) {
        this.renderer.pan(x - drag.lastX, y - drag.lastY);
        drag.lastX = x;
        drag.lastY = y;
      }
    } else if (drag?.mode === 'build') {
      const tile = this.renderer.screenToTile(x, y);
      if (tile && (tile.x !== drag.end.x || tile.y !== drag.end.y)) {
        drag.end = tile;
        this.h.onBuildPreview(drag.start, tile);
      }
    }
    if (e.pointerType === 'mouse') {
      this.h.onPointerType?.('mouse');
      this.h.onHover(this.renderer.screenToTile(x, y), x, y);
    }
  }

  onUp(e, cancelled = false) {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (drag.mode === 'pan' && !drag.moved && !cancelled && drag.button === 0 && drag.tile) {
      this.h.onTap(drag.tile, drag.touch ? 'touch' : 'mouse');
    }
    if (drag.mode === 'build') {
      if (cancelled) this.h.onBuildCancel();
      else this.h.onBuildCommit(drag.start, drag.end);
    }
  }

  onWheel(e) {
    e.preventDefault();
    const [x, y] = this.local(e);
    this.renderer.zoomAt(Math.exp(-e.deltaY * 0.0015), x, y);
  }

  onKey(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (!this.h.isActive()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.h.onUndo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = 60;
    const r = this.renderer;
    const [cx, cy] = r.viewCenter();
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
        r.pan(0, step);
        break;
      case 'ArrowDown':
      case 's':
        r.pan(0, -step);
        break;
      case 'ArrowLeft':
      case 'a':
        r.pan(step, 0);
        break;
      case 'ArrowRight':
      case 'd':
        r.pan(-step, 0);
        break;
      case '+':
      case '=':
        r.zoomAt(1.2, cx, cy);
        break;
      case '-':
      case '_':
        r.zoomAt(1 / 1.2, cx, cy);
        break;
      case 'Escape':
        this.h.onEscape();
        break;
      case ' ':
        if (!e.repeat) this.h.onTogglePause();
        break;
      case '0':
      case '1':
      case '2':
      case '3':
        this.h.onSpeed(Number(e.key));
        break;
      case 'b':
        this.h.onShortcut('bulldoze');
        break;
      case 'r':
        this.h.onShortcut('road');
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
