// DOM side panel: resources, selection info, command card, tooltips and
// on-screen messages.

import { PLAYER, UNITS, RESEARCH, TEAM_COLORS } from './config.js';
import { drawUnitIcon, drawBuildingIcon, makeCanvas } from './sprites.js';
import { formatTime } from './util.js';

const iconCache = new Map();

function iconURL(icon, owner = PLAYER, size = 48) {
  const key = `${icon.kind}:${icon.type}:${owner}:${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  if (icon.kind === 'unit') drawUnitIcon(ctx, icon.type, owner, size);
  else if (icon.kind === 'building') drawBuildingIcon(ctx, icon.type, owner, size);
  else drawGlyph(ctx, icon.type, size);
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

function drawGlyph(ctx, type, S) {
  ctx.save();
  ctx.scale(S / 48, S / 48);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const steel = '#d9dde2';
  const wood = '#8a5f37';
  const gold = '#e8c33a';
  const team = TEAM_COLORS[PLAYER].main;
  const line = (pts, color, w) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  };
  const shield = (x, y, s, color) => {
    ctx.fillStyle = '#bfc4ca';
    ctx.beginPath();
    ctx.moveTo(x - 11 * s, y - 12 * s);
    ctx.lineTo(x + 11 * s, y - 12 * s);
    ctx.lineTo(x + 11 * s, y);
    ctx.quadraticCurveTo(x + 10 * s, y + 10 * s, x, y + 15 * s);
    ctx.quadraticCurveTo(x - 10 * s, y + 10 * s, x - 11 * s, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 8 * s, y - 9 * s);
    ctx.lineTo(x + 8 * s, y - 9 * s);
    ctx.lineTo(x + 8 * s, y);
    ctx.quadraticCurveTo(x + 7 * s, y + 8 * s, x, y + 11 * s);
    ctx.quadraticCurveTo(x - 7 * s, y + 8 * s, x - 8 * s, y);
    ctx.closePath();
    ctx.fill();
  };
  const sword = (x0, y0, x1, y1) => {
    line([x0, y0, x1, y1], steel, 4);
    const a = Math.atan2(y1 - y0, x1 - x0);
    const gx = x0 + Math.cos(a) * 8;
    const gy = y0 + Math.sin(a) * 8;
    line([gx - Math.sin(a) * 7, gy + Math.cos(a) * 7, gx + Math.sin(a) * 7, gy - Math.cos(a) * 7], '#a07a2a', 4);
    line([x0, y0, x0 + Math.cos(a) * 6, y0 + Math.sin(a) * 6], '#5a3d22', 4);
  };
  const plus = () => {
    ctx.fillStyle = '#5aff6a';
    ctx.fillRect(34, 6, 4, 12);
    ctx.fillRect(30, 10, 12, 4);
  };
  switch (type) {
    case 'move':
      // A boot.
      ctx.fillStyle = '#7a5230';
      ctx.beginPath();
      ctx.moveTo(16, 8);
      ctx.lineTo(28, 8);
      ctx.lineTo(28, 30);
      ctx.lineTo(40, 34);
      ctx.quadraticCurveTo(42, 40, 38, 40);
      ctx.lineTo(14, 40);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#5a3d22';
      ctx.fillRect(14, 36, 26, 4);
      ctx.fillStyle = team;
      ctx.fillRect(16, 8, 12, 5);
      break;
    case 'stop':
      shield(24, 22, 1.2, team);
      break;
    case 'attack':
      sword(10, 40, 38, 10);
      break;
    case 'hold':
      shield(20, 24, 1, team);
      sword(16, 42, 40, 14);
      break;
    case 'harvest':
      line([12, 40, 34, 14], wood, 4);
      ctx.strokeStyle = steel;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(30, 22, 14, -2.4, -0.6);
      ctx.stroke();
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.arc(38, 38, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'return':
      ctx.fillStyle = '#c9a227';
      ctx.beginPath();
      ctx.arc(20, 30, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8c6f14';
      ctx.fillRect(15, 16, 10, 5);
      line([30, 14, 42, 14, 42, 30], '#5aff6a', 4);
      line([37, 25, 42, 30, 47, 25], '#5aff6a', 4);
      break;
    case 'build':
      line([12, 40, 30, 20], wood, 5);
      ctx.fillStyle = '#9aa0a6';
      ctx.save();
      ctx.translate(32, 16);
      ctx.rotate(-0.8);
      ctx.fillRect(-11, -5, 22, 10);
      ctx.restore();
      break;
    case 'cancel':
      line([14, 14, 34, 34], '#ff5040', 6);
      line([34, 14, 14, 34], '#ff5040', 6);
      break;
    case 'back':
      line([34, 24, 14, 24], '#e8e2d0', 5);
      line([22, 15, 13, 24, 22, 33], '#e8e2d0', 5);
      break;
    case 'rally':
      line([16, 42, 16, 8], wood, 4);
      ctx.fillStyle = team;
      ctx.beginPath();
      ctx.moveTo(18, 9);
      ctx.lineTo(38, 15);
      ctx.lineTo(18, 22);
      ctx.fill();
      break;
    case 'upWeapons':
      sword(10, 40, 34, 16);
      plus();
      break;
    case 'upArmor':
      shield(20, 26, 1, team);
      plus();
      break;
    default:
      break;
  }
  ctx.restore();
}

function costHTML(cost) {
  if (!cost) return '';
  const parts = [];
  if (cost.gold) parts.push(`<span class="c-gold">${cost.gold}</span>`);
  if (cost.wood) parts.push(`<span class="c-wood">${cost.wood}</span>`);
  if (cost.food) parts.push(`<span class="c-food">${cost.food}</span>`);
  return parts.join(' ');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export class UI {
  constructor(game, controller, els) {
    this.game = game;
    this.ctl = controller;
    this.els = els;
    this.infoSig = null;
    this.cmdSig = null;
    this.cmdList = [];
    this.lastTop = '';
    this.messageTimer = 0;
    this.dyn = [];

    this.abort = new AbortController();
    const opt = { signal: this.abort.signal };
    els.commands.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-i]');
      if (!btn) return;
      this.ctl.audio.unlock();
      const cmd = this.cmdList[+btn.dataset.i];
      if (cmd) this.ctl.runCommand(cmd);
    }, opt);
    els.commands.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('button[data-i]');
      if (!btn) return;
      this.showTooltip(this.cmdList[+btn.dataset.i]);
    }, opt);
    els.commands.addEventListener('mouseleave', () => this.hideTooltip(), opt);
    els.info.addEventListener('click', (e) => this.onInfoClick(e), opt);
  }

  dispose() {
    this.abort.abort();
    this.hideTooltip();
  }

  // ---- messages ---------------------------------------------------------------

  message(text) {
    const box = this.els.messages;
    const div = document.createElement('div');
    div.className = 'msg';
    div.textContent = text;
    box.appendChild(div);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => div.classList.add('fade'), 3500);
    setTimeout(() => div.remove(), 4200);
  }

  // ---- tooltip ---------------------------------------------------------------------

  showTooltip(cmd) {
    if (!cmd) return;
    const t = this.els.tooltip;
    let html = `<div class="tt-title">${esc(cmd.label)} <kbd>${esc(cmd.hotkey)}</kbd></div>`;
    if (cmd.cost) html += `<div class="tt-cost">${costHTML(cmd.cost)}</div>`;
    if (cmd.desc) html += `<div class="tt-desc">${esc(cmd.desc)}</div>`;
    if (!cmd.enabled && cmd.reason) html += `<div class="tt-req">${esc(cmd.reason)}</div>`;
    t.innerHTML = html;
    t.hidden = false;
  }

  hideTooltip() {
    this.els.tooltip.hidden = true;
  }

  // ---- per-frame update -------------------------------------------------------------

  update() {
    const g = this.game;
    const p = g.players[PLAYER];
    const top = `${p.gold}|${p.wood}|${p.food}|${p.foodCap}|${Math.floor(g.time)}`;
    if (top !== this.lastTop) {
      this.lastTop = top;
      this.els.gold.textContent = p.gold;
      this.els.wood.textContent = p.wood;
      this.els.food.textContent = `${p.food}/${p.foodCap}`;
      this.els.food.classList.toggle('warn', p.food >= p.foodCap);
      this.els.clock.textContent = formatTime(g.time);
    }
    this.updateInfo();
    this.updateCommands();
    for (const d of this.dyn) d();
  }

  updateCommands() {
    const cmds = this.ctl.getCommands();
    const mode = this.ctl.mode ? `${this.ctl.mode.type}:${this.ctl.mode.cmd || this.ctl.mode.btype}` : '';
    const sig = cmds.map((c) => `${c.id}${c.enabled ? 1 : 0}${c.label}`).join('|') + mode;
    this.cmdList = cmds;
    if (sig === this.cmdSig) return;
    this.cmdSig = sig;
    const slots = new Array(9).fill(null);
    let next = 0;
    cmds.forEach((c, i) => {
      if (c.slot !== undefined && !slots[c.slot]) slots[c.slot] = i;
      else {
        while (next < 9 && slots[next] !== null) next++;
        if (next < 9) slots[next] = i;
      }
    });
    let html = '';
    for (let s = 0; s < 9; s++) {
      const i = slots[s];
      if (i === null) {
        html += '<div class="cmd empty"></div>';
        continue;
      }
      const c = cmds[i];
      const active = this.ctl.mode && ((this.ctl.mode.cmd && c.id === this.ctl.mode.cmd) || (this.ctl.mode.btype && c.id === `build-${this.ctl.mode.btype}`));
      html += `<button class="cmd${c.enabled ? '' : ' disabled'}${active ? ' active' : ''}" data-i="${i}" aria-label="${esc(c.label)} (${esc(c.hotkey)})">
        <img src="${iconURL(c.icon)}" alt="" draggable="false"><kbd>${esc(c.hotkey)}</kbd></button>`;
    }
    this.els.commands.innerHTML = html;
    if (!this.els.tooltip.hidden) this.hideTooltip();
  }

  updateInfo() {
    const g = this.game;
    const sel = this.ctl.selected();
    let sig = sel.map((e) => `${e.id}:${Math.ceil((e.hp / e.maxHp) * 20)}`).join(',');
    if (sel.length === 1) {
      const e = sel[0];
      if (e.kind === 'unit') sig += `|${e.carry ? e.carry.type : ''}|${e.order ? e.order.type : ''}`;
      else {
        sig += `|${e.constructing}|${e.queue.map((q) => q.type).join(',')}|${e.gold}|${e.hp}`;
        if (e.def.research) sig += `|${JSON.stringify(g.players[e.owner].upgrades)}`;
      }
    }
    if (sig === this.infoSig) return;
    this.infoSig = sig;
    this.dyn = [];
    const el = this.els.info;
    if (!sel.length) {
      el.innerHTML = '<div class="info-empty">Select a unit or building.<br><span>Drag to select a group. Right-click to command.</span></div>';
      return;
    }
    if (sel.length > 1) {
      let html = '<div class="multi">';
      sel.slice(0, 18).forEach((e) => {
        const pct = Math.max(0, e.hp / e.maxHp);
        html += `<button class="mini" data-id="${e.id}" title="${esc(e.def.name)}"><img src="${iconURL({ kind: e.kind === 'unit' ? 'unit' : 'building', type: e.type }, e.owner, 40)}" alt="">
          <span class="bar"><i style="width:${pct * 100}%;background:${hpColor(pct)}"></i></span></button>`;
      });
      html += '</div>';
      if (sel.length > 18) html += `<div class="more">+${sel.length - 18} more</div>`;
      el.innerHTML = html;
      return;
    }
    const e = sel[0];
    const pct = Math.max(0, e.hp / e.maxHp);
    const iconKind = e.kind === 'unit' ? 'unit' : 'building';
    const owner = e.owner === PLAYER ? 'Yours' : e.owner < 0 ? 'Neutral' : 'Enemy';
    let html = `<div class="single">
      <div class="portrait ${e.owner === PLAYER ? 'own' : e.owner < 0 ? 'neutral' : 'foe'}"><img src="${iconURL({ kind: iconKind, type: e.type }, e.owner, 56)}" alt=""></div>
      <div class="ident"><div class="name">${esc(e.def.name)}</div><div class="owner">${owner}</div>`;
    if (e.type !== 'goldmine') {
      html += `<div class="hp"><span class="bar"><i style="width:${pct * 100}%;background:${hpColor(pct)}"></i></span><span class="hpt">${Math.max(0, Math.ceil(e.hp))} / ${e.maxHp}</span></div>`;
    }
    html += '</div></div>';

    if (e.kind === 'unit') {
      const stats = g.attackStats(e);
      html += `<dl class="stats">
        <dt>Armor</dt><dd>${g.armorOf(e)}</dd>
        <dt>Damage</dt><dd>${Math.ceil((stats.damage + stats.pierce) / 2)}–${stats.damage + stats.pierce}</dd>
        <dt>Range</dt><dd>${e.def.range}</dd>
        <dt>Sight</dt><dd>${e.def.sight}</dd>
        <dt>Speed</dt><dd>${e.def.speed}</dd>
      </dl>`;
      if (e.carry) html += `<div class="carry">Carrying ${e.carry.amount} ${e.carry.type === 'gold' ? 'gold' : 'lumber'}</div>`;
      el.innerHTML = html;
      return;
    }

    if (e.type === 'goldmine') {
      html += `<div class="note">Gold remaining: <b class="c-gold">${e.gold}</b></div>`;
      el.innerHTML = html;
      return;
    }
    if (e.constructing) {
      html += `<div class="progress-label">Under construction</div><div class="progress"><i data-dyn="build"></i></div>`;
      el.innerHTML = html;
      const bar = el.querySelector('[data-dyn="build"]');
      this.dyn.push(() => {
        bar.style.width = `${e.progress * 100}%`;
      });
      this.dyn[0]();
      return;
    }
    if (e.def.food) html += `<div class="note">Provides ${e.def.food} food.</div>`;
    if (e.def.depot && e.owner === PLAYER) html += `<div class="note">Accepts ${e.def.depot.map((d) => (d === 'gold' ? 'gold' : 'lumber')).join(' and ')}.</div>`;
    if (e.def.attack) html += `<div class="note">Damage ${e.def.attack.damage + e.def.attack.pierce} · Range ${e.def.attack.range}</div>`;
    if (e.def.research && e.owner === PLAYER) {
      const up = g.players[PLAYER].upgrades;
      html += `<div class="note">${RESEARCH.weapons.name}: ${up.weapons}/2 · ${RESEARCH.armor.name}: ${up.armor}/2</div>`;
    }
    if (e.queue.length && e.owner === PLAYER) {
      const first = e.queue[0];
      const label = first.kind === 'unit' ? `Training ${UNITS[first.type].name}` : `Researching ${RESEARCH[first.type].name}`;
      html += `<div class="progress-label">${label}</div><div class="progress"><i data-dyn="queue"></i></div><div class="queue">`;
      e.queue.forEach((q, i) => {
        const icon = q.kind === 'unit' ? { kind: 'unit', type: q.type } : { kind: 'glyph', type: q.type === 'weapons' ? 'upWeapons' : 'upArmor' };
        html += `<button class="qitem" data-q="${i}" title="Click to cancel"><img src="${iconURL(icon, PLAYER, 32)}" alt=""></button>`;
      });
      html += '</div>';
      el.innerHTML = html;
      const bar = el.querySelector('[data-dyn="queue"]');
      this.dyn.push(() => {
        const q = e.queue[0];
        if (q) bar.style.width = `${(q.elapsed / q.time) * 100}%`;
      });
      this.dyn[0]();
      return;
    }
    el.innerHTML = html;
  }

  onInfoClick(e) {
    const g = this.game;
    const mini = e.target.closest('button.mini');
    if (mini) {
      const ent = g.get(+mini.dataset.id);
      if (!ent) return;
      if (e.shiftKey) this.ctl.selection = this.ctl.selection.filter((id) => id !== ent.id);
      else this.ctl.setSelection([ent]);
      return;
    }
    const q = e.target.closest('button.qitem');
    if (q) {
      const b = this.ctl.selected()[0];
      if (b && b.kind === 'building' && b.owner === PLAYER) g.cancelQueueItem(b, +q.dataset.q);
    }
  }
}

function hpColor(pct) {
  return pct > 0.6 ? '#3bd14a' : pct > 0.3 ? '#e8c33a' : '#e5412f';
}
