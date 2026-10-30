#!/bin/bash
# ==============================================================================
# LocalSend GUI 一键启动脚本
# ==============================================================================

# 定位当前脚本所在目录（即项目根目录）
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# 自动补充 Linux 下各种常见 Node/NVM 环境路径
export PATH="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -n 1)/bin:$HOME/.local/bin:$HOME/.fnm/current/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi
if [ -f "$HOME/.bashrc" ]; then
  # shellcheck source=/dev/null
  source "$HOME/.bashrc" 2>/dev/null || true
fi

PORT=3000
URL="http://localhost:$PORT"

# 检查服务是否已就绪
check_service() {
  if command -v curl >/dev/null 2>&1; then
    curl -s --max-time 1 "http://127.0.0.1:$PORT/api/system/status" >/dev/null 2>&1
    return $?
  fi
  # Fallback: 使用 /dev/tcp 或 netstat/ss
  (echo > /dev/tcp/127.0.0.1/$PORT) >/dev/null 2>&1
  return $?
}

# 打开独立应用窗口或默认浏览器的辅助函数
launch_app_window() {
  # 优先检测是否有 Chrome / Chromium，使用 --app 模式启动可获得原生独立桌面程序窗口体验
  if command -v google-chrome >/dev/null 2>&1; then
    google-chrome --app="$URL" >/dev/null 2>&1 &
  elif command -v google-chrome-stable >/dev/null 2>&1; then
    google-chrome-stable --app="$URL" >/dev/null 2>&1 &
  elif command -v chromium-browser >/dev/null 2>&1; then
    chromium-browser --app="$URL" >/dev/null 2>&1 &
  elif command -v chromium >/dev/null 2>&1; then
    chromium --app="$URL" >/dev/null 2>&1 &
  elif command -v microsoft-edge >/dev/null 2>&1; then
    microsoft-edge --app="$URL" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v firefox >/dev/null 2>&1; then
    firefox "$URL" >/dev/null 2>&1 &
  else
    echo "提示：请在浏览器中打开 $URL"
  fi
}

# 1. 如果已经在运行，直接打开窗口即可，避免重复启动冲突
if check_service; then
  echo "LocalSend GUI 服务已在运行中，正在唤起界面窗口..."
  launch_app_window
  exit 0
fi

# 2. 后台启动服务
echo "正在启动 LocalSend GUI 全栈服务..."

# 创建日志目录
mkdir -p "$HOME/.config/localsend-gui" 2>/dev/null || true
LOG_FILE="$PROJECT_DIR/app.log"

if command -v npm >/dev/null 2>&1; then
  nohup npm run dev > "$LOG_FILE" 2>&1 &
elif command -v bun >/dev/null 2>&1; then
  nohup bun run dev > "$LOG_FILE" 2>&1 &
elif command -v node >/dev/null 2>&1; then
  nohup npx tsx server.ts > "$LOG_FILE" 2>&1 &
else
  echo "错误：未找到 Node.js 或 npm 环境，请先安装 Node.js" >&2
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --text="未检测到 Node.js 环境，请先安装 Node.js 后再运行！" 2>/dev/null || true
  fi
  exit 1
fi

# 3. 等待服务就绪（最多等待 15 秒）
MAX_WAIT=15
COUNTER=0
while [ $COUNTER -lt $MAX_WAIT ]; do
  if check_service; then
    break
  fi
  sleep 0.5
  COUNTER=$((COUNTER + 1))
done

# 4. 唤起独立窗口
launch_app_window
echo "LocalSend GUI 已成功启动！"
