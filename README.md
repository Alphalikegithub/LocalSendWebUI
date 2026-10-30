# LocalSend GUI - 局域网文件传输

An open-source desktop and web interface for [LocalSend](https://github.com/localsend/localsend) cross-platform local network file sharing.

Originally built in C++ with Qt, migrated to a modern high-performance React + TypeScript + Vite web app for AI Studio.

## Features

- **目标设备发现 (Target Device Discovery)**:
  - UDP Multicast listener on `224.0.0.167:53317`
  - Subnet IP probing (`/api/localsend/v2/info`)
  - Real-time device list with device type (mobile, desktop, server), IP, alias, and TLS fingerprint
  - Direct IP / custom manual host entry
  - Quick-select target to send files to

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
