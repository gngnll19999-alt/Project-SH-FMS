// 최소 TCP 클라이언트.
// Windows(Winsock2) / POSIX 양쪽에서 돌아야 해서 얇게 감쌌다.
// 라이브러리를 하나 더 반입하느니 이 정도는 직접 쓰는 게 빠르다.
#pragma once

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#ifdef _WIN32
  #ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
  #endif
  // windows.h 가 min/max 를 매크로로 잡아서 std::min 이 깨진다. 반드시 먼저 꺼야 한다.
  #ifndef NOMINMAX
    #define NOMINMAX
  #endif
  #include <winsock2.h>
  #include <ws2tcpip.h>
  using socket_t = SOCKET;
  using socklen_t = int;
  #define SHFMS_INVALID_SOCK INVALID_SOCKET
  #define SHFMS_CLOSE(s) ::closesocket(s)
#else
  #include <arpa/inet.h>
  #include <netinet/in.h>
  #include <netinet/tcp.h>
  #include <sys/socket.h>
  #include <fcntl.h>
  #include <cerrno>
  #include <unistd.h>
  using socket_t = int;
  #define SHFMS_INVALID_SOCK (-1)
  #define SHFMS_CLOSE(s) ::close(s)
#endif

namespace shfms { namespace net {

inline bool startup() {
#ifdef _WIN32
    WSADATA wsa;
    return WSAStartup(MAKEWORD(2, 2), &wsa) == 0;
#else
    return true;
#endif
}

inline void cleanup() {
#ifdef _WIN32
    WSACleanup();
#endif
}

class TcpClient {
public:
    ~TcpClient() { close(); }

    // 논블로킹 connect + select.
    //
    // 처음에 블로킹 connect 로 짰다가 현장 시험에서 물렸다. PLC 한 대가 꺼져 있으면
    // OS 기본 연결 타임아웃(윈도우 기준 20초 안팎)까지 이 호출이 안 돌아오고,
    // 폴링 루프가 단일 스레드라 나머지 7대 스캔이 통째로 멈춘다.
    // timeout_ms 를 연결 단계에도 실제로 먹이려면 논블로킹으로 붙는 수밖에 없다.
    bool connect(const std::string& host, int port, int timeout_ms) {
        close();
        sock_ = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (sock_ == SHFMS_INVALID_SOCK) return false;

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(static_cast<std::uint16_t>(port));
        if (::inet_pton(AF_INET, host.c_str(), &addr.sin_addr) != 1) { close(); return false; }

        set_blocking(false);
        const int rc = ::connect(sock_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));

        if (rc != 0 && !in_progress()) { close(); return false; }

        if (rc != 0) {
            fd_set wr, ex;
            FD_ZERO(&wr); FD_SET(sock_, &wr);
            FD_ZERO(&ex); FD_SET(sock_, &ex);

            timeval tv{};
            tv.tv_sec = timeout_ms / 1000;
            tv.tv_usec = (timeout_ms % 1000) * 1000;

            const int sel = ::select(static_cast<int>(sock_) + 1, nullptr, &wr, &ex, &tv);
            if (sel <= 0 || FD_ISSET(sock_, &ex)) { close(); return false; }

            // select 가 깨어났다고 연결이 된 건 아니다. SO_ERROR 를 봐야 한다.
            int soerr = 0;
            socklen_t len = sizeof(soerr);
            if (::getsockopt(sock_, SOL_SOCKET, SO_ERROR,
                             reinterpret_cast<char*>(&soerr), &len) != 0 || soerr != 0) {
                close();
                return false;
            }
        }

        set_blocking(true);
        set_timeout(timeout_ms);

        // PLC 폴링은 짧은 요청/응답의 반복이라 Nagle 을 꺼야 지연이 안 쌓인다.
        int one = 1;
        ::setsockopt(sock_, IPPROTO_TCP, TCP_NODELAY,
                     reinterpret_cast<const char*>(&one), sizeof(one));
        return true;
    }

    void close() {
        if (sock_ != SHFMS_INVALID_SOCK) { SHFMS_CLOSE(sock_); sock_ = SHFMS_INVALID_SOCK; }
    }

    bool valid() const { return sock_ != SHFMS_INVALID_SOCK; }

    bool send_all(const std::uint8_t* buf, std::size_t len) {
        std::size_t sent = 0;
        while (sent < len) {
            int n = ::send(sock_, reinterpret_cast<const char*>(buf + sent),
                           static_cast<int>(len - sent), 0);
            if (n <= 0) return false;
            sent += static_cast<std::size_t>(n);
        }
        return true;
    }

    // 정확히 len 바이트를 채울 때까지 읽는다. 타임아웃이면 false.
    bool recv_exact(std::uint8_t* buf, std::size_t len) {
        std::size_t got = 0;
        while (got < len) {
            int n = ::recv(sock_, reinterpret_cast<char*>(buf + got),
                           static_cast<int>(len - got), 0);
            if (n <= 0) return false;
            got += static_cast<std::size_t>(n);
        }
        return true;
    }

private:
    void set_blocking(bool on) {
#ifdef _WIN32
        u_long mode = on ? 0 : 1;
        ::ioctlsocket(sock_, FIONBIO, &mode);
#else
        int flags = ::fcntl(sock_, F_GETFL, 0);
        if (flags < 0) return;
        ::fcntl(sock_, F_SETFL, on ? (flags & ~O_NONBLOCK) : (flags | O_NONBLOCK));
#endif
    }

    static bool in_progress() {
#ifdef _WIN32
        return WSAGetLastError() == WSAEWOULDBLOCK;
#else
        return errno == EINPROGRESS;
#endif
    }

    void set_timeout(int ms) {
#ifdef _WIN32
        DWORD tv = static_cast<DWORD>(ms);
        ::setsockopt(sock_, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&tv), sizeof(tv));
        ::setsockopt(sock_, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&tv), sizeof(tv));
#else
        timeval tv{};
        tv.tv_sec = ms / 1000;
        tv.tv_usec = (ms % 1000) * 1000;
        ::setsockopt(sock_, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
        ::setsockopt(sock_, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
#endif
    }

    socket_t sock_ = SHFMS_INVALID_SOCK;
};

}}  // namespace shfms::net
