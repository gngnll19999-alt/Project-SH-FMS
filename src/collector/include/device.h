// 디바이스(PLC) 드라이버 인터페이스.
//
// 프로토콜이 늘어날 때마다 main.cpp 를 고치지 않으려고 인터페이스로 뺐다.
// 현재 구현체는 ModbusTcpDevice, LsXgtDevice 둘이고,
// Mitsubishi MC 프로토콜은 3차 확산 때 추가 예정이다.
#pragma once

#include "tag.h"

#include <memory>
#include <string>
#include <vector>

namespace shfms {

struct DeviceConfig {
    std::string id;          // "MIX-01"
    std::string protocol;    // "modbus_tcp" | "ls_xgt"
    std::string host;
    int         port = 502;
    int         unit_id = 1;
    int         timeout_ms = 1000;

    // 한 번에 읽어올 블록. 태그마다 따로 읽으면 스캔이 못 따라간다.
    int read_start = 0;
    int read_count = 64;

    std::vector<TagDef> tags;
};

// 읽기 결과. 워드 배열 그대로 올린다 (해석은 TagStore 가 한다).
struct ReadResult {
    bool ok = false;
    std::vector<std::uint16_t> words;
    std::string error;
};

class IDevice {
public:
    virtual ~IDevice() = default;

    virtual const std::string& id() const = 0;
    virtual bool connected() const = 0;

    // 접속. 실패해도 예외를 던지지 않는다 — 폴링 루프가 계속 돌아야 한다.
    virtual bool connect() = 0;
    virtual void disconnect() = 0;

    // 설정된 블록을 한 번에 읽는다.
    virtual ReadResult read_block() = 0;
};

std::unique_ptr<IDevice> make_device(const DeviceConfig& cfg);

}  // namespace shfms
