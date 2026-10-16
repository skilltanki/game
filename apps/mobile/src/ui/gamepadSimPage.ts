// The virtual controller page of the dev gamepad simulator (`?gamepad=sim`,
// GamepadSimulatorService): a standard-mapping pad drawn as buttons and two
// sticks, opened in a popup. Every change goes to the opener with
// postMessage as the whole pad state — the game reads it through the real
// Gamepad API (navigator.getGamepads), never through the keyboard. Pointer
// only: a key on this page does nothing, so what the game does is the pad.
//
// Standard mapping (w3c): 0 Cross/A, 1 Circle/B, 2 Square/X, 3 Triangle/Y,
// 4 L1, 5 R1, 6 L2, 7 R2, 8 Select, 9 Start, 10 L3, 11 R3, 12-15 d-pad
// up/down/left/right, 16 Home. Axes: 0/1 left stick, 2/3 right stick.

/** The message the page posts on every change. */
export interface GamepadSimMessage {
  t: 'gamepad-sim';
  /** 17 button values, 0 or 1. */
  buttons: number[];
  /** Four axes, -1..1: left x, left y, right x, right y. */
  axes: number[];
  /** True once, when the page is going away. */
  closed?: boolean;
}

export const GAMEPAD_SIM_WINDOW_NAME = 'skilltanki-gamepad-sim';

export const GAMEPAD_SIM_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SkillTanki · virtual gamepad</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-user-select: none; user-select: none; touch-action: none; }
  body { margin: 0; background: #111; color: #ddd; font: 12px/1.2 -apple-system, "Segoe UI", Roboto, sans-serif; }
  .pad { display: grid; grid-template-columns: 170px 1fr 170px; gap: 12px; padding: 12px; width: 560px; }
  .col { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .row { display: flex; gap: 8px; justify-content: center; align-items: center; }
  .btn { border: 1px solid #555; border-radius: 10px; background: #222; color: #ddd; min-width: 44px; height: 34px;
         padding: 0 10px; display: flex; align-items: center; justify-content: center; font-weight: 700; cursor: pointer; }
  .btn.is-on { background: #9ad755; color: #111; border-color: #9ad755; }
  .btn.round { width: 44px; min-width: 44px; height: 44px; border-radius: 50%; }
  .btn.wide { min-width: 70px; }
  .btn.small { height: 26px; min-width: 56px; font-size: 11px; }
  .face { display: grid; grid-template-columns: 44px 44px 44px; grid-template-rows: 44px 44px 44px; gap: 4px; }
  .face .btn { margin: 0; }
  .dpad { display: grid; grid-template-columns: 40px 40px 40px; grid-template-rows: 40px 40px 40px; gap: 2px; }
  .dpad .btn { min-width: 40px; height: 40px; border-radius: 6px; }
  .stick { position: relative; width: 110px; height: 110px; border-radius: 50%; background: #1c1c1c; border: 1px solid #444; }
  .stick .knob { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
                 background: #333; border: 2px solid #777; }
  .stick.is-on .knob { border-color: #9ad755; }
  .cap { color: #777; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
  .readout { grid-column: 1 / -1; color: #666; font: 11px/1.4 ui-monospace, Menlo, monospace; white-space: pre; }
</style>
</head>
<body>
<div class="pad">
  <div class="col">
    <div class="row"><div class="btn wide" data-btn="6">L2</div><div class="btn wide" data-btn="4">L1</div></div>
    <div class="cap">left stick</div>
    <div class="stick" data-stick="0"><div class="knob"></div></div>
    <div class="row"><div class="btn small" data-btn="10">L3</div></div>
    <div class="cap">d-pad</div>
    <div class="dpad">
      <div></div><div class="btn" data-btn="12">▲</div><div></div>
      <div class="btn" data-btn="14">◀</div><div></div><div class="btn" data-btn="15">▶</div>
      <div></div><div class="btn" data-btn="13">▼</div><div></div>
    </div>
  </div>
  <div class="col">
    <div class="cap">virtual gamepad · standard mapping</div>
    <div class="row"><div class="btn small" data-btn="8">SELECT</div><div class="btn small" data-btn="16">HOME</div><div class="btn small" data-btn="9">START</div></div>
    <div class="cap" style="margin-top:auto">hold a button with the pointer · drag a stick</div>
  </div>
  <div class="col">
    <div class="row"><div class="btn wide" data-btn="5">R1</div><div class="btn wide" data-btn="7">R2</div></div>
    <div class="cap">face buttons</div>
    <div class="face">
      <div></div><div class="btn round" data-btn="3" style="color:#5bd">△</div><div></div>
      <div class="btn round" data-btn="2" style="color:#d7a">□</div><div></div><div class="btn round" data-btn="1" style="color:#f66">○</div>
      <div></div><div class="btn round" data-btn="0" style="color:#8cf">✕</div><div></div>
    </div>
    <div class="cap">right stick</div>
    <div class="stick" data-stick="1"><div class="knob"></div></div>
    <div class="row"><div class="btn small" data-btn="11">R3</div></div>
  </div>
  <div class="readout" id="readout"></div>
</div>
<script>
(function () {
  var state = { buttons: [], axes: [0, 0, 0, 0] };
  for (var i = 0; i < 17; i++) state.buttons.push(0);
  var readout = document.getElementById('readout');
  function send(closed) {
    var msg = { t: 'gamepad-sim', buttons: state.buttons.slice(), axes: state.axes.slice() };
    if (closed) msg.closed = true;
    if (window.opener && !window.opener.closed) window.opener.postMessage(msg, '*');
    var on = [];
    for (var b = 0; b < 17; b++) if (state.buttons[b]) on.push(b);
    readout.textContent = 'buttons ' + (on.length ? on.join(' ') : '-') + '   axes ' + state.axes.map(function (a) { return a.toFixed(2); }).join(' ');
  }
  // Buttons: held while the pointer is down on them.
  var btns = document.querySelectorAll('[data-btn]');
  Array.prototype.forEach.call(btns, function (el) {
    var index = Number(el.getAttribute('data-btn'));
    var pointer = null;
    function set(on) {
      if (state.buttons[index] === (on ? 1 : 0)) return;
      state.buttons[index] = on ? 1 : 0;
      el.classList.toggle('is-on', on);
      send(false);
    }
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      pointer = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      set(true);
    });
    function release(e) { if (e.pointerId === pointer) { pointer = null; set(false); } }
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });
  // Sticks: the knob follows the pointer inside the radius, -1..1 per axis; release returns to centre.
  var sticks = document.querySelectorAll('[data-stick]');
  Array.prototype.forEach.call(sticks, function (el) {
    var which = Number(el.getAttribute('data-stick'));
    var knob = el.querySelector('.knob');
    var pointer = null;
    var RADIUS = 32;
    function update(clientX, clientY) {
      var r = el.getBoundingClientRect();
      var dx = clientX - (r.left + r.width / 2);
      var dy = clientY - (r.top + r.height / 2);
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
      knob.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      state.axes[which * 2] = Math.round((dx / RADIUS) * 100) / 100;
      state.axes[which * 2 + 1] = Math.round((dy / RADIUS) * 100) / 100;
      send(false);
    }
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      pointer = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      el.classList.add('is-on');
      update(e.clientX, e.clientY);
    });
    el.addEventListener('pointermove', function (e) { if (e.pointerId === pointer) update(e.clientX, e.clientY); });
    function release(e) {
      if (e.pointerId !== pointer) return;
      pointer = null;
      el.classList.remove('is-on');
      knob.style.transform = '';
      state.axes[which * 2] = 0;
      state.axes[which * 2 + 1] = 0;
      send(false);
    }
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });
  window.addEventListener('pagehide', function () { send(true); });
  send(false);
})();
</script>
</body>
</html>`;
