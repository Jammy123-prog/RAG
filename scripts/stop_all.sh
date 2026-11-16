#!/usr/bin/env bash
# 兼容入口：等价于 scripts/kb.sh stop [组件]
exec bash "$(cd "$(dirname "$0")" && pwd)/kb.sh" stop "${1:-all}"
