#!/usr/bin/env bash
# 命令行兜底上传（不走浏览器文件选择框）
# 用法: bash scripts/upload.sh <文件路径> [public|private] [folder_id]
#   例: bash scripts/upload.sh ~/Downloads/会议纪要.doc
set -euo pipefail

API=${API:-http://localhost:8010}
PY=${PY:-/home/zpmc/miniconda3/envs/RAG/bin/python}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

FILE=${1:-}
SCOPE=${2:-public}
FOLDER=${3:-}

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "用法: bash scripts/upload.sh <文件路径> [public|private] [folder_id]" >&2
  exit 1
fi

TOKEN=$(cd "$ROOT" && "$PY" -c "
import sys
sys.path.insert(0, 'backend')
from app import auth, store
u = next((x for x in store.list_users() if x['role'] == 'admin'), None)
if not u:
    raise SystemExit('库里没有 admin 用户')
print(auth.make_token(u['id']))
")

echo "上传: $FILE  →  $API （scope=$SCOPE）"
curl -s -X POST "$API/api/documents/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "files=@$FILE" \
  -F "scope=$SCOPE" \
  -F "folder_id=$FOLDER"
echo
