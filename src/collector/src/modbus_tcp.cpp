#include "modbus_tcp.h"

namespace shfms {

bool ModbusTcpDevice::connect() {
    return sock_.connect(cfg_.host, cfg_.port, cfg_.timeout_ms);
}

ReadResult ModbusTcpDevice::read_block() {
    ReadResult r;

    if (!sock_.valid() && !connect()) {
        r.error = "connect failed";
        return r;
    }

    // Modbus 한 번에 최대 125 레지스터. 그보다 크면 설정 오류로 본다.
    if (cfg_.read_count <= 0 || cfg_.read_count > 125) {
        r.error = "read_count out of range (1..125)";
        return r;
    }

    // ---- MBAP 헤더(7) + PDU(5) ----
    std::uint8_t req[12];
    const std::uint16_t tid = ++tid_;
    req[0] = static_cast<std::uint8_t>(tid >> 8);
    req[1] = static_cast<std::uint8_t>(tid & 0xFF);
    req[2] = 0; req[3] = 0;                    // protocol id = 0
    req[4] = 0; req[5] = 6;                    // length = unit(1) + pdu(5)
    req[6] = static_cast<std::uint8_t>(cfg_.unit_id);
    req[7] = 0x03;                             // read holding registers
    req[8]  = static_cast<std::uint8_t>(cfg_.read_start >> 8);
    req[9]  = static_cast<std::uint8_t>(cfg_.read_start & 0xFF);
    req[10] = static_cast<std::uint8_t>(cfg_.read_count >> 8);
    req[11] = static_cast<std::uint8_t>(cfg_.read_count & 0xFF);

    if (!sock_.send_all(req, sizeof(req))) {
        sock_.close();
        r.error = "send failed";
        return r;
    }

    std::uint8_t hdr[9];
    if (!sock_.recv_exact(hdr, sizeof(hdr))) {
        sock_.close();
        r.error = "recv header timeout";
        return r;
    }

    const std::uint16_t rtid = static_cast<std::uint16_t>((hdr[0] << 8) | hdr[1]);
    if (rtid != tid) {
        // 응답이 밀려서 앞 요청 것이 오는 경우. 세션을 끊고 다음 스캔에서 새로 잡는다.
        sock_.close();
        r.error = "transaction id mismatch";
        return r;
    }

    if (hdr[7] & 0x80) {
        r.error = "modbus exception " + std::to_string(static_cast<int>(hdr[8]));
        return r;
    }

    const int byte_count = hdr[8];
    if (byte_count != cfg_.read_count * 2) {
        sock_.close();
        r.error = "unexpected byte count";
        return r;
    }

    std::vector<std::uint8_t> body(static_cast<std::size_t>(byte_count));
    if (!sock_.recv_exact(body.data(), body.size())) {
        sock_.close();
        r.error = "recv body timeout";
        return r;
    }

    r.words.resize(static_cast<std::size_t>(cfg_.read_count));
    for (int i = 0; i < cfg_.read_count; ++i) {
        r.words[static_cast<std::size_t>(i)] =
            static_cast<std::uint16_t>((body[i * 2] << 8) | body[i * 2 + 1]);
    }
    r.ok = true;
    return r;
}

}  // namespace shfms
