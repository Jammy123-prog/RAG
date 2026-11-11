#!/bin/bash
# 本机（无 docker 环境）启动/停止 Neo4j —— 由官方 neo4j:5.26-community 镜像 rootfs 解压部署
# 用法: scripts/neo4j-local.sh start|stop|status
export JAVA_HOME=/home/zpmc/neo4j-image/rootfs/opt/java/openjdk
export NEO4J_HOME=/home/zpmc/neo4j-image/rootfs/var/lib/neo4j
NEO4J="$NEO4J_HOME/bin/neo4j"
case "${1:-start}" in
  start)  "$NEO4J" start ;;
  stop)   "$NEO4J" stop ;;
  status) "$NEO4J" status ;;
  *) echo "用法: $0 start|stop|status" ;;
esac
