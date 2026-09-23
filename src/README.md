# SH-FMS 백엔드 — C++ 수집기 + C# 게이트웨이

관제 화면(`/app/*.html`)은 이 두 프로그램이 만들어 주는 데이터를 본다.

```
PLC ──(Modbus TCP / LS XGT)──> [C++ 수집기] ──HTTP POST──> [C# 게이트웨이] ──SignalR──> 브라우저
                                                                  │
                                                            히스토리안 / 알람엔진
```

## 왜 언어를 나눴나

**수집기 = C++**
1초 주기로 8대 PLC, 1,284 태그를 폴링한다. 스캔이 밀리면 트렌드에 구멍이 생긴다.
GC 일시정지를 신경 쓰지 않아도 되는 쪽을 골랐다. 상주 메모리도 20MB 안쪽이라
현장 산업용 PC(메모리 4GB, 다른 프로그램과 공유)에 올리기 부담이 없다.

**게이트웨이 = C#**
하는 일이 REST / SignalR / JSON / 시계열 관리다. 여기서 C++을 쓸 이유가 없다.
ASP.NET Core 가 다 들어 있어서 NuGet 패키지도 하나 안 썼다 (제어망 반입 심의 회피).

## 빌드 · 실행

```bash
# C++ 수집기
cd collector
cmake -B build
cmake --build build --config Release
./build/Release/shfms_collector config/devices.json

# C# 게이트웨이
cd SHFms.Server
dotnet run --urls http://0.0.0.0:5080
```

빌드 확인 환경: MSVC 14.51 (VS 18) / .NET 10.0.103 / CMake 3.20+

## collector — C++ 수집기

| 파일 | 역할 |
|---|---|
| `src/main.cpp` | 폴링 루프, 재접속 백오프, 스캔 주기 고정 |
| `include/device.h` | 드라이버 인터페이스 (`IDevice`) |
| `src/modbus_tcp.cpp` | Modbus TCP (기능코드 3, 읽기 전용) |
| `src/ls_xgt.cpp` | LS ELECTRIC XGT FEnet 전용 프로토콜 |
| `src/tag_store.cpp` | 단위 환산, 데드밴드, 변화분 추출 |
| `src/uploader.cpp` | 게이트웨이 전송 + 실패분 큐잉 |
| `src/config.cpp` | devices.json 로더 (최소 JSON 파서) |
| `include/net.h` | TCP 클라이언트 (Winsock2 / POSIX) |

### 설계에서 신경 쓴 것

**데드밴드** — 1초 × 1,284 태그면 초당 1,284건이지만 실제로 의미 있게 변하는 건
100건 안팎이다. 나머지를 다 올리면 게이트웨이 DB 가 쓸데없이 커지고 브라우저 푸시도 밀린다.
태그별 `deadband` 를 넘어야만 전송 대상이 된다.

**논블로킹 connect** — 처음엔 블로킹 `connect()` 로 짰다가 현장 시험에서 물렸다.
PLC 한 대가 꺼져 있으면 OS 기본 연결 타임아웃(윈도우 ~20초)까지 호출이 안 돌아오고,
폴링 루프가 단일 스레드라 나머지 7대 스캔이 통째로 멈춘다.
지금은 논블로킹 + `select()` 로 `timeout_ms` 를 연결 단계에도 실제로 먹인다.

**재접속 백오프** — 죽은 PLC 에 1초마다 붙으러 가면 로그만 더러워진다.
실패 횟수에 따라 1초 → 5초 → 15초 → 60초로 늘린다.

**스캔 오버런 로그** — 주기를 못 지켰으면 조용히 넘어가지 않고 반드시 남긴다.
이게 없으면 "왜 트렌드가 띄엄띄엄하지?" 를 나중에 추적할 수 없다.

**엔디언** — Modbus 는 빅엔디언, XGT 는 리틀엔디언이다. 반대라서 처음에 값이 뒤집혀 나와
한참 헤맸다. `ls_xgt.cpp` 상단 주석 참고.

## SHFms.Server — C# 게이트웨이

| 파일 | 역할 |
|---|---|
| `Program.cs` | Minimal API 엔드포인트, SignalR 등록, 알람설정 로드 |
| `Services/TagStore.cs` | 현재값 + 태그 메타. ISA-101 상태(ok/warn/alarm/bad) 판정 |
| `Services/AlarmEngine.cs` | ISA-18.2 알람 엔진 |
| `Services/Historian.cs` | 시계열 링버퍼 + 구간 조회/통계 |
| `Hubs/TagHub.cs` | SignalR 실시간 푸시 (구역 단위 그룹) |
| `config/alarms.json` | 태그별 한계값 · 우선순위 · 데드밴드 |

### 알람 엔진이 막는 것

1차 시스템은 한계값을 넘을 때마다 새 알람을 만들어서, 값이 경계에서 떨릴 때
같은 알람이 분당 수십 건씩 쌓였다. 세 가지로 막는다.

| 장치 | 내용 |
|---|---|
| 중복 억제 | 같은 태그·같은 유형 알람이 이미 활성이면 새로 만들지 않는다 |
| 히스테리시스 | 한계값에서 `deadband` 만큼 확실히 되돌아와야 해소로 본다 |
| 상태기반 억제 | 설비 정지 구간에는 그 설비 알람을 띄우지 않는다 (조치 불가 알람) |

확인(ACK)하지 않은 채 해소된 알람은 `UnackCleared` 로 목록에 남긴다.
아무도 모르게 사라지면 무슨 일이 있었는지 아무도 모른다.

셸빙은 만료시각을 반드시 넣고 최대 8시간으로 자른다. ISA-18.2 가 무기한 셸빙을 금지한다.

### API

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/v1/tags/batch` | 수집기 → 태그 배치 수신 (X-Api-Key 필요) |
| GET | `/api/v1/tags?area=` | 현재값 전체 / 구역별 |
| GET | `/api/v1/tags/{tag}` | 태그 단건 |
| GET | `/api/v1/history/{tag}?from=&to=&points=` | 시계열 조회 + 통계 |
| GET | `/api/v1/alarms` | 활성 알람 |
| GET | `/api/v1/alarms/load` | 알람 부하 KPI (ISA-18.2) |
| GET | `/api/v1/alarms/top` | 빈발 알람 상위 |
| POST | `/api/v1/alarms/{id}/ack` | 확인 |
| POST | `/api/v1/alarms/{id}/shelve` | 셸빙 |
| POST | `/api/v1/alarms/suppress` | 상태기반 억제 on/off |
| GET | `/api/v1/health` | 상태 |
| WS | `/hub/tags` | SignalR (`tags` / `alarms` / `alarmAck` 채널) |

### 동작 확인 (2026-09-23)

```
POST /api/v1/tags/batch  CT02_TT401=141.2, CT01_TT301=118.4, UTL_AIR701=5.4
→ {"received":3,"alarms":2}
  P1 CT02_TT401 코팅 2라인 건조로 온도 상한상한 초과 (141.2 ℃ / HH 138 ℃)
  P1 UTL_AIR701 압축공기 공급압 하한하한 미달 (5.4 bar / LL 5.5 bar)
  CT01_TT301 118.4 → 한계값 내, 알람 없음

히스테리시스 : CT01_TT301 129.0(H초과) → 127.5(해소 안 됨) → 126.0(해소)
               deadband 1.0 이 의도대로 동작
```

## 제약 — 이 서버는 읽기 전용이다

설비 제어 명령은 취급하지 않는다. 제어는 SCADA/PLC 권한이고,
감시 시스템이 쓰기 경로를 갖는 순간 보안 심사와 안전 검토가 완전히 다른 등급이 된다.
(2026-07-24 설계 검토 결정)

상위 시스템(MES/ERP)도 SCADA 서버가 아니라 이 게이트웨이의 읽기전용 API 로만 붙는다.

## 잔여 과제

- Mitsubishi MC 프로토콜 드라이버 (3차 확산)
- 히스토리안 → TimescaleDB 이전 (현재 인메모리 6시간)
- ONVIF/RTSP → WebRTC 중계 (현재 화면은 합성 영상으로 자리만 확보)
- 수집기 이중화 (현재 단일 인스턴스)
- mTLS (사무망 노출 시)
