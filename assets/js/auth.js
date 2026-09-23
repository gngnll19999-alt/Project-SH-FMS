/* 로그인 세션.
 * 관제 계정은 등급이 조작 권한과 직결되므로(알람 확인·셸빙·리셋) 세션에 등급을 싣는다.
 * 운영은 사내 AD 연동 + 2단계 인증으로 교체 예정. (요구사항 SH-FMS-REQ-071)
 */
(function (global) {
  'use strict';

  var KEY = 'shfms.session';

  var ACCOUNTS = [
    { id: 'test',  pw: 'test',  name: '남성흠', dept: '제어기술팀',   role: '관제운영자', lv: 3 },
    { id: 'op02',  pw: 'op02',  name: '강도현', dept: '생산운전2팀', role: '운전원',     lv: 2 },
    { id: 'view',  pw: 'view',  name: '방문자', dept: '-',           role: '조회전용',   lv: 1 }
  ];

  function login(id, pw) {
    var u = ACCOUNTS.filter(function (a) {
      return a.id === String(id || '').trim().toLowerCase() && a.pw === pw;
    })[0];
    if (!u) return null;
    var s = { id: u.id, name: u.name, dept: u.dept, role: u.role, lv: u.lv, at: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(s));
    return s;
  }

  function current() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  function base() { return location.pathname.indexOf('/app/') > -1 ? '../' : './'; }

  function logout() { sessionStorage.removeItem(KEY); location.href = base() + 'login.html'; }

  function guard() {
    var s = current();
    if (!s) {
      location.replace(base() + 'login.html?redirect=' + encodeURIComponent(location.pathname.split('/').pop()));
      return null;
    }
    return s;
  }

  /** lv 2 이상만 알람 확인/셸빙 가능. 조회전용(lv1)은 볼 수만 있다. */
  function canOperate() {
    var s = current();
    return !!s && s.lv >= 2;
  }

  global.Auth = { login: login, logout: logout, current: current, guard: guard, base: base, canOperate: canOperate };
})(window);
