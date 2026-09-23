/* CCTV 뷰어.
 *
 * 운영에서는 카메라가 RTSP 로 스트림을 내보내고, C# 게이트웨이가 이를 받아
 * WebRTC(저지연) 또는 HLS(호환) 로 브라우저에 중계한다. (인터페이스정의서 7장)
 * 다만 이 저장소는 폐쇄망 밖에서 화면 검토용으로 돌려야 해서, 실제 카메라가 없을 때는
 * 캔버스에 합성 영상을 그려 자리만 채운다. `Cctv.attach(el, cam)` 시그니처는 동일하므로
 * 나중에 내부만 video 엘리먼트로 갈아끼우면 된다.
 *
 * 남성흠 / 2026-08-05
 */
(function (global) {
  'use strict';

  var views = [];
  var running = false;

  // 카메라별 장면 구성. 실제 설치 위치에 맞춰 대충 비슷하게.
  var SCENES = {
    'CAM-01': { kind: 'tank',    people: 2, light: 0.42 },
    'CAM-02': { kind: 'tank',    people: 1, light: 0.38 },
    'CAM-03': { kind: 'line',    people: 2, light: 0.46 },
    'CAM-04': { kind: 'line',    people: 0, light: 0.30, steam: true },
    'CAM-05': { kind: 'line',    people: 1, light: 0.34 },
    'CAM-06': { kind: 'line',    people: 3, light: 0.48 },
    'CAM-07': { kind: 'bench',   people: 2, light: 0.52 },
    'CAM-08': { kind: 'dock',    people: 2, light: 0.44, truck: true },
    'CAM-09': { kind: 'gate',    people: 0, light: 0.36, truck: true },
    'CAM-10': { kind: 'tank',    people: 0, light: 0.28 },
    'CAM-11': { kind: 'tank',    people: 0, light: 0.24 },
    'CAM-12': { kind: 'gate',    people: 0, light: 0.26 }
  };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function drawScene(ctx, w, h, sc, t, cam) {
    // ---- 바닥/벽 ----
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgb(' + Math.round(26 + sc.light * 26) + ',' + Math.round(28 + sc.light * 28) + ',' + Math.round(32 + sc.light * 30) + ')');
    g.addColorStop(0.55, 'rgb(' + Math.round(38 + sc.light * 40) + ',' + Math.round(40 + sc.light * 42) + ',' + Math.round(44 + sc.light * 44) + ')');
    g.addColorStop(1, 'rgb(' + Math.round(20 + sc.light * 22) + ',' + Math.round(21 + sc.light * 23) + ',' + Math.round(24 + sc.light * 24) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    var hz = h * 0.42;   // 수평선

    // 바닥 원근선
    ctx.strokeStyle = 'rgba(255,255,255,.055)';
    ctx.lineWidth = 1;
    for (var i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + i * w * 0.08, hz);
      ctx.lineTo(w / 2 + i * w * 0.42, h);
      ctx.stroke();
    }
    for (var j = 1; j <= 4; j++) {
      var y = hz + (h - hz) * Math.pow(j / 4, 1.7);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.beginPath(); ctx.moveTo(0, hz); ctx.lineTo(w, hz); ctx.stroke();

    // ---- 장면별 구조물 ----
    ctx.fillStyle = 'rgba(255,255,255,.085)';
    ctx.strokeStyle = 'rgba(255,255,255,.14)';

    if (sc.kind === 'tank') {
      // 원통 탱크 3기
      [0.2, 0.46, 0.74].forEach(function (x, k) {
        var cx = w * x, cw = w * (0.11 - k * 0.012), ch = h * (0.34 + k * 0.03);
        ctx.fillRect(cx - cw / 2, hz - ch * 0.35, cw, ch);
        ctx.strokeRect(cx - cw / 2, hz - ch * 0.35, cw, ch);
        ctx.beginPath();
        ctx.ellipse(cx, hz - ch * 0.35, cw / 2, cw * 0.16, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      // 배관
      ctx.beginPath();
      ctx.moveTo(0, hz - h * 0.22); ctx.lineTo(w, hz - h * 0.22); ctx.stroke();
    } else if (sc.kind === 'line') {
      // 컨베이어 + 설비 프레임
      ctx.fillRect(w * 0.06, hz + h * 0.14, w * 0.88, h * 0.07);
      ctx.strokeRect(w * 0.06, hz + h * 0.14, w * 0.88, h * 0.07);
      // 이동하는 제품
      for (var p = 0; p < 6; p++) {
        var px = ((t * 0.035 + p * 0.19) % 1.1 - 0.05) * w;
        ctx.fillStyle = 'rgba(255,255,255,.2)';
        ctx.fillRect(px, hz + h * 0.125, w * 0.035, h * 0.03);
      }
      ctx.fillStyle = 'rgba(255,255,255,.085)';
      // 상부 설비
      ctx.fillRect(w * 0.3, hz - h * 0.3, w * 0.4, h * 0.34);
      ctx.strokeRect(w * 0.3, hz - h * 0.3, w * 0.4, h * 0.34);
      // 상태 표시등 (실제 카메라에 잡히는 타워램프)
      ctx.fillStyle = sc.steam ? 'rgba(214,72,60,.85)' : 'rgba(79,158,99,.8)';
      ctx.fillRect(w * 0.49, hz - h * 0.36, w * 0.018, h * 0.05);
    } else if (sc.kind === 'bench') {
      ctx.fillRect(w * 0.1, hz + h * 0.2, w * 0.8, h * 0.1);
      ctx.strokeRect(w * 0.1, hz + h * 0.2, w * 0.8, h * 0.1);
      [0.25, 0.5, 0.75].forEach(function (x) {
        ctx.fillRect(w * x - w * 0.04, hz - h * 0.04, w * 0.08, h * 0.22);
        ctx.strokeRect(w * x - w * 0.04, hz - h * 0.04, w * 0.08, h * 0.22);
      });
    } else if (sc.kind === 'dock') {
      // 도크 셔터
      for (var d = 0; d < 3; d++) {
        ctx.fillRect(w * (0.08 + d * 0.3), hz - h * 0.28, w * 0.22, h * 0.32);
        ctx.strokeRect(w * (0.08 + d * 0.3), hz - h * 0.28, w * 0.22, h * 0.32);
      }
      // 팔레트
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.fillRect(w * 0.2, hz + h * 0.3, w * 0.12, h * 0.1);
      ctx.fillRect(w * 0.42, hz + h * 0.33, w * 0.12, h * 0.1);
    } else if (sc.kind === 'gate') {
      ctx.fillRect(w * 0.02, hz - h * 0.2, w * 0.1, h * 0.28);
      ctx.strokeRect(w * 0.02, hz - h * 0.2, w * 0.1, h * 0.28);
      // 차단기
      var arm = Math.sin(t * 0.4) > 0.6 ? -0.5 : 0;
      ctx.save();
      ctx.translate(w * 0.12, hz + h * 0.02);
      ctx.rotate(arm);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.fillRect(0, -h * 0.012, w * 0.34, h * 0.024);
      ctx.restore();
    }

    // ---- 이동체(사람) ----
    for (var k2 = 0; k2 < sc.people; k2++) {
      var ph = t * 0.22 + k2 * 2.1;
      var x = w * (0.18 + 0.62 * (0.5 + 0.5 * Math.sin(ph)));
      var depth = 0.5 + 0.5 * Math.sin(ph * 0.7 + k2);
      var y = hz + (h - hz) * (0.18 + depth * 0.5);
      var s = h * (0.1 + depth * 0.1);
      ctx.fillStyle = 'rgba(232,236,242,.72)';
      ctx.beginPath(); ctx.arc(x, y - s, s * 0.2, 0, Math.PI * 2); ctx.fill();  // 머리
      ctx.fillRect(x - s * 0.16, y - s * 0.8, s * 0.32, s * 0.8);                // 몸통
    }

    // ---- 지게차/차량 ----
    if (sc.truck) {
      var tx = ((t * 0.06) % 1.3 - 0.15) * w;
      ctx.fillStyle = 'rgba(224,182,88,.62)';
      ctx.fillRect(tx, hz + h * 0.28, w * 0.16, h * 0.16);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(tx + w * 0.02, hz + h * 0.44, w * 0.035, h * 0.035);
      ctx.fillRect(tx + w * 0.105, hz + h * 0.44, w * 0.035, h * 0.035);
    }

    // ---- 증기/연기 ----
    if (sc.steam) {
      for (var s2 = 0; s2 < 5; s2++) {
        var sy = hz - h * 0.3 - ((t * 18 + s2 * 34) % 90);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.05 - s2 * 0.007) + ')';
        ctx.beginPath();
        ctx.arc(w * 0.5 + Math.sin(t + s2) * 12, sy, 16 + s2 * 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- 비네팅 + 노이즈 ----
    var vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(255,255,255,.028)';
    for (var n = 0; n < 90; n++) {
      ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    // 인터레이스 라인
    ctx.fillStyle = 'rgba(0,0,0,.08)';
    for (var ln = 0; ln < h; ln += 3) ctx.fillRect(0, ln, w, 1);
  }

  function drawOsd(ctx, w, h, cam, t) {
    var d = new Date();
    ctx.font = '10px Consolas, monospace';
    ctx.textBaseline = 'top';

    // 상단 좌: 카메라 ID / 이름
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(4, 4, ctx.measureText(cam.id + '  ' + cam.name).width + 10, 14);
    ctx.fillStyle = '#dfe5ec';
    ctx.fillText(cam.id + '  ' + cam.name, 9, 6);

    // 상단 우: REC
    if (cam.rec) {
      var blink = (Math.floor(t * 1.2) % 2) === 0;
      ctx.fillStyle = blink ? '#d6483c' : 'rgba(214,72,60,.35)';
      ctx.beginPath(); ctx.arc(w - 30, 11, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#dfe5ec';
      ctx.fillText('REC', w - 23, 6);
    }

    // 하단 좌: 타임스탬프
    var ts = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
             pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(4, h - 18, ctx.measureText(ts).width + 10, 14);
    ctx.fillStyle = '#dfe5ec';
    ctx.fillText(ts, 9, h - 16);

    // 하단 우: 해상도/FPS
    var meta = '1920x1080 · 15fps · H.265';
    ctx.fillStyle = 'rgba(223,229,236,.55)';
    ctx.fillText(meta, w - ctx.measureText(meta).width - 6, h - 16);

    // AI 분석 박스 (활성 카메라만)
    if (cam.ai && cam.ai !== '-') {
      var bx = w * (0.32 + 0.1 * Math.sin(t * 0.5));
      var by = h * 0.5, bw = w * 0.2, bh = h * 0.32;
      var hot = cam.ai === '위험구역 진입' || cam.ai === '침입감지';
      ctx.strokeStyle = hot ? 'rgba(214,72,60,.9)' : 'rgba(74,134,216,.75)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = hot ? 'rgba(214,72,60,.9)' : 'rgba(74,134,216,.8)';
      ctx.fillRect(bx, by - 13, ctx.measureText(cam.ai).width + 8, 13);
      ctx.fillStyle = '#fff';
      ctx.fillText(cam.ai, bx + 4, by - 12);
    }
  }

  function loop() {
    var t = Date.now() / 1000;
    views.forEach(function (v) {
      if (!v.canvas.isConnected) return;
      var ctx = v.ctx, w = v.canvas.width, h = v.canvas.height;
      drawScene(ctx, w, h, v.scene, t, v.cam);
      drawOsd(ctx, w, h, v.cam, t);
    });
    requestAnimationFrame(loop);
  }

  /** 컨테이너에 카메라 화면을 붙인다. 운영 전환 시 내부를 <video> 로 교체. */
  function attach(host, cam) {
    host.innerHTML = '';
    var c = document.createElement('canvas');
    var rect = host.getBoundingClientRect();
    c.width = Math.max(160, Math.round(rect.width));
    c.height = Math.max(90, Math.round(rect.width * 9 / 16));
    c.style.width = '100%';
    c.style.display = 'block';
    host.appendChild(c);

    views.push({ canvas: c, ctx: c.getContext('2d'), cam: cam, scene: SCENES[cam.id] || SCENES['CAM-01'] });

    if (!running) { running = true; requestAnimationFrame(loop); }
    return c;
  }

  function clear() { views = []; }

  global.Cctv = { attach: attach, clear: clear, SCENES: SCENES };
})(window);
