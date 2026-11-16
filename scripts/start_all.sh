#!/usr/bin/env bash
# 兼容旧入口：等价于 scripts/kb.sh start [组件]
# 完整能力（stop / restart / status / logs）见 scripts/kb.sh
exec bash "$(cd "$(dirname "$0")" && pwd)/kb.sh" start "${1:-all}"
