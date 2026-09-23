// 태그 저장소.
// 원시 워드 → 엔지니어링 단위 변환, 데드밴드 적용, 변화분 추출까지 담당한다.
//
// 데드밴드를 여기서 거는 이유: 1초 × 1,284 태그면 초당 1,284건인데
// 실제로 의미 있게 변하는 건 100건 안팎이다. 나머지를 다 올리면
// 게이트웨이 DB 가 쓸데없이 커지고 브라우저 푸시도 밀린다.
#pragma once

#include "device.h"
#include "tag.h"

#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace shfms {

class TagStore {
public:
    void register_device(const DeviceConfig& cfg);

    // 읽어온 워드 블록을 해당 디바이스 태그들에 반영한다.
    void apply(const std::string& device_id, const ReadResult& res, int read_start);

    // 통신 실패 시 해당 디바이스 태그 전체를 Bad 로 떨어뜨린다.
    void mark_bad(const std::string& device_id);

    // 마지막 전송 이후 데드밴드를 넘어 변한 값만 꺼내 간다 (꺼내면 초기화).
    std::vector<TagValue> take_changed();

    std::size_t tag_count() const { return defs_.size(); }

private:
    struct Entry {
        TagDef   def;
        TagValue cur;
        double   last_sent = 0.0;
        bool     dirty = false;
        bool     ever_sent = false;
    };

    static double decode(const TagDef& def, const std::vector<std::uint16_t>& words, int idx);

    mutable std::mutex mtx_;
    std::unordered_map<std::string, Entry> defs_;                  // tag name → entry
    std::unordered_map<std::string, std::vector<std::string>> by_device_;
};

}  // namespace shfms
