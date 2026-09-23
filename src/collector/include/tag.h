// 태그 자료형.
// 게이트웨이(C#)로 올라가는 JSON 필드명과 1:1로 맞춰 두었다.
// 이름을 바꾸면 SHFms.Server 의 TagValue 레코드도 같이 고쳐야 한다.
#pragma once

#include <string>
#include <cstdint>

namespace shfms {

// OPC UA 품질 코드를 따라간다. 셋 이상 필요해진 적이 없어서 3개만 쓴다.
enum class Quality : std::uint8_t {
    Good        = 0,
    Uncertain   = 1,   // 통신은 되는데 값이 의심스러움 (스케일 범위 밖 등)
    Bad         = 2    // 통신 두절, 디바이스 응답 없음
};

inline const char* to_string(Quality q) {
    switch (q) {
        case Quality::Good:      return "Good";
        case Quality::Uncertain: return "Uncertain";
        default:                 return "Bad";
    }
}

// 태그 1개의 정의. devices.json 에서 읽어 들인다.
struct TagDef {
    std::string name;        // 예: "CT01_TT301"
    std::string device;      // 소속 디바이스 id
    int         address = 0; // 레지스터 주소 (프로토콜별 해석)
    int         words   = 1; // 1 = 16bit, 2 = 32bit
    bool        is_float = false;

    double scale  = 1.0;     // 엔지니어링 단위 환산: eu = raw * scale + offset
    double offset = 0.0;
    double deadband = 0.0;   // 이 값보다 작게 변하면 전송하지 않는다

    std::string unit;
    std::string desc;
};

// 현재 값.
struct TagValue {
    std::string name;
    double      value = 0.0;
    Quality     quality = Quality::Bad;
    std::int64_t ts_ms = 0;   // epoch millis (UTC)
};

}  // namespace shfms
