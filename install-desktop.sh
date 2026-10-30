#!/bin/bash
# ==============================================================================
# LocalSend GUI 桌面快捷方式安装脚本
# ==============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_SCRIPT="$PROJECT_DIR/start.sh"
ICON_PATH="$PROJECT_DIR/icon.svg"

# 确保启动脚本具备执行权限
chmod +x "$START_SCRIPT"

# 确定用户桌面路径
DESKTOP_DIRS=(
  "/home/user/桌面"
  "$HOME/桌面"
  "/home/user/Desktop"
  "$HOME/Desktop"
)

CREATED_ANY=0

for DESK_DIR in "${DESKTOP_DIRS[@]}"; do
  # 如果目录存在或者路径是明确的 /home/user/桌面，则创建并安装快捷方式
  if [ -d "$DESK_DIR" ] || [ "$DESK_DIR" = "/home/user/桌面" ]; then
    mkdir -p "$DESK_DIR" 2>/dev/null || true
    TARGET_FILE="$DESK_DIR/LocalSend-GUI.desktop"

    cat > "$TARGET_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=LocalSend GUI
Comment=局域网高速安全文件传输工具
Exec=$START_SCRIPT
Icon=$ICON_PATH
Terminal=false
Categories=Network;FileTransfer;Utility;
StartupNotify=true
EOF

    # 赋予执行权限
    chmod +x "$TARGET_FILE" 2>/dev/null || true

    # 针对 GNOME / Deepin 等现代 Linux 桌面标记信任（避免“未信任的启动器”提示）
    if command -v gio >/dev/null 2>&1; then
      gio set "$TARGET_FILE" metadata::trusted true 2>/dev/null || true
    fi

    echo "✅ 已成功在【$DESK_DIR】创建桌面快捷方式：$TARGET_FILE"
    CREATED_ANY=1
  fi
done

# 同时安装到系统的应用程序菜单中（便于从启动器/应用列表搜索启动）
APP_MENU_DIR="$HOME/.local/share/applications"
if [ -d "$APP_MENU_DIR" ] || mkdir -p "$APP_MENU_DIR" 2>/dev/null; then
  MENU_FILE="$APP_MENU_DIR/localsend-gui.desktop"
  cat > "$MENU_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=LocalSend GUI
Comment=局域网高速安全文件传输工具
Exec=$START_SCRIPT
Icon=$ICON_PATH
Terminal=false
Categories=Network;FileTransfer;Utility;
StartupNotify=true
EOF
  chmod +x "$MENU_FILE" 2>/dev/null || true
  echo "✅ 已成功添加到系统应用程序菜单：$MENU_FILE"
fi

if [ $CREATED_ANY -eq 0 ]; then
  # 降级备用：在当前目录生成
  FALLBACK="/home/user/桌面/LocalSend-GUI.desktop"
  mkdir -p "/home/user/桌面" 2>/dev/null || true
  cp -f "$MENU_FILE" "$FALLBACK" 2>/dev/null || true
  chmod +x "$FALLBACK" 2>/dev/null || true
  echo "✅ 已生成桌面启动图标至：$FALLBACK"
fi

echo ""
echo "🎉 安装完成！您现在可以直接在桌面双击【LocalSend GUI】图标启动运行！"
