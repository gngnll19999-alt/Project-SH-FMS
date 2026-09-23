#include "config.h"

#include <cctype>
#include <cstdlib>
#include <fstream>
#include <sstream>

namespace shfms {
namespace {

// ---- 최소 JSON 파서 ----
// 객체 / 배열 / 문자열 / 숫자 / true·false 만 지원한다. 주석, 유니코드 이스케이프 미지원.
// devices.json 하나만 읽으면 되므로 이 정도로 충분하다.

struct Parser {
    const std::string& s;
    std::size_t i = 0;
    std::string err;

    explicit Parser(const std::string& src) : s(src) {}

    void ws() { while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i; }
    bool eat(char c) { ws(); if (i < s.size() && s[i] == c) { ++i; return true; } return false; }
    bool peek(char c) { ws(); return i < s.size() && s[i] == c; }

    bool str(std::string& out) {
        ws();
        if (i >= s.size() || s[i] != '"') { err = "expected string at " + std::to_string(i); return false; }
        ++i;
        out.clear();
        while (i < s.size() && s[i] != '"') {
            if (s[i] == '\\' && i + 1 < s.size()) {
                ++i;
                char c = s[i];
                out += (c == 'n') ? '\n' : (c == 't') ? '\t' : c;
            } else {
                out += s[i];
            }
            ++i;
        }
        if (i >= s.size()) { err = "unterminated string"; return false; }
        ++i;
        return true;
    }

    bool num(double& out) {
        ws();
        char* end = nullptr;
        out = std::strtod(s.c_str() + i, &end);
        if (end == s.c_str() + i) { err = "expected number at " + std::to_string(i); return false; }
        i = static_cast<std::size_t>(end - s.c_str());
        return true;
    }

    bool boolean(bool& out) {
        ws();
        if (s.compare(i, 4, "true") == 0)  { i += 4; out = true;  return true; }
        if (s.compare(i, 5, "false") == 0) { i += 5; out = false; return true; }
        err = "expected boolean at " + std::to_string(i);
        return false;
    }

    // 관심 없는 값을 통째로 건너뛴다 (설정에 주석용 필드를 넣어 두는 경우가 있다)
    bool skip_value() {
        ws();
        if (i >= s.size()) return false;
        char c = s[i];
        if (c == '"') { std::string d; return str(d); }
        if (c == '{' || c == '[') {
            char open = c, close = (c == '{') ? '}' : ']';
            int depth = 0;
            bool in_str = false;
            for (; i < s.size(); ++i) {
                if (in_str) {
                    if (s[i] == '\\') ++i;
                    else if (s[i] == '"') in_str = false;
                } else if (s[i] == '"') in_str = true;
                else if (s[i] == open) ++depth;
                else if (s[i] == close) { if (--depth == 0) { ++i; return true; } }
            }
            err = "unbalanced brackets";
            return false;
        }
        if (c == 't' || c == 'f') { bool b; return boolean(b); }
        double d; return num(d);
    }
};

bool parse_tag(Parser& p, TagDef& t) {
    if (!p.eat('{')) { p.err = "tag: expected {"; return false; }
    do {
        std::string k;
        if (!p.str(k)) return false;
        if (!p.eat(':')) { p.err = "tag: expected :"; return false; }

        if      (k == "name")     { if (!p.str(t.name)) return false; }
        else if (k == "unit")     { if (!p.str(t.unit)) return false; }
        else if (k == "desc")     { if (!p.str(t.desc)) return false; }
        else if (k == "address")  { double d; if (!p.num(d)) return false; t.address = static_cast<int>(d); }
        else if (k == "words")    { double d; if (!p.num(d)) return false; t.words = static_cast<int>(d); }
        else if (k == "scale")    { if (!p.num(t.scale)) return false; }
        else if (k == "offset")   { if (!p.num(t.offset)) return false; }
        else if (k == "deadband") { if (!p.num(t.deadband)) return false; }
        else if (k == "float")    { if (!p.boolean(t.is_float)) return false; }
        else                      { if (!p.skip_value()) return false; }
    } while (p.eat(','));

    if (!p.eat('}')) { p.err = "tag: expected }"; return false; }
    if (t.name.empty()) { p.err = "tag: name is required"; return false; }
    return true;
}

bool parse_device(Parser& p, DeviceConfig& d) {
    if (!p.eat('{')) { p.err = "device: expected {"; return false; }
    do {
        std::string k;
        if (!p.str(k)) return false;
        if (!p.eat(':')) { p.err = "device: expected :"; return false; }

        if      (k == "id")         { if (!p.str(d.id)) return false; }
        else if (k == "protocol")   { if (!p.str(d.protocol)) return false; }
        else if (k == "host")       { if (!p.str(d.host)) return false; }
        else if (k == "port")       { double v; if (!p.num(v)) return false; d.port = static_cast<int>(v); }
        else if (k == "unit_id")    { double v; if (!p.num(v)) return false; d.unit_id = static_cast<int>(v); }
        else if (k == "timeout_ms") { double v; if (!p.num(v)) return false; d.timeout_ms = static_cast<int>(v); }
        else if (k == "read_start") { double v; if (!p.num(v)) return false; d.read_start = static_cast<int>(v); }
        else if (k == "read_count") { double v; if (!p.num(v)) return false; d.read_count = static_cast<int>(v); }
        else if (k == "tags") {
            if (!p.eat('[')) { p.err = "device: tags expected ["; return false; }
            if (!p.peek(']')) {
                do {
                    TagDef t;
                    if (!parse_tag(p, t)) return false;
                    t.device = d.id;
                    d.tags.push_back(t);
                } while (p.eat(','));
            }
            if (!p.eat(']')) { p.err = "device: tags expected ]"; return false; }
        }
        else { if (!p.skip_value()) return false; }
    } while (p.eat(','));

    if (!p.eat('}')) { p.err = "device: expected }"; return false; }

    if (d.id.empty())       { p.err = "device: id is required"; return false; }
    if (d.protocol.empty()) { p.err = "device " + d.id + ": protocol is required"; return false; }
    if (d.host.empty())     { p.err = "device " + d.id + ": host is required"; return false; }

    // tags 는 device.id 가 먼저 읽혔다는 보장이 없으니 여기서 한 번 더 채운다
    for (auto& t : d.tags) t.device = d.id;
    return true;
}

}  // namespace

bool load_config(const std::string& path, AppConfig& out, std::string& error) {
    std::ifstream f(path);
    if (!f) { error = "cannot open " + path; return false; }

    std::stringstream ss;
    ss << f.rdbuf();
    const std::string src = ss.str();

    Parser p(src);
    if (!p.eat('{')) { error = "root: expected {"; return false; }

    do {
        std::string k;
        if (!p.str(k)) { error = p.err; return false; }
        if (!p.eat(':')) { error = "root: expected :"; return false; }

        if (k == "scan_period_ms") { double v; if (!p.num(v)) { error = p.err; return false; } out.scan_period_ms = static_cast<int>(v); }
        else if (k == "gateway") {
            if (!p.eat('{')) { error = "gateway: expected {"; return false; }
            do {
                std::string gk;
                if (!p.str(gk)) { error = p.err; return false; }
                if (!p.eat(':')) { error = "gateway: expected :"; return false; }
                if      (gk == "host")    { if (!p.str(out.gw_host)) { error = p.err; return false; } }
                else if (gk == "path")    { if (!p.str(out.gw_path)) { error = p.err; return false; } }
                else if (gk == "api_key") { if (!p.str(out.api_key)) { error = p.err; return false; } }
                else if (gk == "port")    { double v; if (!p.num(v)) { error = p.err; return false; } out.gw_port = static_cast<int>(v); }
                else                      { if (!p.skip_value()) { error = p.err; return false; } }
            } while (p.eat(','));
            if (!p.eat('}')) { error = "gateway: expected }"; return false; }
        }
        else if (k == "devices") {
            if (!p.eat('[')) { error = "devices: expected ["; return false; }
            if (!p.peek(']')) {
                do {
                    DeviceConfig d;
                    if (!parse_device(p, d)) { error = p.err; return false; }
                    out.devices.push_back(std::move(d));
                } while (p.eat(','));
            }
            if (!p.eat(']')) { error = "devices: expected ]"; return false; }
        }
        else { if (!p.skip_value()) { error = p.err; return false; } }
    } while (p.eat(','));

    if (!p.eat('}')) { error = "root: expected }"; return false; }
    if (out.devices.empty()) { error = "no devices configured"; return false; }
    if (out.scan_period_ms < 100) { error = "scan_period_ms too small (min 100)"; return false; }

    return true;
}

}  // namespace shfms
