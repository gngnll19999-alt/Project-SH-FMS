#include "uploader.h"
#include "net.h"

#include <algorithm>
#include <cstdio>
#include <sstream>

namespace shfms {

std::string Uploader::to_json(const std::vector<TagValue>& v) {
    // JSON 라이브러리를 안 쓴다. 내보내는 형태가 하나뿐이라 직접 쓰는 게 낫다.
    std::ostringstream os;
    os << "{\"source\":\"collector-01\",\"values\":[";
    for (std::size_t i = 0; i < v.size(); ++i) {
        const auto& t = v[i];
        if (i) os << ',';
        char buf[48];
        std::snprintf(buf, sizeof(buf), "%.6g", t.value);
        os << "{\"tag\":\"" << t.name << "\","
           << "\"value\":" << buf << ","
           << "\"quality\":\"" << to_string(t.quality) << "\","
           << "\"ts\":" << t.ts_ms << "}";
    }
    os << "]}";
    return os.str();
}

bool Uploader::post(const std::string& body) {
    net::TcpClient c;
    if (!c.connect(host_, port_, 2000)) return false;

    std::ostringstream req;
    req << "POST " << path_ << " HTTP/1.1\r\n"
        << "Host: " << host_ << ':' << port_ << "\r\n"
        << "Content-Type: application/json\r\n"
        << "X-Api-Key: " << key_ << "\r\n"
        << "Content-Length: " << body.size() << "\r\n"
        << "Connection: close\r\n\r\n"
        << body;

    const std::string s = req.str();
    if (!c.send_all(reinterpret_cast<const std::uint8_t*>(s.data()), s.size())) return false;

    // 상태줄만 확인한다. 본문은 관심 없음.
    std::uint8_t line[16] = {0};
    if (!c.recv_exact(line, 12)) return false;
    return std::memcmp(line + 9, "200", 3) == 0 || std::memcmp(line + 9, "202", 3) == 0;
}

bool Uploader::flush(std::vector<TagValue> values) {
    for (auto& v : values) queue_.push_back(std::move(v));

    while (queue_.size() > max_queue_) queue_.pop_front();
    if (queue_.empty()) return true;

    // 한 번에 다 보내면 대형 요청이 되므로 끊어 보낸다.
    const std::size_t chunk = 500;
    std::vector<TagValue> batch;
    batch.reserve(std::min(chunk, queue_.size()));
    for (std::size_t i = 0; i < chunk && !queue_.empty(); ++i) {
        batch.push_back(queue_.front());
        queue_.pop_front();
    }

    if (post(to_json(batch))) {
        sent_ += batch.size();
        return true;
    }

    // 실패분은 앞쪽에 되돌려 놓는다 (순서 유지)
    for (auto it = batch.rbegin(); it != batch.rend(); ++it) queue_.push_front(*it);
    ++fails_;
    return false;
}

}  // namespace shfms
