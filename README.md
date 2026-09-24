# SH-FMS — 자동화공장 통합 모니터링

> **프로젝트SH** · 개인 프로젝트 · 남성흠
> 국내외 패키지와 국제표준을 조사해 "이런 공장이 있다면 시스템을 어떻게 설계할 것인가"를
> 끝까지 밀어붙여 본 기록이다. 등장하는 공장·라인·품목·수치는 설계를 구체화하기 위한 전제이고,
> 화면과 코드는 실제로 동작한다.

공정 태그 · CCTV · 에너지 · 안전을 한 화면으로 묶는 공장 관제 시스템.
관제 화면(HTML/JS) + C++ 태그 수집기 + C# 게이트웨이로 구성된다.

```
PLC ──(Modbus TCP / LS XGT)──> [C++ 수집기] ──HTTP──> [C# 게이트웨이] ──SignalR──> 관제 화면
                                                            │
                                                    히스토리안 / ISA-18.2 알람엔진
```

## 이 시스템이 풀려는 문제

관제실에 설비사가 각자 납품한 화면이 5개 따로 떠 있다.
1차 통합 화면은 상태마다 색을 다 넣어서 알록달록한데, 정작 이상이 나도 눈에 안 띈다.
알람은 하루 700~900건 뜨고, 운전원은 대부분 무시한다.

2026-05-14 CT-02 건조로 과열 알람이 40분간 떠 있었는데 아무도 못 봤다.
운전원이 다른 화면을 보고 있었고, 알람은 그 화면에 안 뜨는 구조였다.

그래서 이번엔 **ISA-101(고성능 HMI)** 과 **ISA-18.2(알람 관리)** 를 설계 기준으로 못 박았다.

- 평상시 화면에는 색이 거의 없다. 정상 공정값은 전부 저채도 회색이다.
- 색은 경고(앰버) · 알람(레드) · 조치필요(블루) 세 가지에만 쓴다.
- 브랜드 색(시안)은 네비게이션 전용. 공정 데이터에는 쓰지 않는다.
- **알람 배너는 어느 화면에 있어도 최상단에 고정된다.**

화면에서 색이 보이면 그 자체가 신호가 되어야 한다는 게 요지다.

## 실행

### 관제 화면만 (백엔드 없이 시연)

```bash
python -m http.server 8080
```

`http://localhost:8080` → 인트로 → 관제 화면 접속.
백엔드가 없을 때는 `assets/js/mock.js` 의 간이 시뮬레이터가 태그 값을 움직인다.

### 백엔드까지 (전체 구성)

```bash
# C# 게이트웨이
cd src/SHFms.Server && dotnet run --urls http://0.0.0.0:5080

# C++ 수집기
cd src/collector
cmake -B build && cmake --build build --config Release
./build/Release/shfms_collector config/devices.json
```

자세한 내용은 [`src/README.md`](src/README.md).

### 데모 계정

| 아이디 | 비밀번호 | 등급 | 권한 |
|---|---|---|---|
| `test` | `test` | 3 | 전 권한 |
| `op02` | `op02` | 2 | 알람 ACK · 셸빙 · PTZ |
| `view` | `view` | 1 | 조회만 (ACK·PTZ 불가) |

`view` 로 로그인하면 알람 확인 버튼과 PTZ 조작이 막히는 걸 볼 수 있다.

## 화면

| 계층 | 화면 | 경로 |
|---|---|---|
| Level 1 | 공장 전체 감시 | `app/overview.html` |
| Level 2 | 라인 공정 미믹 | `app/line.html` |
| Level 2 | 화학 배치 공정 | `app/chemical.html` |
| Level 2 | 에너지 · 유틸리티 | `app/energy.html` |
| Level 3 | CCTV 통합관제 | `app/cctv.html` |
| Level 3 | 안전 관제 | `app/safety.html` |
| Level 4 | 알람 관리 | `app/alarm.html` |
| Level 4 | 트렌드 · 히스토리안 | `app/trend.html` |

## 구조

```
index.html              인트로
login.html              로그인
app/                    관제 화면 8종
assets/
  css/app.css           ISA-101 색 예산이 코드로 들어가 있는 곳
  js/auth.js            세션 + 등급별 조작 권한
  js/shell.js           알람 배너 + 메뉴 공통 렌더
  js/chart.js           SVG 차트
  js/cctv.js            영상 뷰어 (실제 카메라 없을 때 합성 영상)
  js/mock.js            시연 데이터 + 간이 시뮬레이터
src/
  collector/            C++ 태그 수집기
  SHFms.Server/         C# 게이트웨이 (ASP.NET Core)
docs/                   사전조사 · 작업지시서 · 요구사항 · 화면설계 · 보고서
presentation/           발표자료
```

## 알람 엔진이 막는 것

1차 시스템은 한계값을 넘을 때마다 새 알람을 만들었다. 값이 경계에서 떨리면
같은 알람이 분당 수십 건 쌓였다. 세 가지로 막는다.

| 장치 | 내용 |
|---|---|
| 중복 억제 | 같은 태그·같은 유형 알람이 활성이면 새로 만들지 않는다 |
| 히스테리시스 | 한계값에서 `deadband` 만큼 확실히 되돌아와야 해소로 본다 |
| 상태기반 억제 | 설비 정지 구간에는 그 설비 알람을 띄우지 않는다 |

확인하지 않은 채 해소된 알람은 목록에 남긴다. 조용히 사라지면 아무도 모른다.
셸빙은 만료시각을 반드시 넣고 최대 8시간으로 자른다 (ISA-18.2 무기한 셸빙 금지).

## 제약

**이 시스템은 읽기 전용이다.** 설비 제어 명령은 취급하지 않는다.
제어는 SCADA/PLC 권한이고, 감시 시스템이 쓰기 경로를 갖는 순간
보안 심사와 안전 검토가 완전히 다른 등급이 된다. (2026-07-24 설계 검토)

CCTV 는 현재 합성 영상으로 화면 자리만 확보한 상태다.
실제 중계(ONVIF/RTSP → WebRTC)는 NVR 교체(11월) 이후 붙는다.
`Cctv.attach(el, cam)` 인터페이스는 고정해 두었으므로 내부만 `<video>` 로 바꾸면 된다.

## 연관 시스템

- [SH-MES](../sh-mes) — 제조실행시스템 (설비 가동상태 · 알람 공유)
- [SH-ERP](../sh-erp) — 전사적자원관리 (에너지 사용량 송신)

## 만든 사람

| | |
|---|---|
| 이름 | **남성흠** |
| 출생 | 1996년생 |
| 경력 | 중소기업 데이터센터 **7년 8개월차** (2026년 9월 기준) |
| GitHub | [gngnll19999-alt](https://github.com/gngnll19999-alt) |

### 프로젝트SH 3부작

- [Project-SH-MES](https://github.com/gngnll19999-alt/Project-SH-MES) — SH-MES 제조실행시스템
- [Project-SH-ERP](https://github.com/gngnll19999-alt/Project-SH-ERP) — SH-ERP 전사적자원관리
- [Project-SH-FMS](https://github.com/gngnll19999-alt/Project-SH-FMS) — SH-FMS 자동화공장 통합 모니터링 **(현재 저장소)**
