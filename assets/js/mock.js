/* 시연용 데이터셋 + 간이 시뮬레이터.
 * 실제로는 C++ 수집기(src/collector)가 PLC 에서 읽어 C# 게이트웨이(src/SHFms.Server)로 올리고,
 * 화면은 SignalR 로 구독한다. 이 파일은 그 구독 결과를 흉내 낸 것이다.
 * 운영 전환 시 Sim.start() 대신 SignalR 연결로 갈아끼우면 화면 코드는 그대로 쓸 수 있게
 * 태그 객체 형태를 인터페이스정의서 5장과 동일하게 맞췄다.
 */
(function (global) {
  'use strict';

  var seed = 20260923;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function ri(a, b) { return Math.floor(a + rnd() * (b - a + 1)); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function hms(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // ---------------- 태그 ----------------
  // tag / desc / unit / pv / sp / lo / hi / loLo / hiHi / src
  var TAGS = [
    { tag: 'MIX01_TT101', desc: '배합 1호기 반응조 온도', unit: '℃',  pv: 48.6, sp: 48, lo: 44, hi: 52, loLo: 40, hiHi: 56, src: 'LS XGT' },
    { tag: 'MIX01_PT102', desc: '배합 1호기 내압',        unit: 'bar', pv: 1.02, sp: 1.0, lo: 0.85, hi: 1.25, loLo: 0.7, hiHi: 1.5, src: 'LS XGT' },
    { tag: 'MIX01_ST103', desc: '배합 1호기 교반속도',    unit: 'rpm', pv: 60,   sp: 60, lo: 52, hi: 68, loLo: 40, hiHi: 80, src: 'LS XGT' },
    { tag: 'MIX02_TT201', desc: '배합 2호기 반응조 온도', unit: '℃',  pv: 63.8, sp: 62, lo: 58, hi: 66, loLo: 54, hiHi: 70, src: 'LS XGT' },
    { tag: 'MIX02_PT202', desc: '배합 2호기 내압',        unit: 'bar', pv: 1.08, sp: 1.0, lo: 0.85, hi: 1.25, loLo: 0.7, hiHi: 1.5, src: 'LS XGT' },
    { tag: 'MIX02_ST203', desc: '배합 2호기 교반속도',    unit: 'rpm', pv: 138,  sp: 140, lo: 128, hi: 152, loLo: 110, hiHi: 170, src: 'LS XGT' },
    { tag: 'CT01_TT301',  desc: '코팅 1라인 건조로 온도', unit: '℃',  pv: 118.4, sp: 120, lo: 112, hi: 128, loLo: 105, hiHi: 138, src: 'Mitsubishi MC' },
    { tag: 'CT01_SP302',  desc: '코팅 1라인 라인속도',    unit: 'm/min', pv: 24.2, sp: 25, lo: 20, hi: 28, loLo: 15, hiHi: 32, src: 'Mitsubishi MC' },
    { tag: 'CT01_TH303',  desc: '코팅 1라인 도포두께',    unit: 'mm',  pv: 0.124, sp: 0.120, lo: 0.114, hi: 0.126, loLo: 0.112, hiHi: 0.128, src: 'Vision' },
    { tag: 'CT02_TT401',  desc: '코팅 2라인 건조로 온도', unit: '℃',  pv: 141.2, sp: 120, lo: 112, hi: 128, loLo: 105, hiHi: 138, src: 'Mitsubishi MC' },
    { tag: 'CT02_SP402',  desc: '코팅 2라인 라인속도',    unit: 'm/min', pv: 11.8, sp: 25, lo: 20, hi: 28, loLo: 15, hiHi: 32, src: 'Mitsubishi MC' },
    { tag: 'AS01_CY501',  desc: '조립 1라인 사이클타임',  unit: 's',   pv: 4.12, sp: 4.0, lo: 3.6, hi: 4.6, loLo: 3.2, hiHi: 5.2, src: 'Modbus TCP' },
    { tag: 'AS02_CY601',  desc: '조립 2라인 사이클타임',  unit: 's',   pv: 4.02, sp: 4.0, lo: 3.6, hi: 4.6, loLo: 3.2, hiHi: 5.2, src: 'Modbus TCP' },
    { tag: 'UTL_AIR701',  desc: '압축공기 공급압',        unit: 'bar', pv: 6.4,  sp: 6.5, lo: 6.0, hi: 7.0, loLo: 5.5, hiHi: 7.5, src: 'Modbus TCP' },
    { tag: 'UTL_CHW702',  desc: '냉각수 공급온도',        unit: '℃',  pv: 12.6, sp: 12, lo: 10, hi: 15, loLo: 8, hiHi: 18, src: 'Modbus TCP' },
    { tag: 'UTL_STM703',  desc: '스팀 헤더압',            unit: 'bar', pv: 7.8,  sp: 8.0, lo: 7.2, hi: 8.6, loLo: 6.5, hiHi: 9.2, src: 'Modbus TCP' },
    { tag: 'ENV_VOC801',  desc: 'A동 VOC 농도',           unit: 'ppm', pv: 18.4, sp: 0,  lo: -1, hi: 50, loLo: -1, hiHi: 100, src: '가스검지기' },
    { tag: 'ENV_O2802',   desc: 'B동 산소 농도',          unit: '%',   pv: 20.8, sp: 21, lo: 19.5, hi: 23, loLo: 18, hiHi: 25, src: '가스검지기' }
  ];

  function tagState(t) {
    if (t.pv >= t.hiHi || t.pv <= t.loLo) return 'alarm';
    if (t.pv >= t.hi || t.pv <= t.lo) return 'warn';
    return 'ok';
  }

  // ---------------- 설비 ----------------
  var EQUIP = [
    { code: 'MIX-01', name: '배합 1호기', area: 'A동', status: '가동', item: 'SH-AD330', oee: 84.2 },
    { code: 'MIX-02', name: '배합 2호기', area: 'A동', status: '가동', item: 'SH-EM220', oee: 88.1 },
    { code: 'CT-01',  name: '코팅 1라인', area: 'B동', status: '가동', item: 'SH-CF100', oee: 79.4 },
    { code: 'CT-02',  name: '코팅 2라인', area: 'B동', status: '정지', item: '-',        oee: 41.6 },
    { code: 'AS-01',  name: '조립 1라인', area: 'C동', status: '가동', item: 'SH-PM450', oee: 86.7 },
    { code: 'AS-02',  name: '조립 2라인', area: 'C동', status: '셋업', item: 'SH-PM450', oee: 72.3 },
    { code: 'INS-01', name: '검사 라인',  area: 'C동', status: '가동', item: 'SH-CF100', oee: 91.2 },
    { code: 'PK-01',  name: '포장 라인',  area: 'D동', status: '대기', item: '-',        oee: 68.9 }
  ];

  // ---------------- 알람 (ISA-18.2) ----------------
  var _alarms = null;
  function alarms() {
    if (_alarms) return _alarms;
    var now = Date.now();
    var A = [
      { pri: 1, tag: 'CT02_TT401', area: 'B동', msg: '건조로 온도 상한상한 초과 (141.2℃ / HH 138.0℃)', type: 'PVHH', ack: false, shelved: false, min: 4 },
      { pri: 1, tag: 'CT02_MTR40', area: 'B동', msg: '라인 구동 모터 과부하 트립 — 라인 정지', type: 'TRIP', ack: false, shelved: false, min: 6 },
      { pri: 2, tag: 'MIX02_TT201', area: 'A동', msg: '반응조 온도 상한 접근 (63.8℃ / H 66.0℃)', type: 'PVH', ack: false, shelved: false, min: 12 },
      { pri: 2, tag: 'UTL_AIR701', area: '유틸', msg: '압축공기 공급압 저하 경향 (6.4bar)', type: 'PVL', ack: false, shelved: false, min: 18 },
      { pri: 3, tag: 'PK01_STS90', area: 'D동', msg: '포장라인 대기 상태 30분 경과', type: 'STS', ack: false, shelved: false, min: 31 },
      { pri: 2, tag: 'CT01_TH303', area: 'B동', msg: '도포두께 관리상한 접근 (0.124mm)', type: 'PVH', ack: true, shelved: false, min: 44 },
      { pri: 3, tag: 'ENV_VOC801', area: 'A동', msg: 'VOC 농도 상승 (18.4ppm)', type: 'PVH', ack: true, shelved: false, min: 52 },
      { pri: 2, tag: 'AS01_CY501', area: 'C동', msg: '사이클타임 목표 초과 (4.12s / 4.00s)', type: 'PVH', ack: true, shelved: false, min: 68 },
      { pri: 3, tag: 'MIX01_ST103', area: 'A동', msg: '교반속도 설정값 편차', type: 'DEV', ack: true, shelved: true, min: 95 },
      { pri: 2, tag: 'UTL_CHW702', area: '유틸', msg: '냉각수 공급온도 상승 (12.6℃)', type: 'PVH', ack: true, shelved: false, min: 112 },
      { pri: 3, tag: 'INS01_CAM1', area: 'C동', msg: '비전 카메라 조도 편차', type: 'DIAG', ack: true, shelved: false, min: 140 },
      { pri: 1, tag: 'CT02_TT401', area: 'B동', msg: '건조로 온도 상한 초과 (132.4℃)', type: 'PVH', ack: true, shelved: false, min: 166 }
    ];
    _alarms = A.map(function (a, i) {
      var d = new Date(now - a.min * 60000);
      a.at = hms(d);
      a.date = ymd(d);
      a.id = 'AL-' + ymd(d).replace(/-/g, '').slice(2) + '-' + pad(100 - i);
      return a;
    });
    return _alarms;
  }

  /** ISA-18.2 알람 부하 지표. 목표: 1일 300건 이하 / 시간당 6건 이하 */
  function alarmLoad() {
    var hours = [], cnt = [];
    var base = [4, 3, 2, 3, 5, 7, 11, 9, 6, 5, 8, 14, 7, 5, 4, 6, 9, 12, 8, 5, 4, 3, 3, 4];
    for (var h = 0; h < 24; h++) { hours.push(pad(h)); cnt.push(base[h]); }
    return { hours: hours, cnt: cnt, day: cnt.reduce(function (a, b) { return a + b; }, 0), target: 6 };
  }

  /** 빈발 알람 (nuisance alarm) 상위 */
  function topAlarms() {
    return [
      { tag: 'CT02_TT401', desc: '코팅2 건조로 온도', cnt: 38, act: '필터 교체주기 단축 검토' },
      { tag: 'UTL_AIR701', desc: '압축공기 공급압',   cnt: 27, act: '컴프레서 1호 점검' },
      { tag: 'PK01_STS90', desc: '포장라인 대기',     cnt: 21, act: '상태기반 억제 적용 검토' },
      { tag: 'MIX02_TT201', desc: '배합2 반응조 온도', cnt: 16, act: '상한값 재설정 검토' },
      { tag: 'AS01_CY501', desc: '조립1 사이클타임',  cnt: 14, act: '-' },
      { tag: 'ENV_VOC801', desc: 'A동 VOC',           cnt: 9,  act: '-' }
    ];
  }

  // ---------------- CCTV ----------------
  var CAMS = [
    { id: 'CAM-01', name: 'A동 배합실 전경',   area: 'A동', ptz: true,  rec: true,  ai: '침입감지' },
    { id: 'CAM-02', name: 'A동 원료 투입구',   area: 'A동', ptz: false, rec: true,  ai: '안전모 미착용' },
    { id: 'CAM-03', name: 'B동 코팅 1라인',    area: 'B동', ptz: true,  rec: true,  ai: '-' },
    { id: 'CAM-04', name: 'B동 코팅 2라인',    area: 'B동', ptz: false, rec: true,  ai: '화재/연기' },
    { id: 'CAM-05', name: 'B동 건조로 후단',   area: 'B동', ptz: false, rec: true,  ai: '-' },
    { id: 'CAM-06', name: 'C동 조립라인 전경', area: 'C동', ptz: true,  rec: true,  ai: '위험구역 진입' },
    { id: 'CAM-07', name: 'C동 검사 스테이션', area: 'C동', ptz: false, rec: true,  ai: '-' },
    { id: 'CAM-08', name: 'D동 포장/출하',     area: 'D동', ptz: true,  rec: true,  ai: '지게차 접근' },
    { id: 'CAM-09', name: '외곽 정문',         area: '외곽', ptz: true, rec: true,  ai: '차량번호' },
    { id: 'CAM-10', name: '폐수처리장',        area: '유틸', ptz: false, rec: true, ai: '-' },
    { id: 'CAM-11', name: '위험물 저장소',     area: '유틸', ptz: false, rec: true, ai: '침입감지' },
    { id: 'CAM-12', name: '옥외 원료탱크',     area: '외곽', ptz: true,  rec: false, ai: '-' }
  ];

  function camEvents() {
    var now = Date.now();
    var E = [
      { m: 2,  cam: 'CAM-06', t: '위험구역 진입', lv: 'bad',  d: 'C동 프레스 구역 안전펜스 내부 인원 감지' },
      { m: 9,  cam: 'CAM-02', t: '안전모 미착용', lv: 'warn', d: 'A동 원료 투입구 작업자 1명' },
      { m: 17, cam: 'CAM-08', t: '지게차 접근',   lv: 'warn', d: 'D동 출하장 보행자 근접 (2.1m)' },
      { m: 34, cam: 'CAM-09', t: '차량 출입',     lv: 'info', d: '정문 화물차 진입 (12구4417) — 금성케미칼' },
      { m: 48, cam: 'CAM-11', t: '침입감지',      lv: 'warn', d: '위험물 저장소 야간 출입 — 사전승인 확인됨' },
      { m: 62, cam: 'CAM-04', t: '연기 감지',     lv: 'info', d: 'B동 코팅2 건조로 증기 — 오탐 처리' },
      { m: 88, cam: 'CAM-09', t: '차량 출입',     lv: 'info', d: '정문 화물차 출차 (37머8021)' }
    ];
    return E.map(function (e) { e.at = hms(new Date(now - e.m * 60000)); return e; });
  }

  // ---------------- 반응기 (ISA-88 배치) ----------------
  function reactors() {
    return [
      { id: 'R-201', name: '반응기 201 (배합 2호기)', batch: 'BT-260923-004', recipe: 'RC-EM220-v4',
        phase: '교반', phaseIdx: 3, temp: 63.8, spTemp: 62, press: 1.08, rpm: 138, level: 72,
        jacket: 58.2, elapsed: '02:41', remain: '01:19', status: '진행' },
      { id: 'R-101', name: '반응기 101 (배합 1호기)', batch: 'BT-260923-003', recipe: 'RC-AD330-v2',
        phase: '냉각', phaseIdx: 5, temp: 48.6, spTemp: 45, press: 1.02, rpm: 60, level: 55,
        jacket: 22.4, elapsed: '04:12', remain: '00:28', status: '진행' }
    ];
  }

  // ---------------- 에너지 ----------------
  function energy() {
    var h = [], pw = [], stm = [], wtr = [];
    for (var i = 0; i < 24; i++) {
      h.push(pad(i));
      var day = i >= 8 && i < 20;
      pw.push(Math.round((day ? 980 + rnd() * 260 : 420 + rnd() * 120)));
      stm.push(+((day ? 2.6 + rnd() * 0.9 : 1.1 + rnd() * 0.4)).toFixed(2));
      wtr.push(Math.round(day ? 18 + rnd() * 7 : 7 + rnd() * 3));
    }
    return { hours: h, power: pw, steam: stm, water: wtr };
  }

  function energyByArea() {
    return [
      { area: 'A동 배합', pw: 286, ratio: 24.1, prev: 271, unit: 0.412 },
      { area: 'B동 코팅', pw: 448, ratio: 37.8, prev: 402, unit: 0.238 },
      { area: 'C동 조립', pw: 212, ratio: 17.9, prev: 218, unit: 0.094 },
      { area: 'D동 포장', pw: 84,  ratio: 7.1,  prev: 88,  unit: 0.031 },
      { area: '유틸리티', pw: 156, ratio: 13.1, prev: 149, unit: 0 }
    ];
  }

  // ---------------- 안전 ----------------
  function safety() {
    return {
      zones: [
        { z: 'A동 배합실',     risk: '화학물질 취급', people: 3, gas: '정상', fire: '정상', st: 'ok' },
        { z: 'B동 코팅라인',   risk: '고온 · VOC',    people: 5, gas: '주의', fire: '정상', st: 'warn' },
        { z: 'C동 조립라인',   risk: '협착 · 프레스',  people: 8, gas: '정상', fire: '정상', st: 'bad' },
        { z: 'D동 포장 · 출하', risk: '지게차 동선',   people: 4, gas: '정상', fire: '정상', st: 'ok' },
        { z: '위험물 저장소',   risk: '인화성 물질',   people: 0, gas: '정상', fire: '정상', st: 'ok' },
        { z: '폐수처리장',      risk: '밀폐공간',      people: 1, gas: '정상', fire: '정상', st: 'ok' }
      ],
      checks: [
        { n: '위험성평가 정기 실시', cyc: '반기 1회', last: '2026-07-02', next: '2027-01-02', st: '완료' },
        { n: '안전보건 교육',        cyc: '분기 1회', last: '2026-07-15', next: '2026-10-15', st: '예정' },
        { n: '소방시설 점검',        cyc: '월 1회',   last: '2026-09-05', next: '2026-10-05', st: '예정' },
        { n: '밀폐공간 작업허가',    cyc: '작업 시',  last: '2026-09-18', next: '-',          st: '완료' },
        { n: '가스검지기 교정',      cyc: '반기 1회', last: '2026-03-20', next: '2026-09-20', st: '경과' },
        { n: '비상대응 훈련',        cyc: '연 1회',   last: '2026-05-14', next: '2027-05-14', st: '완료' }
      ],
      kpi: { days: 412, near: 7, ptw: 3, ppe: 2 }
    };
  }

  // ---------------- 히스토리안 트렌드 ----------------
  function history(tag, points) {
    points = points || 120;
    var t = TAGS.filter(function (x) { return x.tag === tag; })[0] || TAGS[0];
    var out = [], labels = [];
    var v = t.pv;
    var now = new Date();
    for (var i = points - 1; i >= 0; i--) {
      var d = new Date(now.getTime() - i * 60000);
      labels.push(hhmm(d));
      // 설정값을 향해 끌려가면서 잡음이 섞이는 1차 지연계 흉내
      var drift = (t.sp - v) * 0.06;
      v = v + drift + (rnd() - 0.5) * (Math.abs(t.hi - t.lo) * 0.06);
      out.push(+v.toFixed(3));
    }
    return { labels: labels, data: out, tag: t };
  }

  // ---------------- 간이 시뮬레이터 ----------------
  // 실제 운영에서는 SignalR 구독으로 대체된다.
  var listeners = [];
  function onTick(fn) { listeners.push(fn); }

  function step() {
    TAGS.forEach(function (t) {
      // 정지 상태 설비는 값이 안 움직여야 자연스럽다
      if (t.tag.indexOf('CT02') === 0) {
        t.pv = t.tag === 'CT02_TT401' ? +(t.pv - 0.06 + (rnd() - 0.5) * 0.1).toFixed(2)
             : +(Math.max(0, t.pv - 0.12)).toFixed(2);
        return;
      }
      var span = Math.abs(t.hi - t.lo);
      var pull = (t.sp - t.pv) * 0.05;
      var noise = (rnd() - 0.5) * span * 0.035;
      var next = t.pv + pull + noise;
      t.pv = +next.toFixed(t.unit === 'mm' ? 4 : t.unit === 'bar' ? 3 : 2);
    });
    listeners.forEach(function (fn) { try { fn(TAGS); } catch (e) { /* 화면 하나 죽어도 전체는 계속 */ } });
  }

  function start(ms) { setInterval(step, ms || 1500); }

  global.Mock = {
    TAGS: TAGS, EQUIP: EQUIP, CAMS: CAMS,
    tagState: tagState, tag: function (t) { return TAGS.filter(function (x) { return x.tag === t; })[0]; },
    alarms: alarms, alarmLoad: alarmLoad, topAlarms: topAlarms,
    camEvents: camEvents, reactors: reactors,
    energy: energy, energyByArea: energyByArea, safety: safety, history: history,
    onTick: onTick, start: start, hhmm: hhmm, hms: hms, ymd: ymd
  };
})(window);
