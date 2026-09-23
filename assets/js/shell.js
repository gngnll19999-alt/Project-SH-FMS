/* 공통 화면 틀.
 * 메뉴는 ISA-101 화면 계층(Level 1~4)에 맞춰 묶었다.
 * 상단 알람 배너는 어느 화면에 있든 항상 붙는다 — 운전원이 다른 화면을 보고 있어도
 * 알람을 놓치면 안 되기 때문. (ISA-18.2)
 */
(function () {
  'use strict';

  var MENU = [
    { grp: 'LEVEL 1 · 공장 개요' },
    { id: 'overview', name: '공장 전체 감시', ic: '▦', href: 'overview.html' },

    { grp: 'LEVEL 2 · 유닛' },
    { id: 'line',     name: '라인 공정 미믹', ic: '▤', href: 'line.html' },
    { id: 'chemical', name: '화학 배치 공정', ic: '⌬', href: 'chemical.html' },
    { id: 'energy',   name: '에너지 · 유틸리티', ic: '⚡', href: 'energy.html' },

    { grp: 'LEVEL 3 · 상세 · 영상' },
    { id: 'cctv',     name: 'CCTV 통합관제', ic: '◉', href: 'cctv.html' },
    { id: 'safety',   name: '안전 관제', ic: '⚠', href: 'safety.html' },

    { grp: 'LEVEL 4 · 진단' },
    { id: 'alarm',    name: '알람 관리', ic: '◈', href: 'alarm.html', badge: true },
    { id: 'trend',    name: '트렌드 · 히스토리안', ic: '◰', href: 'trend.html' }
  ];

  function el(t, c, h) {
    var n = document.createElement(t);
    if (c) n.className = c;
    if (h != null) n.innerHTML = h;
    return n;
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function build() {
    var u = Auth.guard();
    if (!u) return;

    var page = document.body.dataset.page || '';
    var layout = el('div', 'layout');

    // ---- 알람 배너 ----
    var top1 = (window.Mock && Mock.alarms) ? Mock.alarms().filter(function (a) { return !a.ack; }) : [];
    var banner = el('div', 'abanner' + (top1.length ? '' : ' quiet'));
    if (top1.length) {
      var a = top1[0];
      banner.innerHTML =
        '<span class="tag p' + a.pri + '">P' + a.pri + '</span>' +
        '<span class="msg"><b>' + a.tag + '</b> ' + a.msg + ' <span style="color:#6e7885">· ' + a.at + '</span></span>' +
        '<span class="cnt">미확인 ' + top1.length + '건 (P1 ' +
          top1.filter(function (x) { return x.pri === 1; }).length + ' / P2 ' +
          top1.filter(function (x) { return x.pri === 2; }).length + ')</span>';
    } else {
      banner.innerHTML = '<span class="msg">활성 알람 없음 — 전 공정 정상</span>';
    }
    banner.style.cursor = 'pointer';
    banner.onclick = function () { location.href = 'alarm.html'; };

    // ---- 브랜드 ----
    var brand = el('div', 'brand');
    brand.innerHTML = '<div class="mark"></div><div><b>SH-FMS</b><span>통합 모니터링 v3.2</span></div>';

    // ---- 상단바 ----
    var top = el('header', 'topbar');
    top.appendChild(el('h1', null, document.body.dataset.title || ''));
    if (document.body.dataset.crumb) top.appendChild(el('div', 'crumb', document.body.dataset.crumb));
    top.appendChild(el('div', 'spacer'));
    if (document.body.dataset.lvl) top.appendChild(el('div', 'lvl', document.body.dataset.lvl));

    var link = el('div', 'link-st');
    link.innerHTML = '<i></i><span>OPC UA 정상 · 태그 1,284 / 스캔 1s</span>';
    top.appendChild(link);

    var clock = el('div', 'clock');
    (function tick() {
      var n = new Date();
      clock.textContent = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()) +
        ' ' + pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds());
      setTimeout(tick, 1000);
    })();
    top.appendChild(clock);

    var who = el('div', 'who');
    who.innerHTML = '<div><div class="nm">' + u.name + ' ' + u.role + '</div><div class="dp">' + u.dept + '</div></div>';
    var b = el('button', null, '로그아웃');
    b.onclick = function () { Auth.logout(); };
    who.appendChild(b);
    top.appendChild(who);

    // ---- 좌측 메뉴 ----
    var nav = el('nav', 'side');
    MENU.forEach(function (m) {
      if (m.grp) { nav.appendChild(el('div', 'grp', m.grp)); return; }
      var a = el('a', m.id === page ? 'on' : '');
      a.href = m.href;
      a.innerHTML = '<span class="ic">' + m.ic + '</span><span>' + m.name + '</span>' +
        (m.badge && top1.length ? '<span class="badge">' + top1.length + '</span>' : '');
      nav.appendChild(a);
    });

    var main = el('main');
    while (document.body.firstChild) main.appendChild(document.body.firstChild);

    layout.appendChild(banner);
    layout.appendChild(brand);
    layout.appendChild(top);
    layout.appendChild(nav);
    layout.appendChild(main);
    document.body.appendChild(layout);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
