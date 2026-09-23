// devices.json 로더.
//
// JSON 라이브러리를 안 쓴 이유는 uploader 와 같다 — 읽는 형태가 하나로 고정이고,
// 폐쇄망 반입 심의를 또 받느니 최소 파서를 쓰는 게 빠르다.
// 대신 형식을 엄격하게 본다. 조금이라도 어긋나면 기동을 거부한다.
// 설정이 조용히 틀린 채로 도는 것보다 아예 안 뜨는 쪽이 낫다.
#pragma once

#include "device.h"

#include <string>
#include <vector>

namespace shfms {

struct AppConfig {
    int scan_period_ms = 1000;

    std::string gw_host = "127.0.0.1";
    int         gw_port = 5080;
    std::string gw_path = "/api/v1/tags/batch";
    std::string api_key = "";

    std::vector<DeviceConfig> devices;
};

// 실패 시 error 에 사유를 담고 false 를 반환한다.
bool load_config(const std::string& path, AppConfig& out, std::string& error);

}  // namespace shfms
