cmake_minimum_required(VERSION 3.20)
project(shfms_collector CXX)

# 외부 의존성 없음.
# 폐쇄망 반입 심의를 피하려고 소켓은 표준 API 로 직접 다룬다.
# (Boost.Asio / libmodbus 검토했으나 반입 승인에 2주 이상 소요 예상 — 2026-07-17 회의)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(MSVC)
  add_compile_options(/W4 /permissive- /utf-8)
else()
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

add_executable(shfms_collector
  src/main.cpp
  src/tag_store.cpp
  src/uploader.cpp
  src/modbus_tcp.cpp
  src/ls_xgt.cpp
  src/config.cpp
)

target_include_directories(shfms_collector PRIVATE include)

if(WIN32)
  target_link_libraries(shfms_collector PRIVATE ws2_32)
endif()

# 설정 파일을 빌드 출력 옆으로 복사해 둔다 (실행 시 ./config/devices.json 을 읽음)
add_custom_command(TARGET shfms_collector POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
          ${CMAKE_CURRENT_SOURCE_DIR}/config
          $<TARGET_FILE_DIR:shfms_collector>/config)
