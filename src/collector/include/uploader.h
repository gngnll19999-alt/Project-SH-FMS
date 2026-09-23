// 게이트웨이 업로더.
// 변화분 태그를 모아 C# 게이트웨이(POST /api/v1/tags/batch)로 올린다.
//
// 전송 실패 시 값을 버리지 않고 큐에 쌓아 두었다가 다음에 같이 올린다.
// 게이트웨이 재기동 중에 데이터가 비는 걸 막기 위함. 큐 상한을 넘으면
// 오래된 것부터 버린다 (메모리 보호).
#pragma once

#include "tag.h"

#include <cstddef>
#include <deque>
#include <string>
#include <vector>

namespace shfms {

class Uploader {
public:
    Uploader(std::string host, int port, std::string path, std::string api_key)
        : host_(std::move(host)), port_(port), path_(std::move(path)), key_(std::move(api_key)) {}

    // 전송 성공 여부. 실패해도 예외는 던지지 않는다.
    bool flush(std::vector<TagValue> values);

    std::size_t pending() const { return queue_.size(); }
    std::size_t sent_total() const { return sent_; }
    std::size_t fail_total() const { return fails_; }

private:
    static std::string to_json(const std::vector<TagValue>& v);
    bool post(const std::string& body);

    std::string host_;
    int         port_;
    std::string path_;
    std::string key_;

    std::deque<TagValue> queue_;
    std::size_t max_queue_ = 50000;
    std::size_t sent_ = 0;
    std::size_t fails_ = 0;
};

}  // namespace shfms
