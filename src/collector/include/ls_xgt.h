// LS ELECTRIC XGT 전용 이더넷 프로토콜(FEnet) 드라이버.
//
// XGT 도 Modbus TCP 를 지원하긴 하는데, 현장 A동 PLC 는 Modbus 슬레이브 설정이
// 다른 용도로 이미 점유되어 있어 전용 프로토콜로 붙였다. (2026-08-04 현장 확인)
//
// 프레임: 'LSIS-XGT' 헤더(20) + 명령 블록.
// 연속 읽기(명령 0x0004, 데이터타입 0x0014)만 사용한다.
#pragma once

#include "device.h"
#include "net.h"

namespace shfms {

class LsXgtDevice : public IDevice {
public:
    explicit LsXgtDevice(DeviceConfig cfg) : cfg_(std::move(cfg)) {}

    const std::string& id() const override { return cfg_.id; }
    bool connected() const override { return sock_.valid(); }

    bool connect() override;
    void disconnect() override { sock_.close(); }
    ReadResult read_block() override;

private:
    DeviceConfig cfg_;
    net::TcpClient sock_;
    std::uint16_t invoke_id_ = 0;
};

}  // namespace shfms
