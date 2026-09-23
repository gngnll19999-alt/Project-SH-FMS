// Modbus TCP 드라이버.
// 기능코드 3 (Read Holding Registers) 만 쓴다. 본 시스템은 감시 전용이라 쓰기는 없다.
#pragma once

#include "device.h"
#include "net.h"

namespace shfms {

class ModbusTcpDevice : public IDevice {
public:
    explicit ModbusTcpDevice(DeviceConfig cfg) : cfg_(std::move(cfg)) {}

    const std::string& id() const override { return cfg_.id; }
    bool connected() const override { return sock_.valid(); }

    bool connect() override;
    void disconnect() override { sock_.close(); }
    ReadResult read_block() override;

private:
    DeviceConfig cfg_;
    net::TcpClient sock_;
    std::uint16_t tid_ = 0;   // 트랜잭션 ID. 응답 짝 맞추기용
};

}  // namespace shfms
