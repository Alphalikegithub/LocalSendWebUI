# LocalSend GUI - 局域网文件传输

An open-source desktop and web interface for [LocalSend](https://github.com/localsend/localsend) cross-platform local network file sharing.

Originally built in C++ with Qt, migrated to a modern high-performance React + TypeScript + Vite web app for AI Studio.

## Features & Real Local Execution

应用已升级为 **Full-Stack Node.js (Express + Vite)** 真实本地执行架构，不再是前端纯模拟：

- **真实的无缝后台接收 (Seamless Background Receive, No Terminal Needed)**:
  - 后台静默启动 `localsend-cli` 并接管标准输入输出，**完全无需弹出外部系统终端，也无需在终端中敲键盘输入 Y/N 确认**。
  - 默认开启**自动接受传输 (Auto-Accept)**，或在 Web 界面中直接弹出友好的接收确认弹窗，一键点击“接受 (Y)”或“拒绝 (N)”。
  - 接收文件统一自动保存至标准的系统下载目录：`~/Downloads/LocalSend`（支持一键点击“在文件夹中打开”调用系统文件管理器，或直接在网页中下载）。

- **极速局域网设备探测 (Rapid Multicast & Subnet Probing)**:
  - 双重广播握手：向 `224.0.0.167:53317` 发送组播握手包，局域网活动设备毫秒级自报家门。
  - 80 线程高并发扫描与已发现设备优先缓存：探测超时优化至 500ms，全网段扫描从 15 秒缩减至 1~2 秒。
  - 携带 `identity.pem` 的 mTLS 客户端双向认证，严格符合 LocalSend v2 安全协议。

- **待发送文件与目录管理 (Pending Files & Directory Management)**:
  - Drag-and-drop file and folder dropping
  - Batch file selection, directory upload, and quick text/note transmission
  - Live summary calculation: File count, directory count, and total byte size formatting

- **传输控制与实时进度 (Transfer Controls & Real-Time Progress)**:
  - Full progress tracking: percentage, transmitted / total size, transfer speed (MB/s), and ETA countdown
  - Send cancellation support
  - 智能 IP 校验与修正（防止误输入多余网段）

- **日志控制台 (Terminal Logs)**:
  - Timestamped real-time log stream mirroring Qt `QPlainTextEdit`
  - Auto-scroll toggle, copy to clipboard, and clear logs

- **传输历史与配置 (History & Settings)**:
  - Inspection and download of sent and received files
  - Device alias, port, TLS SHA-256 fingerprint, and CLI path configuration

---

## 本地部署与启动步骤 (Local Deployment & Getting Started)

### 1. 环境准备
确保您的机器已安装 Node.js 环境：
- **Node.js**: 建议 `v18.0.0` 或更高版本（推荐 `v20` 或 `v22`）
- **npm**: 随 Node.js 一起提供

检查版本：
```bash
node -v
npm -v
```

### 2. 安装依赖
在项目根目录下打开终端，执行以下命令安装依赖：
```bash
npm install
```

### 3. 本地启动开发服务器
运行以下命令启动本地开发环境：
```bash
npm run dev
```
启动成功后，终端将输出访问链接：
```
  VITE v6.x.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: http://<局域网IP>:3000/
```
在浏览器中打开 `http://localhost:3000` 即可开始使用。同一局域网内的其它设备也可通过 `http://<局域网IP>:3000` 访问。

### 4. 生产环境构建与部署
若要构建生产版本并部署到自己的服务器（Nginx / Caddy / 静态托管）：

#### (1) 打包构建
```bash
npm run build
```
构建生成的文件位于 `dist/` 目录下。

#### (2) 本地预览构建产物
```bash
npm run preview
```

#### (3) Nginx 配置示例 (可选)
```nginx
server {
    listen 80;
    server_name your-domain-or-ip;

    location / {
        root /path/to/localsend-gui/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

#### (4) 使用 Docker 运行 (可选)
```bash
# 构建镜像
docker build -t localsend-gui .

# 运行容器
docker run -d -p 3000:80 --name localsend-gui localsend-gui
```

