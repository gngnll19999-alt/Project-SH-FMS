/* 경량 SVG 차트 (관제 화면용).
 * SH-MES 에서 쓰던 구현을 가져와 ISA-101 기준에 맞추어 기본 선색을 저채도로 낮추었다.
 * 공정 트렌드에서 색은 이상 상태 표시에만 쓴다. 2026-07-16 제어기술팀
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function n(tag, attr) {
    var e = document.createElementNS(NS, tag);
    for (var k in attr) if (attr.hasOwnProperty(k)) e.setAttribute(k, attr[k]);
    return e;
  }

  function svg(host, w, h) {
    host.innerHTML = '';
    var s = n('svg', { viewBox: '0 0 ' + w + ' ' + h, width: '100%', height: h, preserveAspectRatio: 'none' });
    s.style.display = 'block';
    s.style.overflow = 'visible';
    host.appendChild(s);
    return s;
  }

  function txt(parent, x, y, s, attr) {
    var t = n('text', Object.assign({
      x: x, y: y, fill: '#6e7885', 'font-size': 10, 'font-family': 'Consolas, monospace'
    }, attr || {}));
    t.textContent = s;
    parent.appendChild(t);
    return t;
  }

  function niceMax(v) {
    if (v <= 0) return 10;
    var e = Math.pow(10, Math.floor(Math.log10(v)));
    var m = v / e;
    var step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
    return step * e;
  }

  /**
   * 꺾은선 그래프.
   * opt = { labels:[], series:[{name,color,data:[]}], h, max, min, area, refs:[{v,color,label}] }
   */
  function line(host, opt) {
    var w = 620, h = opt.h || 180;
    var padL = 34, padR = 10, padT = 10, padB = 20;
    var s = svg(host, w, h);

    var all = [];
    opt.series.forEach(function (se) { all = all.concat(se.data); });
    (opt.refs || []).forEach(function (r) { all.push(r.v); });
    var max = opt.max != null ? opt.max : niceMax(Math.max.apply(null, all) * 1.1);
    var min = opt.min != null ? opt.min : 0;

    var iw = w - padL - padR, ih = h - padT - padB;
    var X = function (i, len) { return padL + (len <= 1 ? 0 : iw * i / (len - 1)); };
    var Y = function (v) { return padT + ih - ih * (v - min) / (max - min || 1); };

    // 가로 눈금 4등분
    for (var g = 0; g <= 4; g++) {
      var yv = min + (max - min) * g / 4;
      var y = Y(yv);
      s.appendChild(n('line', { x1: padL, y1: y, x2: w - padR, y2: y, stroke: '#232b36', 'stroke-width': 1 }));
      txt(s, padL - 5, y + 3, (max - min) > 20 ? Math.round(yv) : yv.toFixed(1), { 'text-anchor': 'end' });
    }

    // 기준선(규격/목표)
    (opt.refs || []).forEach(function (r) {
      var y = Y(r.v);
      s.appendChild(n('line', {
        x1: padL, y1: y, x2: w - padR, y2: y,
        stroke: r.color || '#e0a83a', 'stroke-width': 1, 'stroke-dasharray': '4 3'
      }));
      if (r.label) txt(s, w - padR - 2, y - 3, r.label, { 'text-anchor': 'end', fill: r.color || '#e0a83a' });
    });

    opt.series.forEach(function (se) {
      var len = se.data.length;
      var d = se.data.map(function (v, i) { return (i ? 'L' : 'M') + X(i, len).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');

      if (opt.area) {
        var idFill = 'g' + Math.random().toString(36).slice(2, 8);
        var defs = n('defs');
        var lg = n('linearGradient', { id: idFill, x1: 0, y1: 0, x2: 0, y2: 1 });
        lg.appendChild(n('stop', { offset: '0%', 'stop-color': se.color, 'stop-opacity': .28 }));
        lg.appendChild(n('stop', { offset: '100%', 'stop-color': se.color, 'stop-opacity': 0 }));
        defs.appendChild(lg);
        s.appendChild(defs);
        s.appendChild(n('path', {
          d: d + ' L' + X(len - 1, len) + ' ' + (padT + ih) + ' L' + X(0, len) + ' ' + (padT + ih) + ' Z',
          fill: 'url(#' + idFill + ')'
        }));
      }

      s.appendChild(n('path', { d: d, fill: 'none', stroke: se.color, 'stroke-width': se.width || 1.8, 'stroke-linejoin': 'round' }));

      if (se.dots) {
        se.data.forEach(function (v, i) {
          s.appendChild(n('circle', { cx: X(i, len), cy: Y(v), r: 2.4, fill: se.color }));
        });
      }
    });

    // X축 라벨은 겹치지 않게 솎아낸다
    if (opt.labels) {
      var step = Math.ceil(opt.labels.length / 10);
      opt.labels.forEach(function (l, i) {
        if (i % step) return;
        txt(s, X(i, opt.labels.length), h - 5, l, { 'text-anchor': 'middle' });
      });
    }
    return s;
  }

  /** 세로 막대. opt = { labels, data, colors, h, max, unit } */
  function bars(host, opt) {
    var w = 620, h = opt.h || 170;
    var padL = 34, padR = 8, padT = 12, padB = 22;
    var s = svg(host, w, h);
    var max = opt.max != null ? opt.max : niceMax(Math.max.apply(null, opt.data) * 1.15);
    var iw = w - padL - padR, ih = h - padT - padB;
    var bw = iw / opt.data.length;

    for (var g = 0; g <= 3; g++) {
      var y = padT + ih - ih * g / 3;
      s.appendChild(n('line', { x1: padL, y1: y, x2: w - padR, y2: y, stroke: '#232b36' }));
      txt(s, padL - 5, y + 3, Math.round(max * g / 3), { 'text-anchor': 'end' });
    }

    opt.data.forEach(function (v, i) {
      var bh = Math.max(1, ih * v / max);
      var x = padL + bw * i + bw * 0.18;
      var col = (opt.colors && opt.colors[i]) || '#5f7d99';
      s.appendChild(n('rect', { x: x, y: padT + ih - bh, width: bw * 0.64, height: bh, fill: col, rx: 1 }));
      if (opt.showValue) {
        txt(s, x + bw * 0.32, padT + ih - bh - 4, v, { 'text-anchor': 'middle', fill: '#c3ccd8' });
      }
      txt(s, x + bw * 0.32, h - 6, opt.labels[i], { 'text-anchor': 'middle' });
    });
    return s;
  }

  /** 도넛. items = [{name,value,color}] */
  function donut(host, items, opt) {
    opt = opt || {};
    var size = opt.size || 150;
    var s = svg(host, size, size);
    var cx = size / 2, cy = size / 2, r = size / 2 - 6, inner = opt.inner || r * 0.62;
    var total = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var ang = -Math.PI / 2;

    items.forEach(function (it) {
      var a2 = ang + Math.PI * 2 * it.value / total;
      var large = (a2 - ang) > Math.PI ? 1 : 0;
      var p = [
        'M', cx + r * Math.cos(ang), cy + r * Math.sin(ang),
        'A', r, r, 0, large, 1, cx + r * Math.cos(a2), cy + r * Math.sin(a2),
        'L', cx + inner * Math.cos(a2), cy + inner * Math.sin(a2),
        'A', inner, inner, 0, large, 0, cx + inner * Math.cos(ang), cy + inner * Math.sin(ang),
        'Z'
      ].join(' ');
      s.appendChild(n('path', { d: p, fill: it.color }));
      ang = a2;
    });

    if (opt.center) {
      txt(s, cx, cy + 2, opt.center, { 'text-anchor': 'middle', fill: '#c9cfd8', 'font-size': 20, 'font-weight': 700 });
      if (opt.centerSub) txt(s, cx, cy + 16, opt.centerSub, { 'text-anchor': 'middle', 'font-size': 9 });
    }
    return s;
  }

  /** 반원 게이지. OEE 같은 0~100 지표용 */
  function gauge(host, pct, opt) {
    opt = opt || {};
    var w = 170, h = 100;
    var s = svg(host, w, h);
    var cx = w / 2, cy = h - 14, r = 62;

    function arc(from, to, color, width) {
      var a1 = Math.PI + Math.PI * from, a2 = Math.PI + Math.PI * to;
      var large = (a2 - a1) > Math.PI ? 1 : 0;
      s.appendChild(n('path', {
        d: ['M', cx + r * Math.cos(a1), cy + r * Math.sin(a1),
            'A', r, r, 0, large, 1, cx + r * Math.cos(a2), cy + r * Math.sin(a2)].join(' '),
        fill: 'none', stroke: color, 'stroke-width': width || 11, 'stroke-linecap': 'butt'
      }));
    }

    arc(0, 1, '#212a36');
    var v = Math.max(0, Math.min(100, pct)) / 100;
    if (v > 0.001) arc(0, v, opt.color || '#5f7d99');

    // World-class 기준선 85%
    if (opt.target != null) {
      var a = Math.PI + Math.PI * (opt.target / 100);
      s.appendChild(n('line', {
        x1: cx + (r - 8) * Math.cos(a), y1: cy + (r - 8) * Math.sin(a),
        x2: cx + (r + 8) * Math.cos(a), y2: cy + (r + 8) * Math.sin(a),
        stroke: '#e0a83a', 'stroke-width': 2
      }));
    }

    txt(s, cx, cy - 12, pct.toFixed(1) + '%', { 'text-anchor': 'middle', fill: '#e6ecf3', 'font-size': 22, 'font-weight': 700 });
    if (opt.label) txt(s, cx, cy + 6, opt.label, { 'text-anchor': 'middle', 'font-size': 10 });
    return s;
  }

  /** 인라인 스파크라인 (테이블 셀 안에 들어감) */
  function spark(host, data, color) {
    var w = 90, h = 22;
    var s = svg(host, w, h);
    var mx = Math.max.apply(null, data), mn = Math.min.apply(null, data);
    var d = data.map(function (v, i) {
      var x = w * i / (data.length - 1);
      var y = h - 2 - (h - 4) * (v - mn) / (mx - mn || 1);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
    s.appendChild(n('path', { d: d, fill: 'none', stroke: color || '#5f7d99', 'stroke-width': 1.4 }));
    return s;
  }

  global.Chart = { line: line, bars: bars, donut: donut, gauge: gauge, spark: spark };
})(window);
