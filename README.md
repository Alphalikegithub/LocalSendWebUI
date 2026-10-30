# LocalSend GUI - 局域网文件传输

An open-source desktop and web interface for [LocalSend](https://github.com/localsend/localsend) cross-platform local network file sharing.

Originally built in C++ with Qt, migrated to a modern high-performance React + TypeScript + Vite web app for AI Studio.

## Features & Real Local Execution

应用已升级为 **Full-Stack Node.js (Express + Vite)** 真实本地执行架构，不再是前端纯模拟：

- **真实的底层 CLI 调用 (Real localsend-cli execution)**:
  - 自动寻找本地已安装或编译的 `localsend-cli`（包括 `/data/QtProjects/localsend/target/debug/localsend-cli`、`~/.local/bin/localsend-cli` 等）。
  - 支持通过环境变量 `LOCALSEND_CLI` 或在“设置”中手动配置 CLI 绝对路径。
  - 发送时直接调用 `localsend-cli send --to <target> <files>`，通过实时流将 CLI 标准输出、ETA 进度以及终端状态实时回传前端。
  - 点击“接收”可直接调起本机终端（xterm / gnome-terminal / mate-terminal 等）或后台启动 `localsend-cli`。

- **真实的 TLS 身份与证书指纹 (Real TLS Identity & Fingerprint)**:
  - 自动读取 `~/.config/localsend-cli/identity.pem`，使用 Node.js Crypto 解析 X.509 证书并提取 SHA-256 唯一指纹。

- **真实的网络设备探测 (Real Multicast & Subnet Probing)**:
  - 通过 Node.js `dgram` 原生绑定端口 `53317`，加入组播组 `224.0.0.167` 监听局域网 LocalSend 广播。
  - 自动读取网卡 IPv4 网段（如 `192.168.118.0/24`），并发探测该网段内 253 个局域网地址的 `/api/localsend/v2/info`。
  - 局域网设备（如“富有的椰子 (192.168.118.115)”）一旦在线立即显示并可直接点击发送。

- **待发送文件与目录管理 (Pending Files & Directory Management)**:
  - Drag-and-drop file and folder dropping
  - Batch file selection, directory upload, and quick text/note transmission
  - Live summary calculation: File count, directory count, and total byte size formatting

- **传输控制与实时进度 (Transfer Controls & Real-Time Progress)**:
  - Full progress tracking: percentage, transmitted / total size, transfer speed (MB/s), and ETA countdown
  - Send cancellation support
  - Realistic chunked transmission pipeline

- **接收模式 (Receive Mode)**:
  - Server listener on port 53317
  - Local direct connection QR/pairing info
  - Incoming transfer confirmation dialog (Accept / Decline)
  - Simulated incoming transfer triggers for testing

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

