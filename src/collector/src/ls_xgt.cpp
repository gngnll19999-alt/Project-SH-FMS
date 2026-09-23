#include "ls_xgt.h"

#include <cstdio>

namespace shfms {

namespace {

// XGT 는 리틀엔디언이다. Modbus(빅엔디언)와 반대라서 처음에 값이 뒤집혀 나와
// 한참 헤맸다. 주의. (2026-08-06)
inline void put_le16(std::uint8_t* p, std::uint16_t v) {
    p[0] = static_cast<std::uint8_t>(v & 0xFF);
    p[1] = static_cast<std::uint8_t>(v >> 8);
}
inline std::uint16_t get_le16(const std::uint8_t* p) {
    return static_cast<std::uint16_t>(p[0] | (p[1] << 8));
}

constexpr std::size_t HDR_LEN = 20;

}  // namespace

bool LsXgtDevice::connect() {
    return sock_.connect(cfg_.host, cfg_.port ? cfg_.port : 2004, cfg_.timeout_ms);
}

ReadResult LsXgtDevice::read_block() {
    ReadResult r;

    if (!sock_.valid() && !connect()) {
        r.error = "connect failed";
        return r;
    }

    // 직접변수 이름 문자열: %MW<start> 형태로 연속 읽기를 건다.
    char var[32];
    std::snprintf(var, sizeof(var), "%%MW%d", cfg_.read_start);
    const std::uint16_t var_len = static_cast<std::uint16_t>(std::strlen(var));

    // ---- 명령 블록 ----
    // cmd(2) + datatype(2) + reserved(2) + blocks(2) + varlen(2) + var + count(2)
    std::vector<std::uint8_t> cmd(12 + var_len);
    put_le16(&cmd[0], 0x0004);          // 연속 읽기 요청
    put_le16(&cmd[2], 0x0014);          // 데이터 타입: 연속
    put_le16(&cmd[4], 0x0000);          // reserved
    put_le16(&cmd[6], 0x0001);          // 블록 수 1개
    put_le16(&cmd[8], var_len);
    std::memcpy(&cmd[10], var, var_len);
    put_le16(&cmd[10 + var_len], static_cast<std::uint16_t>(cfg_.read_count * 2));  // 바이트 수

    // ---- 헤더 ----
    std::vector<std::uint8_t> frame(HDR_LEN + cmd.size(), 0);
    std::memcpy(&frame[0], "LSIS-XGT", 8);
    frame[8]  = 0x00;                    // PLC info
    frame[9]  = 0x00;
    frame[10] = 0xA0;                    // CPU info
    frame[11] = 0x33;
    put_le16(&frame[12], ++invoke_id_);  // invoke id
    put_le16(&frame[14], static_cast<std::uint16_t>(cmd.size()));
    frame[16] = static_cast<std::uint8_t>(cfg_.unit_id);   // FEnet 모듈 슬롯
    frame[17] = 0x00;
    frame[18] = 0x00;                    // 체크섬 (모듈 설정에 따라 미사용)
    frame[19] = 0x00;
    std::memcpy(&frame[HDR_LEN], cmd.data(), cmd.size());

    if (!sock_.send_all(frame.data(), frame.size())) {
        sock_.close();
        r.error = "send failed";
        return r;
    }

    // ---- 응답 헤더 ----
    std::uint8_t hdr[HDR_LEN];
    if (!sock_.recv_exact(hdr, HDR_LEN)) {
        sock_.close();
        r.error = "recv header timeout";
        return r;
    }
    if (std::memcmp(hdr, "LSIS-XGT", 8) != 0) {
        sock_.close();
        r.error = "bad header signature";
        return r;
    }

    const std::uint16_t body_len = get_le16(&hdr[14]);
    if (body_len < 10 || body_len > 4096) {
        sock_.close();
        r.error = "bad body length";
        return r;
    }

    std::vector<std::uint8_t> body(body_len);
    if (!sock_.recv_exact(body.data(), body.size())) {
        sock_.close();
        r.error = "recv body timeout";
        return r;
    }

    // 응답 블록: cmd(2) + datatype(2) + reserved(2) + status(2) + blocks(2) + datalen(2) + data
    const std::uint16_t status = get_le16(&body[6]);
    if (status != 0) {
        r.error = "xgt error status 0x" + std::to_string(status);
        return r;
    }

    const std::uint16_t data_len = get_le16(&body[10]);
    const std::size_t off = 12;
    if (off + data_len > body.size()) {
        r.error = "truncated data block";
        return r;
    }

    const int count = data_len / 2;
    r.words.resize(static_cast<std::size_t>(count));
    for (int i = 0; i < count; ++i) {
        r.words[static_cast<std::size_t>(i)] = get_le16(&body[off + i * 2]);
    }
    r.ok = true;
    return r;
}

}  // namespace shfms
