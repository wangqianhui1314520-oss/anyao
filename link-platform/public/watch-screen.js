(function () {
  'use strict';

  // A local, animated canvas texture. It never opens a device session.
  const DIAL = 466;
  const TAU = Math.PI * 2;
  const C = { white: '#f6f7f8', muted: '#92969a', faint: '#53575d', green: '#8ff6d3', orange: '#ff9e56', blue: '#73b7ff' };
  const FONT = '"MiSans", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad = n => String(n).padStart(2, '0');

  class WatchS3Screen {
    constructor({ size = 932, onOpenPhone, onViewChange, onTap } = {}) {
      this.onTap = onTap;
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvas.height = clamp(Number(size) || 932, 466, 1864);
      this.canvas.setAttribute('aria-label', 'Watch S3 屏幕交互演示');
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.onOpenPhone = onOpenPhone;
      this.onViewChange = onViewChange;
      this.mode = 'face';
      this.context = {};
      this.live = { med: '—', dose: '', time: '--:--', confirmedAt: '--:--', battery: 78, connected: true, steps: 6428 };
      this.lastPaint = -Infinity;
      this.changedAt = performance.now();
      this.toastUntil = 0;
      this.dirty = true;
      this.disposed = false;
      this.motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.reducedMotion = Boolean(this.motionQuery && this.motionQuery.matches);
      this.motionListener = event => { this.reducedMotion = event.matches; this.dirty = true; };
      if (this.motionQuery && this.motionQuery.addEventListener) this.motionQuery.addEventListener('change', this.motionListener);
      this.tick(this.changedAt);
    }

    setLive(live = {}) {
      const next = { ...this.live, ...live };
      if (JSON.stringify(next) !== JSON.stringify(this.live)) { this.live = next; this.dirty = true; }
    }

    setContext(context = {}) {
      const signature = JSON.stringify([context.unitId, context.stepIndex, context.watch, context.phone, context.box]);
      if (signature === this.contextSignature) return;
      this.contextSignature = signature;
      this.context = context;
      const unit = context.unitId;
      const step = Number(context.stepIndex) || 0;
      let mode = 'face';
      if (unit === 'connect') mode = 'connection';
      else if (unit === 'remind' && step === 1) mode = 'notification';
      else if (unit === 'remind' && step === 2) mode = 'concept';
      else if (unit === 'confirm') mode = step === 0 ? 'notification' : 'records';
      else if (unit === 'special' && step === 1) mode = 'concept';
      this.setMode(mode, true);
    }

    setMode(mode, force = false) {
      const valid = ['face', 'notification', 'connection', 'records', 'confirm', 'concept'];
      if (!valid.includes(mode) || (!force && mode === this.mode)) return;
      this.mode = mode;
      this.changedAt = performance.now();
      this.toastUntil = 0;
      this.dirty = true;
      if (typeof this.onViewChange === 'function') this.onViewChange(mode);
    }

    tick(timestamp) {
      if (this.disposed) return false;
      const now = Number.isFinite(timestamp) ? timestamp : performance.now();
      // Some consumers pass a wall-clock timestamp rather than requestAnimationFrame time.
      const t = now > 1e11 ? performance.now() : now;
      const interval = this.reducedMotion ? 1000 : this.mode === 'face' || this.mode === 'notification' || this.mode === 'concept' ? 40 : 120;
      const entering = !this.reducedMotion && t - this.changedAt < 600;
      const toast = t < this.toastUntil;
      if (!this.dirty && t - this.lastPaint < (entering || toast ? 40 : interval)) return false;
      this.lastPaint = t;
      this.dirty = false;
      const ctx = this.ctx;
      ctx.setTransform(this.canvas.width / DIAL, 0, 0, this.canvas.height / DIAL, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, DIAL, DIAL);
      ctx.save();
      ctx.beginPath();
      ctx.arc(233, 233, 233, 0, TAU);
      ctx.clip();
      const progress = this.reducedMotion ? 1 : clamp((t - this.changedAt) / 480, 0, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      ctx.globalAlpha = ease;
      ctx.translate(0, (1 - ease) * 25);
      const date = new Date();
      if (this.mode === 'face') this.drawFace(date, t);
      else if (this.mode === 'notification') this.drawNotification(date, t);
      else if (this.mode === 'connection') this.drawConnection(date);
      else if (this.mode === 'records') this.drawRecords(date);
      else if (this.mode === 'confirm') this.drawConfirm(date);
      else this.drawConcept(date, t);
      ctx.restore();
      if (toast) this.drawToast(t);
      return true;
    }

    handleTap(nx, ny) {
      if (this.disposed || !Number.isFinite(nx) || !Number.isFinite(ny)) return false;
      const x = nx * DIAL, y = ny * DIAL;
      if (Math.hypot(x - 233, y - 233) > 230) return false;
      if ((this.mode === 'notification' || this.mode === 'confirm') && x > 80 && x < 386 && y > 316 && y < 395) {
        this.toastUntil = performance.now() + 2300;
        this.dirty = true;
        if (typeof this.onOpenPhone === 'function') this.onOpenPhone({ source: 'watch-s3', action: 'open-phone', demo: true });
        return true;
      }
      // 其余点击交给外部（共享状态）决定画面，避免本地画面与手机不一致。
      if (typeof this.onTap === 'function') { this.onTap({ mode: this.mode, top: y < 100 }); return true; }
      return false;
    }

    dispose() {
      this.disposed = true;
      if (this.motionQuery && this.motionQuery.removeEventListener) this.motionQuery.removeEventListener('change', this.motionListener);
      this.onOpenPhone = this.onViewChange = null;
    }

    text(value, x, y, size = 24, color = C.white, weight = 400, align = 'center') {
      const c = this.ctx;
      c.font = `${weight} ${size}px ${FONT}`;
      c.fillStyle = color;
      c.textAlign = align;
      c.textBaseline = 'middle';
      c.fillText(value, x, y);
    }

    roundRect(x, y, w, h, radius, fill, stroke) {
      const c = this.ctx;
      c.beginPath();
      c.roundRect(x, y, w, h, radius);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
    }

    line(x1, y1, x2, y2, color, width = 2) {
      const c = this.ctx;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
      c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.stroke();
    }

    arc(cx, cy, r, from, to, color, width) {
      const c = this.ctx;
      c.beginPath(); c.arc(cx, cy, r, from, to);
      c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.stroke();
    }

    battery(x, y, percent = 78, color = C.muted, small = false) {
      const c = this.ctx, w = small ? 24 : 32, h = small ? 11 : 15;
      this.roundRect(x, y - h / 2, w, h, 3, null, color);
      c.fillStyle = color;
      c.fillRect(x + w + 2, y - 2.5, 2, 5);
      this.roundRect(x + 3, y - h / 2 + 3, (w - 6) * percent / 100, h - 6, 1, color);
    }

    bluetooth(x, y, size = 22, color = C.blue) {
      const c = this.ctx;
      c.save(); c.translate(x, y); c.scale(size / 24, size / 24);
      c.strokeStyle = color; c.lineWidth = 2.3; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(0, -12); c.lineTo(8, -5); c.lineTo(-7, 8); c.moveTo(0, 12); c.lineTo(8, 5); c.lineTo(-7, -8); c.moveTo(0, -12); c.lineTo(0, 12); c.stroke();
      c.restore();
    }

    capsuleIcon(x, y, radius = 27, color = C.green) {
      const c = this.ctx;
      c.fillStyle = color; c.beginPath(); c.arc(x, y, radius, 0, TAU); c.fill();
      c.save(); c.translate(x, y); c.rotate(-Math.PI / 4);
      this.roundRect(-8, -15, 16, 30, 8, '#10251f');
      c.save(); c.beginPath(); c.rect(-10, -18, 20, 18); c.clip();
      this.roundRect(-6, -13, 12, 26, 6, color); c.restore();
      this.line(-6, 0, 6, 0, color, 2);
      c.restore();
    }

    phoneIcon(x, y, color = C.green, scale = 1) {
      const c = this.ctx;
      c.save(); c.translate(x, y); c.scale(scale, scale);
      this.roundRect(-14, -24, 28, 48, 7, null, color);
      this.line(-4, 17, 4, 17, color, 2);
      c.restore();
    }

    header(date, title = '') {
      this.text(`${pad(date.getHours())}:${pad(date.getMinutes())}`, 233, 54, 21, C.white, 500);
      if (title) this.text(title, 233, 89, 17, C.muted);
    }

    demoFooter(label = '演示数据') {
      this.text(label, 233, 414, 15, C.faint, 400);
    }

    drawFace(date) {
      const c = this.ctx;
      // A restrained three-hand dial gives the OLED the same optical depth as a watch face.
      const hours = date.getHours() % 12, minutes = date.getMinutes();
      const seconds = date.getSeconds() + (this.reducedMotion ? 0 : date.getMilliseconds() / 1000);
      for (let i = 0; i < 60; i++) {
        const a = i * TAU / 60 - Math.PI / 2, major = i % 5 === 0;
        const inside = major ? 189 : 203;
        const outer = major ? 210 : 209;
        this.line(233 + Math.cos(a) * inside, 233 + Math.sin(a) * inside,
          233 + Math.cos(a) * outer, 233 + Math.sin(a) * outer, major ? '#bfc3c8' : '#383b40', major ? 4 : 1.5);
      }
      this.text('12', 233, 91, 35, C.white, 500);
      this.text('3', 378, 232, 35, C.white, 500);
      this.text('6', 233, 378, 35, C.white, 500);
      this.text('9', 87, 232, 35, C.white, 500);
      this.text('XIAOMI', 233, 130, 14, C.muted, 600);
      // Two small complications are intentionally marked as demonstration values.
      this.arc(150, 234, 38, -Math.PI * .8, Math.PI * .8, '#1b2825', 5);
      this.arc(150, 234, 38, -Math.PI * .8, -Math.PI * .8 + Math.PI * 1.6 * Math.min(1, this.live.steps / 10000), C.green, 5);
      this.text('步数', 150, 222, 12, C.muted);
      this.text(this.live.steps.toLocaleString('en-US'), 150, 243, 18, C.white, 500);
      this.arc(316, 234, 38, -Math.PI * .8, Math.PI * .8, '#30271e', 5);
      this.arc(316, 234, 38, -Math.PI * .8, -Math.PI * .8 + Math.PI * 1.6 * this.live.battery / 100, C.orange, 5);
      this.battery(304, 221, this.live.battery, C.orange, true);
      this.text(this.live.battery + '%', 316, 245, 18, C.white, 500);
      const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
      this.text(`${pad(date.getMonth() + 1)} / ${pad(date.getDate())}  周${weekdays[date.getDay()]}`, 233, 315, 17, '#b4b8bc', 400);
      const hand = (angle, length, width, color, tail = 0) => {
        const a = angle - Math.PI / 2;
        c.save(); c.translate(233, 233); c.rotate(a);
        c.shadowColor = '#000'; c.shadowBlur = 6;
        this.line(-tail, 0, length, 0, color, width);
        c.restore();
      };
      hand((hours + minutes / 60) * TAU / 12, 100, 10, '#d9dde0', 17);
      hand((minutes + seconds / 60) * TAU / 60, 154, 7, '#f8f9fa', 21);
      hand(seconds * TAU / 60, 179, 2, C.orange, 38);
      c.beginPath(); c.arc(233, 233, 8, 0, TAU); c.fillStyle = C.orange; c.fill();
      c.beginPath(); c.arc(233, 233, 3, 0, TAU); c.fillStyle = '#1d1d1d'; c.fill();
      // A very small notification dot also makes the dial tappable without adding a fake OS button.
      c.beginPath(); c.arc(233, 426, 3, 0, TAU); c.fillStyle = C.green; c.fill();
    }

    drawNotification(date, t) {
      this.header(date);
      const pulse = this.reducedMotion ? 0 : (Math.sin(t / 690) + 1) / 2;
      this.ctx.globalAlpha *= .07 + pulse * .08;
      this.ctx.fillStyle = C.green;
      this.ctx.beginPath(); this.ctx.arc(233, 111, 36 + pulse * 3, 0, TAU); this.ctx.fill();
      this.ctx.globalAlpha /= .07 + pulse * .08;
      this.capsuleIcon(233, 111, 27);
      this.text('安药', 233, 159, 20, C.muted, 400);
      this.text('用药提醒', 233, 202, 35, C.white, 600);
      this.text(`${this.live.med}  ${this.live.dose}`, 233, 247, 26, C.white, 400);
      this.text(`计划 ${this.live.time}`, 233, 287, 23, C.muted);
      this.roundRect(83, 326, 300, 62, 31, '#242628');
      this.text('在手机上打开', 233, 357, 25, C.white, 500);
    }

    drawConnection(date) {
      this.header(date, '设备信息');
      this.ctx.fillStyle = '#142338'; this.ctx.beginPath(); this.ctx.arc(233, 147, 37, 0, TAU); this.ctx.fill();
      this.bluetooth(233, 147, 34);
      this.text('Xiaomi Watch S3', 233, 210, 28, C.white, 500);
      this.roundRect(174, 239, 118, 31, 15, '#102820');
      this.ctx.fillStyle = C.green; this.ctx.beginPath(); this.ctx.arc(190, 254, 3, 0, TAU); this.ctx.fill();
      this.text(this.live.connected ? '已连接' : '未连接', 240, 254, 17, C.green);
      this.text('M2313W1', 233, 298, 20, C.muted);
      this.battery(185, 340, this.live.battery, C.white);
      this.text(this.live.battery + '%', 253, 341, 25, C.white, 500);
    }

    drawRecords(date) {
      this.header(date, '手机记录');
      this.ctx.fillStyle = '#13271f'; this.ctx.beginPath(); this.ctx.arc(233, 146, 32, 0, TAU); this.ctx.fill();
      this.line(218, 146, 229, 157, C.green, 4);
      this.line(229, 157, 249, 135, C.green, 4);
      this.text('本人已确认', 233, 209, 31, C.white, 500);
      this.text(`${this.live.med}  ${this.live.dose}`, 233, 254, 25, C.white);
      this.roundRect(107, 291, 252, 70, 19, '#151719');
      this.text('实际确认', 175, 326, 18, C.muted);
      this.text(this.live.confirmedAt, 288, 327, 27, C.white, 500);
    }

    drawConfirm(date) {
      this.header(date, '安药');
      this.phoneIcon(233, 155, C.green, 1.25);
      this.text('请在手机确认', 233, 233, 32, C.white, 500);
      this.text('核对本次用药计划', 233, 280, 23, C.muted);
      this.roundRect(83, 326, 300, 62, 31, '#242628');
      this.text('在手机上打开', 233, 357, 25, C.white, 500);
    }

    drawConcept(date, t) {
      const privacy = this.context.unitId === 'remind';
      this.header(date, '设计演示');
      const c = this.ctx;
      const pulse = this.reducedMotion ? .5 : (Math.sin(t / 1000) + 1) / 2;
      c.fillStyle = '#151f2c'; c.beginPath(); c.arc(233, 153, 43, 0, TAU); c.fill();
      c.save(); c.translate(233, 153); c.rotate(-.3);
      c.fillStyle = C.blue; c.beginPath(); c.arc(0, 0, 22, 0, TAU); c.fill();
      c.fillStyle = '#151f2c'; c.beginPath(); c.arc(10, -7, 21, 0, TAU); c.fill();
      c.restore();
      if (!privacy) this.arc(233, 153, 52 + pulse * 4, -Math.PI * .8, Math.PI * .2, `rgba(115,183,255,${.15 + pulse * .2})`, 2);
      this.text(privacy ? '待办提醒' : '小睡后接续提醒', 233, 233, privacy ? 35 : 30, C.white, 500);
      this.text(privacy ? '有一项计划待查看' : '查看待处理计划', 233, 281, 24, C.muted);
      this.roundRect(156, 331, 154, 37, 18, '#1c2430');
      this.text(privacy ? '隐私文案示意' : '人工模拟醒来', 233, 349, 17, C.blue);
      this.demoFooter('设计演示');
    }

    drawToast(t) {
      const c = this.ctx;
      c.save();
      c.setTransform(this.canvas.width / DIAL, 0, 0, this.canvas.height / DIAL, 0, 0);
      const alpha = this.reducedMotion ? 1 : clamp((this.toastUntil - t) / 280, 0, 1);
      c.globalAlpha = alpha;
      this.roundRect(78, 181, 310, 111, 31, '#2a2d30', '#494c50');
      this.phoneIcon(121, 235, C.green, .65);
      this.text('请在手机确认', 252, 236, 25, C.white, 500);
      c.restore();
    }
  }

  window.WatchS3Screen = WatchS3Screen;
})();
