#include "tag_store.h"

#include <chrono>
#include <cmath>
#include <cstring>

namespace shfms {

namespace {
std::int64_t now_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}
}  // namespace

void TagStore::register_device(const DeviceConfig& cfg) {
    std::lock_guard<std::mutex> lk(mtx_);
    auto& list = by_device_[cfg.id];
    for (const auto& t : cfg.tags) {
        Entry e;
        e.def = t;
        e.cur.name = t.name;
        e.cur.quality = Quality::Bad;   // 첫 스캔 전까지는 Bad 가 맞다
        defs_[t.name] = e;
        list.push_back(t.name);
    }
}

double TagStore::decode(const TagDef& def, const std::vector<std::uint16_t>& words, int idx) {
    if (def.words == 2) {
        // PLC 는 대개 상위 워드가 먼저 온다. 기종에 따라 다르면 config 로 뺄 것.
        std::uint32_t raw = (static_cast<std::uint32_t>(words[idx]) << 16) | words[idx + 1];
        if (def.is_float) {
            float f;
            std::memcpy(&f, &raw, sizeof(f));
            return static_cast<double>(f);
        }
        return static_cast<double>(static_cast<std::int32_t>(raw));
    }
    return static_cast<double>(static_cast<std::int16_t>(words[idx]));
}

void TagStore::apply(const std::string& device_id, const ReadResult& res, int read_start) {
    if (!res.ok) { mark_bad(device_id); return; }

    std::lock_guard<std::mutex> lk(mtx_);
    auto it = by_device_.find(device_id);
    if (it == by_device_.end()) return;

    const auto ts = now_ms();

    for (const auto& name : it->second) {
        auto& e = defs_[name];
        const int idx = e.def.address - read_start;

        // 블록 밖이면 설정 오류다. 조용히 넘기지 말고 품질을 떨어뜨려 눈에 띄게 한다.
        if (idx < 0 || idx + e.def.words > static_cast<int>(res.words.size())) {
            e.cur.quality = Quality::Uncertain;
            e.cur.ts_ms = ts;
            continue;
        }

        const double raw = decode(e.def, res.words, idx);
        const double eu  = raw * e.def.scale + e.def.offset;

        e.cur.value = eu;
        e.cur.quality = Quality::Good;
        e.cur.ts_ms = ts;

        if (!e.ever_sent || std::fabs(eu - e.last_sent) >= e.def.deadband) {
            e.dirty = true;
        }
    }
}

void TagStore::mark_bad(const std::string& device_id) {
    std::lock_guard<std::mutex> lk(mtx_);
    auto it = by_device_.find(device_id);
    if (it == by_device_.end()) return;

    const auto ts = now_ms();
    for (const auto& name : it->second) {
        auto& e = defs_[name];
        if (e.cur.quality != Quality::Bad) {
            // 품질 변화 자체가 게이트웨이에 알려야 할 이벤트다
            e.cur.quality = Quality::Bad;
            e.dirty = true;
        }
        e.cur.ts_ms = ts;
    }
}

std::vector<TagValue> TagStore::take_changed() {
    std::lock_guard<std::mutex> lk(mtx_);
    std::vector<TagValue> out;
    out.reserve(64);

    for (auto& kv : defs_) {
        auto& e = kv.second;
        if (!e.dirty) continue;
        out.push_back(e.cur);
        e.last_sent = e.cur.value;
        e.ever_sent = true;
        e.dirty = false;
    }
    return out;
}

}  // namespace shfms
