// SH-FMS 태그 수집기
//
// PLC 를 고정 주기로 폴링해 게이트웨이(C#)로 올린다.
// C++ 로 쓴 이유: 1초 주기 × 8대 × 1,284 태그에서 스캔이 밀리면
// 트렌드에 구멍이 생긴다. GC 일시정지를 걱정하지 않아도 되는 쪽을 택했다.
//
// 제어기술팀 / 2026-07-17 ~
//
// 사용법:
//   shfms_collector [config/devices.json]

#include "config.h"
#include "device.h"
#include "ls_xgt.h"
#include "modbus_tcp.h"
#include "net.h"
#include "tag_store.h"
#include "uploader.h"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <ctime>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace shfms {

std::unique_ptr<IDevice> make_device(const DeviceConfig& cfg) {
    if (cfg.protocol == "modbus_tcp") return std::make_unique<ModbusTcpDevice>(cfg);
    if (cfg.protocol == "ls_xgt")     return std::make_unique<LsXgtDevice>(cfg);
    return nullptr;   // mitsubishi_mc 는 3차 확산 때
}

}  // namespace shfms

namespace {

std::atomic<bool> g_running{true};

void on_signal(int) { g_running = false; }

void log(const char* level, const std::string& msg) {
    std::time_t t = std::time(nullptr);
    std::tm tmv{};
#ifdef _WIN32
    localtime_s(&tmv, &t);
#else
    localtime_r(&t, &tmv);
#endif
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &tmv);
    std::printf("[%s] %-5s %s\n", buf, level, msg.c_str());
    std::fflush(stdout);
}

// 재접속 백오프. 죽은 PLC 에 1초마다 붙으러 가면 로그만 더러워진다.
struct Backoff {
    int fails = 0;
    std::chrono::steady_clock::time_point next{};

    bool ready(std::chrono::steady_clock::time_point now) const { return now >= next; }

    void on_fail(std::chrono::steady_clock::time_point now) {
        ++fails;
        const int secs = fails < 3 ? 1 : fails < 6 ? 5 : fails < 10 ? 15 : 60;
        next = now + std::chrono::seconds(secs);
    }
    void on_ok() { fails = 0; next = {}; }
};

}  // namespace

int main(int argc, char** argv) {
    using namespace shfms;
    using clock = std::chrono::steady_clock;

    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);

    const std::string cfg_path = (argc > 1) ? argv[1] : "config/devices.json";

    AppConfig cfg;
    std::string err;
    if (!load_config(cfg_path, cfg, err)) {
        log("FATAL", "config load failed: " + err);
        return 1;
    }

    if (!net::startup()) {
        log("FATAL", "socket startup failed");
        return 1;
    }

    TagStore store;
    std::vector<std::unique_ptr<IDevice>> devices;
    std::vector<Backoff> backoff;

    for (const auto& d : cfg.devices) {
        auto dev = make_device(d);
        if (!dev) {
            log("FATAL", "unsupported protocol '" + d.protocol + "' for device " + d.id);
            net::cleanup();
            return 1;
        }
        store.register_device(d);
        devices.push_back(std::move(dev));
        backoff.emplace_back();
    }

    Uploader up(cfg.gw_host, cfg.gw_port, cfg.gw_path, cfg.api_key);

    log("INFO", "collector started - devices=" + std::to_string(devices.size()) +
                " tags=" + std::to_string(store.tag_count()) +
                " scan=" + std::to_string(cfg.scan_period_ms) + "ms");
    log("INFO", "gateway " + cfg.gw_host + ":" + std::to_string(cfg.gw_port) + cfg.gw_path);

    const auto period = std::chrono::milliseconds(cfg.scan_period_ms);
    auto next_tick = clock::now();

    std::size_t cycles = 0;
    std::size_t overruns = 0;

    while (g_running) {
        const auto t0 = clock::now();

        for (std::size_t i = 0; i < devices.size(); ++i) {
            auto& dev = devices[i];
            auto& bo = backoff[i];

            if (!dev->connected()) {
                if (!bo.ready(t0)) { store.mark_bad(dev->id()); continue; }
                if (!dev->connect()) {
                    bo.on_fail(t0);
                    store.mark_bad(dev->id());
                    if (bo.fails == 1 || bo.fails % 10 == 0) {
                        log("WARN", dev->id() + " connect failed (attempt " + std::to_string(bo.fails) + ")");
                    }
                    continue;
                }
                log("INFO", dev->id() + " connected");
                bo.on_ok();
            }

            auto res = dev->read_block();
            if (!res.ok) {
                log("WARN", dev->id() + " read failed: " + res.error);
                dev->disconnect();
                bo.on_fail(t0);
                store.mark_bad(dev->id());
                continue;
            }
            store.apply(dev->id(), res, cfg.devices[i].read_start);
        }

        auto changed = store.take_changed();
        if (!changed.empty()) {
            const std::size_t n = changed.size();
            if (!up.flush(std::move(changed))) {
                if (up.fail_total() == 1 || up.fail_total() % 20 == 0) {
                    log("WARN", "upload failed, queued=" + std::to_string(up.pending()));
                }
            } else if (++cycles % 60 == 0) {
                log("INFO", "uploaded " + std::to_string(n) + " values (total " +
                            std::to_string(up.sent_total()) + ", queued " +
                            std::to_string(up.pending()) + ")");
            }
        } else {
            ++cycles;
        }

        // 주기 고정. 밀리면 건너뛰되, 밀린 사실은 반드시 로그로 남긴다.
        next_tick += period;
        const auto now = clock::now();
        if (now > next_tick) {
            ++overruns;
            if (overruns == 1 || overruns % 50 == 0) {
                const auto late = std::chrono::duration_cast<std::chrono::milliseconds>(now - next_tick).count();
                log("WARN", "scan overrun " + std::to_string(late) + "ms (total " +
                            std::to_string(overruns) + ") - check device timeouts");
            }
            next_tick = now;
        } else {
            std::this_thread::sleep_until(next_tick);
        }
    }

    log("INFO", "shutting down - sent=" + std::to_string(up.sent_total()) +
                " queued=" + std::to_string(up.pending()) +
                " overruns=" + std::to_string(overruns));

    for (auto& d : devices) d->disconnect();
    net::cleanup();
    return 0;
}
