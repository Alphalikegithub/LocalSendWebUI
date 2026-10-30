#include "mainwindow.h"
#include "ui_mainwindow.h"

#include <QAbstractSocket>
#include <QCloseEvent>
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QDirIterator>
#include <QDragEnterEvent>
#include <QDropEvent>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFontDatabase>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QMimeData>
#include <QNetworkAccessManager>
#include <QNetworkAddressEntry>
#include <QNetworkInterface>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPlainTextEdit>
#include <QProgressBar>
#include <QPushButton>
#include <QRegularExpression>
#include <QSettings>
#include <QSet>
#include <QSplitter>
#include <QSslCertificate>
#include <QSslConfiguration>
#include <QSslError>
#include <QSslKey>
#include <QSslSocket>
#include <QStandardPaths>
#include <QStatusBar>
#include <QThread>
#include <QTime>
#include <QTimer>
#include <QUdpSocket>
#include <QUuid>
#include <QUrl>
#include <QVBoxLayout>
#include <QWidget>

namespace {

const char *const kMulticastGroup = "224.0.0.167";
const quint16 kDefaultPort = 53317;
const int kMaxConcurrentProbes = 64;
const int kProbeTimeoutMs = 800;
const int kDiscoveryWindowMs = 6000;
const char *const kSettingsOrg = "LocalSendGUI";
const char *const kSettingsApp = "LocalSendGUI";
const char *const kFingerprintKey = "identity/fingerprint";
const char *const kLastTargetKey = "ui/lastTarget";
const char *const kCliPathKey = "cli/path";

QString shellQuote(const QString &value)
{
    QString escaped = value;
    escaped.replace(QLatin1Char('\''), QLatin1String("'\\''"));
    return QLatin1Char('\'') + escaped + QLatin1Char('\'');
}

qint64 sizeToBytes(const QString &value, const QString &unit)
{
    double factor = 1.0;
    if (unit.compare(QStringLiteral("KB"), Qt::CaseInsensitive) == 0) {
        factor = 1024.0;
    } else if (unit.compare(QStringLiteral("MB"), Qt::CaseInsensitive) == 0) {
        factor = 1024.0 * 1024.0;
    } else if (unit.compare(QStringLiteral("GB"), Qt::CaseInsensitive) == 0) {
        factor = 1024.0 * 1024.0 * 1024.0;
    } else if (unit.compare(QStringLiteral("TB"), Qt::CaseInsensitive) == 0) {
        factor = 1024.0 * 1024.0 * 1024.0 * 1024.0;
    }
    return static_cast<qint64>(value.toDouble() * factor);
}

bool isLocalAddress(const QString &ip)
{
    const QHostAddress address(ip);
    if (address.isNull()) {
        return false;
    }
    const QList<QNetworkInterface> interfaces = QNetworkInterface::allInterfaces();
    for (const QNetworkInterface &interface : interfaces) {
        const QList<QNetworkAddressEntry> entries = interface.addressEntries();
        for (const QNetworkAddressEntry &entry : entries) {
            if (entry.ip() == address) {
                return true;
            }
        }
    }
    return false;
}

} // namespace

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::MainWindow)
    , m_targetEdit(nullptr)
    , m_deviceList(nullptr)
    , m_deviceStatusLabel(nullptr)
    , m_refreshButton(nullptr)
    , m_fileList(nullptr)
    , m_summaryLabel(nullptr)
    , m_logView(nullptr)
    , m_progressBar(nullptr)
    , m_sendButton(nullptr)
    , m_receiveButton(nullptr)
    , m_cancelButton(nullptr)
    , m_sendProcess(nullptr)
    , m_discoverySocket(nullptr)
    , m_network(nullptr)
    , m_activeProbes(0)
    , m_probeIdentityLoaded(false)
    , m_probeIdentityWarningLogged(false)
    , m_pendingProbes(0)
    , m_discoveryGeneration(0)
    , m_discoveryRunning(false)
    , m_cancelRequested(false)
{
    ui->setupUi(this);
    buildUi();
    loadSettings();

    QSettings settings(QString::fromLatin1(kSettingsOrg), QString::fromLatin1(kSettingsApp));
    m_fingerprint = settings.value(QString::fromLatin1(kFingerprintKey)).toString();
    if (m_fingerprint.isEmpty()) {
        m_fingerprint = QUuid::createUuid().toString();
        m_fingerprint.remove(QLatin1Char('{')).remove(QLatin1Char('}'));
        settings.setValue(QString::fromLatin1(kFingerprintKey), m_fingerprint);
    }

    m_sendProcess = new QProcess(this);
    m_sendProcess->setProcessChannelMode(QProcess::MergedChannels);
    connect(m_sendProcess, &QProcess::readyReadStandardOutput,
            this, &MainWindow::onSendReadyRead);
    connect(m_sendProcess, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
            this, &MainWindow::onSendFinished);
    connect(m_sendProcess, &QProcess::errorOccurred,
            this, &MainWindow::onSendError);

    m_discoverySocket = new QUdpSocket(this);
    connect(m_discoverySocket, &QUdpSocket::readyRead,
            this, &MainWindow::onDiscoveryReadyRead);

    m_network = new QNetworkAccessManager(this);

    setAcceptDrops(true);

    m_cliPath = resolveCliPath();
    appendLog(tr("LocalSend GUI 已启动。"));
    if (m_cliPath.isEmpty()) {
        appendLog(tr("警告：未找到 localsend-cli。发送或接收时会提示选择可执行文件，"
                     "也可以通过环境变量 LOCALSEND_CLI 指定。"));
    } else {
        appendLog(tr("使用 CLI：%1").arg(m_cliPath));
    }

    if (!QSslSocket::supportsSsl()) {
        appendLog(tr("警告：当前 Qt 没有加载 OpenSSL，HTTPS 设备扫描将不可用；"
                     "仍可手动输入对方 IP 后发送。"));
    } else {
        loadProbeIdentity();
    }

    QTimer::singleShot(400, this, &MainWindow::refreshDevices);
}

MainWindow::~MainWindow()
{
    if (m_sendProcess && m_sendProcess->state() != QProcess::NotRunning) {
        m_sendProcess->kill();
        m_sendProcess->waitForFinished(1000);
    }
    stopDiscovery();
    delete ui;
}

void MainWindow::buildUi()
{
    setWindowTitle(tr("LocalSend GUI - 局域网文件传输"));
    resize(1000, 720);

    QWidget *central = new QWidget(this);
    QVBoxLayout *rootLayout = new QVBoxLayout(central);
    rootLayout->setContentsMargins(10, 10, 10, 10);
    rootLayout->setSpacing(8);

    QSplitter *topSplitter = new QSplitter(Qt::Horizontal, central);

    QGroupBox *deviceGroup = new QGroupBox(tr("目标设备"), topSplitter);
    QVBoxLayout *deviceLayout = new QVBoxLayout(deviceGroup);
    m_deviceList = new QListWidget(deviceGroup);
    m_deviceList->setSelectionMode(QAbstractItemView::SingleSelection);
    m_deviceList->setAlternatingRowColors(true);
    m_deviceList->setToolTip(tr("点击设备会把它的 IP 填入“发送到”输入框。"));
    deviceLayout->addWidget(m_deviceList, 1);

    QHBoxLayout *targetLayout = new QHBoxLayout;
    QLabel *targetLabel = new QLabel(tr("发送到："), deviceGroup);
    m_targetEdit = new QLineEdit(deviceGroup);
    m_targetEdit->setPlaceholderText(tr("设备名或 IP 地址"));
    m_targetEdit->setClearButtonEnabled(true);
    targetLayout->addWidget(targetLabel);
    targetLayout->addWidget(m_targetEdit, 1);
    deviceLayout->addLayout(targetLayout);

    QHBoxLayout *discoveryLayout = new QHBoxLayout;
    m_refreshButton = new QPushButton(tr("刷新设备"), deviceGroup);
    m_deviceStatusLabel = new QLabel(tr("尚未扫描"), deviceGroup);
    m_deviceStatusLabel->setWordWrap(true);
    discoveryLayout->addWidget(m_refreshButton);
    discoveryLayout->addWidget(m_deviceStatusLabel, 1);
    deviceLayout->addLayout(discoveryLayout);

    QLabel *deviceHint = new QLabel(
        tr("提示：也可以直接输入对方设备的 IP。接收模式可设置下载目录保存。"),
        deviceGroup);
    deviceHint->setWordWrap(true);
    deviceLayout->addWidget(deviceHint);

    QGroupBox *fileGroup = new QGroupBox(tr("待发送的文件 / 目录"), topSplitter);
    QVBoxLayout *fileLayout = new QVBoxLayout(fileGroup);
    m_fileList = new QListWidget(fileGroup);
    m_fileList->setSelectionMode(QAbstractItemView::ExtendedSelection);
    m_fileList->setAlternatingRowColors(true);
    m_fileList->setToolTip(tr("支持把文件或目录直接拖进窗口。"));
    fileLayout->addWidget(m_fileList, 1);

    QHBoxLayout *fileButtonLayout = new QHBoxLayout;
    QPushButton *addFilesButton = new QPushButton(tr("添加文件"), fileGroup);
    QPushButton *addDirButton = new QPushButton(tr("添加目录"), fileGroup);
    QPushButton *removeButton = new QPushButton(tr("移除选中"), fileGroup);
    QPushButton *clearButton = new QPushButton(tr("清空"), fileGroup);
    fileButtonLayout->addWidget(addFilesButton);
    fileButtonLayout->addWidget(addDirButton);
    fileButtonLayout->addStretch(1);
    fileButtonLayout->addWidget(removeButton);
    fileButtonLayout->addWidget(clearButton);
    fileLayout->addLayout(fileButtonLayout);

    m_summaryLabel = new QLabel(tr("文件：0 个    目录：0 个    合计：0 B"), fileGroup);
    m_summaryLabel->setWordWrap(true);
    fileLayout->addWidget(m_summaryLabel);

    topSplitter->addWidget(deviceGroup);
    topSplitter->addWidget(fileGroup);
    topSplitter->setStretchFactor(0, 0);
    topSplitter->setStretchFactor(1, 1);
    topSplitter->setSizes(QList<int>() << 320 << 680);
    rootLayout->addWidget(topSplitter, 3);

    QGroupBox *logGroup = new QGroupBox(tr("日志"), central);
    QVBoxLayout *logLayout = new QVBoxLayout(logGroup);
    m_logView = new QPlainTextEdit(logGroup);
    m_logView->setReadOnly(true);
    m_logView->setMaximumBlockCount(5000);
    m_logView->setLineWrapMode(QPlainTextEdit::NoWrap);
    m_logView->setFont(QFontDatabase::systemFont(QFontDatabase::FixedFont));
    logLayout->addWidget(m_logView);
    rootLayout->addWidget(logGroup, 2);

    QHBoxLayout *bottomLayout = new QHBoxLayout;
    m_progressBar = new QProgressBar(central);
    m_progressBar->setRange(0, 100);
    m_progressBar->setValue(0);
    m_progressBar->setFormat(tr("就绪"));
    m_progressBar->setMinimumWidth(240);
    bottomLayout->addWidget(m_progressBar, 1);

    m_sendButton = new QPushButton(tr("发送"), central);
    m_sendButton->setDefault(true);
    m_receiveButton = new QPushButton(tr("接收"), central);
    m_cancelButton = new QPushButton(tr("取消发送"), central);
    m_cancelButton->setEnabled(false);
    QPushButton *quitButton = new QPushButton(tr("退出"), central);

    bottomLayout->addWidget(m_sendButton);
    bottomLayout->addWidget(m_receiveButton);
    bottomLayout->addWidget(m_cancelButton);
    bottomLayout->addWidget(quitButton);
    rootLayout->addLayout(bottomLayout);

    setCentralWidget(central);

    connect(m_refreshButton, &QPushButton::clicked,
            this, &MainWindow::refreshDevices);
    connect(m_deviceList, &QListWidget::itemClicked,
            this, &MainWindow::onDeviceClicked);
    connect(addFilesButton, &QPushButton::clicked,
            this, &MainWindow::chooseFiles);
    connect(addDirButton, &QPushButton::clicked,
            this, &MainWindow::chooseDirectory);
    connect(removeButton, &QPushButton::clicked,
            this, &MainWindow::removeSelectedFiles);
    connect(clearButton, &QPushButton::clicked,
            this, &MainWindow::clearFiles);
    connect(m_sendButton, &QPushButton::clicked,
            this, &MainWindow::sendSelectedFiles);
    connect(m_receiveButton, &QPushButton::clicked,
            this, &MainWindow::startReceive);
    connect(m_cancelButton, &QPushButton::clicked,
            this, &MainWindow::cancelSend);
    connect(quitButton, &QPushButton::clicked, this, &QWidget::close);
}

void MainWindow::chooseFiles()
{
    QSettings settings(QString::fromLatin1(kSettingsOrg), QString::fromLatin1(kSettingsApp));
    const QString startDir = settings.value(QStringLiteral("ui/lastDir"), QDir::homePath()).toString();
    const QStringList files = QFileDialog::getOpenFileNames(
        this,
        tr("选择要发送的文件"),
        startDir,
        tr("所有文件 (*)"));
    if (files.isEmpty()) {
        return;
    }
    settings.setValue(QStringLiteral("ui/lastDir"), QFileInfo(files.first()).absolutePath());
    addPaths(files);
}

void MainWindow::chooseDirectory()
{
    QSettings settings(QString::fromLatin1(kSettingsOrg), QString::fromLatin1(kSettingsApp));
    const QString startDir = settings.value(QStringLiteral("ui/lastDir"), QDir::homePath()).toString();
    const QString directory = QFileDialog::getExistingDirectory(
        this,
        tr("选择要发送的目录"),
        startDir,
        QFileDialog::ShowDirsOnly | QFileDialog::DontResolveSymlinks);
    if (directory.isEmpty()) {
        return;
    }
    settings.setValue(QStringLiteral("ui/lastDir"), directory);
    addPaths(QStringList() << directory);
}

void MainWindow::removeSelectedFiles()
{
    const QList<QListWidgetItem *> selected = m_fileList->selectedItems();
    if (selected.isEmpty()) {
        return;
    }
    for (QListWidgetItem *item : selected) {
        delete item;
    }
    updateSummary();
}

void MainWindow::clearFiles()
{
    if (m_fileList->count() == 0) {
        return;
    }
    m_fileList->clear();
    updateSummary();
}

void MainWindow::addPaths(const QStringList &paths)
{
    QSet<QString> existing;
    for (int i = 0; i < m_fileList->count(); ++i) {
        existing.insert(m_fileList->item(i)->data(Qt::UserRole).toString());
    }

    int added = 0;
    int skipped = 0;
    for (const QString &path : paths) {
        const QFileInfo info(path);
        if (!info.exists()) {
            ++skipped;
            appendLog(tr("路径不存在，已跳过：%1").arg(path));
            continue;
        }
        const QString cleanPath = QDir::cleanPath(info.absoluteFilePath());
        if (existing.contains(cleanPath)) {
            ++skipped;
            continue;
        }

        QListWidgetItem *item = new QListWidgetItem(m_fileList);
        item->setText(cleanPath);
        item->setData(Qt::UserRole, cleanPath);
        item->setToolTip(cleanPath);
        existing.insert(cleanPath);
        ++added;
    }

    updateSummary();
    if (added > 0) {
        appendLog(tr("已添加 %1 个文件/目录。").arg(added));
    }
    if (skipped > 0) {
        appendLog(tr("已跳过 %1 个无效或重复项。").arg(skipped));
    }
}

void MainWindow::updateSummary()
{
    int fileCount = 0;
    int directoryCount = 0;
    qint64 totalBytes = 0;

    for (int i = 0; i < m_fileList->count(); ++i) {
        const QString path = m_fileList->item(i)->data(Qt::UserRole).toString();
        const QFileInfo info(path);
        if (info.isDir()) {
            ++directoryCount;
            QDirIterator iterator(path,
                                  QDir::Files | QDir::Hidden | QDir::System,
                                  QDirIterator::Subdirectories);
            while (iterator.hasNext()) {
                iterator.next();
                ++fileCount;
                totalBytes += iterator.fileInfo().size();
            }
        } else if (info.isFile()) {
            ++fileCount;
            totalBytes += info.size();
        }
    }

    m_summaryLabel->setText(tr("文件：%1 个    目录：%2 个    合计：%3")
                                .arg(fileCount)
                                .arg(directoryCount)
                                .arg(formatBytes(totalBytes)));
}

QString MainWindow::formatBytes(qint64 bytes)
{
    static const char *const units[] = {"B", "KB", "MB", "GB", "TB"};
    double value = static_cast<double>(bytes);
    int unitIndex = 0;
    while (value >= 1024.0 && unitIndex < 4) {
        value /= 1024.0;
        ++unitIndex;
    }
    if (unitIndex == 0) {
        return QStringLiteral("%1 B").arg(bytes);
    }
    return QStringLiteral("%1 %2").arg(value, 0, 'f', 1)
        .arg(QString::fromLatin1(units[unitIndex]));
}

QString MainWindow::selectedTarget() const
{
    return m_targetEdit->text().trimmed();
}

QStringList MainWindow::selectedPaths() const
{
    QStringList paths;
    for (int i = 0; i < m_fileList->count(); ++i) {
        paths << m_fileList->item(i)->data(Qt::UserRole).toString();
    }
    return paths;
}

void MainWindow::sendSelectedFiles()
{
    if (m_sendProcess->state() != QProcess::NotRunning) {
        return;
    }

    const QString target = selectedTarget();
    if (target.isEmpty()) {
        QMessageBox::warning(this, tr("缺少目标设备"),
                             tr("请先选择设备，或手动输入设备名/IP 地址。"));
        m_targetEdit->setFocus();
        return;
    }

    QString cleanTarget = target.trimmed();
    const QStringList octets = cleanTarget.split(QLatin1Char('.'));
    if (octets.size() == 5 && octets[0] == QStringLiteral("192") && octets[1] == QStringLiteral("168")) {
        cleanTarget = QStringLiteral("192.168.%1.%2").arg(octets[3], octets[4]);
    }

    const QStringList paths = selectedPaths();
    if (paths.isEmpty()) {
        QMessageBox::warning(this, tr("没有文件"),
                             tr("请先添加要发送的文件或目录。"));
        return;
    }

    const QString cli = ensureCliPath();
    if (cli.isEmpty()) {
        return;
    }

    saveSettings();
    stopDiscovery();
    m_cancelRequested = false;
    m_sendBuffer.clear();

    // Release port 53317 and allow sockets to close
    QProcess::execute(QStringLiteral("pkill"), QStringList() << QStringLiteral("-9") << QStringLiteral("-f") << QStringLiteral("localsend-cli"));
    QThread::msleep(350);

    m_cliPath = cli;
    m_sendProcess->setProgram(cli);
    QStringList arguments;
    arguments << QStringLiteral("send")
              << QStringLiteral("--to")
              << cleanTarget
              << paths;
    m_sendProcess->setArguments(arguments);
    m_sendProcess->setWorkingDirectory(QDir::homePath());

    setBusy(true);
    m_progressBar->setRange(0, 0);
    m_progressBar->setValue(0);
    m_progressBar->setFormat(tr("正在连接…"));
    appendLog(tr("开始发送：目标 %1，共 %2 项。").arg(target).arg(paths.size()));
    statusBar()->showMessage(tr("正在发送…"), 0);
    m_sendProcess->start();
}

void MainWindow::cancelSend()
{
    if (m_sendProcess->state() == QProcess::NotRunning) {
        return;
    }
    m_cancelRequested = true;
    appendLog(tr("正在取消发送…"));
    m_progressBar->setFormat(tr("正在取消…"));
    m_sendProcess->terminate();
    QTimer::singleShot(2000, this, [this]() {
        if (m_sendProcess && m_sendProcess->state() != QProcess::NotRunning) {
            appendLog(tr("发送进程未响应，强制结束。"));
            m_sendProcess->kill();
        }
    });
}

void MainWindow::onSendReadyRead()
{
    m_sendBuffer.append(m_sendProcess->readAllStandardOutput());
    processSendBuffer();
}

void MainWindow::onSendFinished(int exitCode, QProcess::ExitStatus exitStatus)
{
    m_sendBuffer.append(m_sendProcess->readAllStandardOutput());
    processSendBuffer(true);

    const bool success = (exitStatus == QProcess::NormalExit && exitCode == 0);
    const bool canceled = m_cancelRequested;
    m_cancelRequested = false;

    setBusy(false);
    m_progressBar->setRange(0, 100);

    if (canceled) {
        m_progressBar->setValue(0);
        m_progressBar->setFormat(tr("已取消"));
        appendLog(tr("发送已取消。"));
        statusBar()->showMessage(tr("发送已取消；点击“刷新设备”可重新扫描。"), 6000);
    } else if (success) {
        m_progressBar->setValue(100);
        m_progressBar->setFormat(tr("发送完成"));
        appendLog(tr("发送完成。"));
        statusBar()->showMessage(tr("发送完成；点击“刷新设备”可重新扫描。"), 6000);
    } else {
        m_progressBar->setValue(0);
        m_progressBar->setFormat(tr("发送失败"));
        appendLog(tr("发送失败（退出码 %1）。请查看上方 CLI 输出。").arg(exitCode));
        statusBar()->showMessage(tr("发送失败"), 6000);
    }
}

void MainWindow::onSendError(QProcess::ProcessError error)
{
    if (error == QProcess::FailedToStart) {
        appendLog(tr("无法启动 CLI：%1").arg(m_sendProcess->errorString()));
        m_cancelRequested = false;
        setBusy(false);
        m_progressBar->setRange(0, 100);
        m_progressBar->setValue(0);
        m_progressBar->setFormat(tr("启动失败"));
        statusBar()->showMessage(tr("无法启动 localsend-cli"), 6000);
    } else if (!(error == QProcess::Crashed && m_cancelRequested)) {
        appendLog(tr("发送进程错误：%1").arg(m_sendProcess->errorString()));
    }
}

void MainWindow::setBusy(bool busy)
{
    m_sendButton->setEnabled(!busy);
    m_receiveButton->setEnabled(!busy);
    m_refreshButton->setEnabled(!busy);
    m_targetEdit->setEnabled(!busy);
    m_deviceList->setEnabled(!busy);
    m_cancelButton->setEnabled(busy);

    if (busy) {
        m_progressBar->setRange(0, 0);
        m_progressBar->setValue(0);
        m_progressBar->setFormat(tr("正在发送…"));
    } else if (m_progressBar->maximum() == 0) {
        m_progressBar->setRange(0, 100);
        m_progressBar->setValue(0);
        m_progressBar->setFormat(tr("就绪"));
    }
}

void MainWindow::processSendBuffer(bool flush)
{
    while (!m_sendBuffer.isEmpty()) {
        int delimiter = -1;
        for (int i = 0; i < m_sendBuffer.size(); ++i) {
            const char ch = m_sendBuffer.at(i);
            if (ch == '\n' || ch == '\r') {
                delimiter = i;
                break;
            }
        }
        if (delimiter < 0) {
            break;
        }
        const QByteArray raw = m_sendBuffer.left(delimiter);
        m_sendBuffer.remove(0, delimiter + 1);
        handleSendLine(QString::fromUtf8(raw));
    }

    if (flush && !m_sendBuffer.isEmpty()) {
        const QByteArray raw = m_sendBuffer;
        m_sendBuffer.clear();
        handleSendLine(QString::fromUtf8(raw));
    }
}

void MainWindow::handleSendLine(const QString &rawLine)
{
    static const QRegularExpression ansi(
        QStringLiteral("\\x1B\\[[0-9;?]*[ -/]*[@-~]"));

    QString line = rawLine;
    line.remove(ansi);
    line = line.trimmed();
    if (line.isEmpty()) {
        return;
    }

    if (line.contains(QStringLiteral("ETA:"), Qt::CaseInsensitive)) {
        updateProgressFromStatusLine(line);
        return;
    }

    appendLog(line);
}

void MainWindow::updateProgressFromStatusLine(const QString &line)
{
    static const QRegularExpression sizePattern(
        QStringLiteral("([0-9]+(?:\\.[0-9]+)?)\\s*(B|KB|MB|GB|TB)\\s*/\\s*"
                       "([0-9]+(?:\\.[0-9]+)?)\\s*(B|KB|MB|GB|TB)"));

    const QRegularExpressionMatch match = sizePattern.match(line);
    if (!match.hasMatch()) {
        appendLog(line);
        return;
    }

    const qint64 done = sizeToBytes(match.captured(1), match.captured(2));
    const qint64 total = sizeToBytes(match.captured(3), match.captured(4));
    if (total <= 0) {
        appendLog(line);
        return;
    }

    int percent = static_cast<int>((static_cast<double>(done) * 100.0)
                                   / static_cast<double>(total));
    percent = qBound(0, percent, 100);

    m_progressBar->setRange(0, 100);
    m_progressBar->setValue(percent);
    m_progressBar->setFormat(tr("发送中 %1%  (%2 / %3)")
                                 .arg(percent)
                                 .arg(formatBytes(done), formatBytes(total)));
}

void MainWindow::appendLog(const QString &text)
{
    if (!m_logView) {
        return;
    }

    QString cleaned = text;
    cleaned.remove(QLatin1Char('\r'));
    const QString stamp = QTime::currentTime().toString(QStringLiteral("HH:mm:ss"));
    const QStringList lines = cleaned.split(QLatin1Char('\n'));
    for (const QString &line : lines) {
        const QString trimmed = line.trimmed();
        if (trimmed.isEmpty()) {
            continue;
        }
        m_logView->appendPlainText(QStringLiteral("[%1] %2").arg(stamp, trimmed));
    }
    m_logView->ensureCursorVisible();
}

void MainWindow::refreshDevices()
{
    if (!m_sendProcess || m_sendProcess->state() != QProcess::NotRunning) {
        appendLog(tr("发送过程中不能刷新设备。"));
        return;
    }
    if (!m_probeIdentityLoaded && QSslSocket::supportsSsl()) {
        loadProbeIdentity();
    }
    startDiscovery();
}

void MainWindow::startDiscovery()
{
    ++m_discoveryGeneration;
    const int generation = m_discoveryGeneration;

    m_discoveryRunning = true;
    m_pendingProbes = 0;
    m_activeProbes = 0;
    m_probeQueue.clear();
    m_discoveredItems.clear();
    m_deviceList->clear();
    m_refreshButton->setEnabled(false);
    m_deviceStatusLabel->setText(tr("正在扫描局域网…"));
    appendLog(tr("开始发现设备（组播监听 + 本网段扫描）…"));

    stopDiscovery();

    if (m_discoverySocket->bind(QHostAddress::AnyIPv4,
                                kDefaultPort,
                                QUdpSocket::ShareAddress | QUdpSocket::ReuseAddressHint)) {
        const QHostAddress group(QString::fromLatin1(kMulticastGroup));
        if (!m_discoverySocket->joinMulticastGroup(group)) {
            appendLog(tr("加入组播组失败：%1").arg(m_discoverySocket->errorString()));
        }
    } else {
        appendLog(tr("无法监听 UDP %1：%2")
                      .arg(kDefaultPort)
                      .arg(m_discoverySocket->errorString()));
    }

    if (!m_probeIdentityLoaded) {
        m_deviceStatusLabel->setText(tr("仅监听组播（未加载 TLS 身份）…"));
        appendLog(tr("未加载 TLS 客户端身份，跳过 HTTPS 网段扫描，仅监听组播广播。"));
        QTimer::singleShot(kDiscoveryWindowMs, this, [this, generation]() {
            if (generation == m_discoveryGeneration) {
                finishDiscovery();
            }
        });
        return;
    }

    QSet<QString> addresses;
    const QList<QNetworkInterface> interfaces = QNetworkInterface::allInterfaces();
    for (const QNetworkInterface &interface : interfaces) {
        const QNetworkInterface::InterfaceFlags flags = interface.flags();
        if (!(flags & QNetworkInterface::IsUp)
            || !(flags & QNetworkInterface::IsRunning)
            || (flags & QNetworkInterface::IsLoopBack)) {
            continue;
        }

        const QList<QNetworkAddressEntry> entries = interface.addressEntries();
        for (const QNetworkAddressEntry &entry : entries) {
            const QHostAddress address = entry.ip();
            if (address.protocol() != QAbstractSocket::IPv4Protocol) {
                continue;
            }
            if (address.isLoopback() || address.isLinkLocal()) {
                continue;
            }

            const quint32 ownAddress = address.toIPv4Address();
            const quint32 network = ownAddress & 0xFFFFFF00u;
            for (quint32 host = 1; host <= 254; ++host) {
                if (host == (ownAddress & 0xFFu)) {
                    continue;
                }
                addresses.insert(QHostAddress(network | host).toString());
            }
        }
    }

    if (addresses.isEmpty()) {
        m_deviceStatusLabel->setText(tr("未找到可扫描的局域网，仅监听组播…"));
        appendLog(tr("未找到可扫描的 IPv4 局域网地址，仅监听组播广播。"));
        QTimer::singleShot(2000, this, [this, generation]() {
            if (generation == m_discoveryGeneration) {
                finishDiscovery();
            }
        });
        return;
    }

    m_pendingProbes = addresses.size();
    appendLog(tr("正在探测 %1 个局域网地址…").arg(m_pendingProbes));

    m_probeQueue = addresses.values();
    startQueuedProbes();

    QTimer::singleShot(kDiscoveryWindowMs, this, [this, generation]() {
        if (generation == m_discoveryGeneration) {
            finishDiscovery();
        }
    });
}

void MainWindow::startQueuedProbes()
{
    const int generation = m_discoveryGeneration;
    while (m_probeIdentityLoaded
           && m_activeProbes < kMaxConcurrentProbes
           && !m_probeQueue.isEmpty()) {
        const QString ip = m_probeQueue.takeFirst();
        ++m_activeProbes;
        probeHost(ip, generation);
    }
}

void MainWindow::stopDiscovery()
{
    if (!m_discoverySocket) {
        return;
    }
    if (m_discoverySocket->state() != QAbstractSocket::UnconnectedState) {
        m_discoverySocket->leaveMulticastGroup(
            QHostAddress(QString::fromLatin1(kMulticastGroup)));
        m_discoverySocket->close();
    }
}

void MainWindow::finishDiscovery()
{
    if (!m_discoveryRunning) {
        return;
    }
    m_discoveryRunning = false;
    m_probeQueue.clear();
    m_pendingProbes = 0;

    if (m_sendProcess->state() == QProcess::NotRunning) {
        m_refreshButton->setEnabled(true);
    }

    const int count = m_discoveredItems.size();
    if (count == 0) {
        m_deviceStatusLabel->setText(tr("未发现设备，可手动输入 IP"));
        appendLog(tr("本轮未发现设备。请确认对方已打开 LocalSend，或直接输入对方 IP。"));
    } else {
        m_deviceStatusLabel->setText(tr("发现 %1 台设备").arg(count));
        appendLog(tr("本轮扫描结束，共发现 %1 台设备。").arg(count));
    }
}

void MainWindow::onDiscoveryReadyRead()
{
    while (m_discoverySocket->hasPendingDatagrams()) {
        QByteArray datagram;
        datagram.resize(static_cast<int>(m_discoverySocket->pendingDatagramSize()));

        QHostAddress sender;
        quint16 senderPort = 0;
        const qint64 read = m_discoverySocket->readDatagram(
            datagram.data(), datagram.size(), &sender, &senderPort);
        Q_UNUSED(senderPort);
        if (read <= 0) {
            continue;
        }

        QJsonParseError parseError;
        const QJsonDocument document = QJsonDocument::fromJson(datagram, &parseError);
        if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
            continue;
        }

        const QJsonObject object = document.object();
        const QString alias = object.value(QStringLiteral("alias")).toString();
        const QString fingerprint = object.value(QStringLiteral("fingerprint")).toString();
        if (alias.isEmpty()) {
            continue;
        }
        if (isOwnFingerprint(fingerprint)) {
            continue;
        }

        QString ip = sender.toString();
        const QString mappedPrefix = QStringLiteral("::ffff:");
        if (ip.startsWith(mappedPrefix, Qt::CaseInsensitive)) {
            ip = ip.mid(mappedPrefix.size());
        }
        if (ip.isEmpty() || ip.contains(QLatin1Char(':'))) {
            continue;
        }

        addDiscoveredDevice(alias, ip, fingerprint);
    }
}

void MainWindow::probeHost(const QString &ip, int generation)
{
    if (!m_probeIdentityLoaded) {
        return;
    }

    QUrl url;
    url.setScheme(QStringLiteral("https"));
    url.setHost(ip);
    url.setPort(kDefaultPort);
    url.setPath(QStringLiteral("/api/localsend/v2/info"));

    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader,
                      QStringLiteral("LocalSendGUI/0.1"));
    request.setSslConfiguration(m_probeSslConfiguration);

    QNetworkReply *reply = m_network->get(request);
    connect(reply, &QNetworkReply::sslErrors, reply,
            [reply](const QList<QSslError> &) { reply->ignoreSslErrors(); });

    QTimer *timer = new QTimer(reply);
    timer->setSingleShot(true);
    connect(timer, &QTimer::timeout, reply, &QNetworkReply::abort);
    timer->start(kProbeTimeoutMs);

    connect(reply, &QNetworkReply::finished, this, [this, reply, generation]() {
        onProbeFinished(reply, generation);
    });
}

void MainWindow::onProbeFinished(QNetworkReply *reply, int generation)
{
    if (generation == m_discoveryGeneration) {
        if (m_activeProbes > 0) {
            --m_activeProbes;
        }
        if (m_pendingProbes > 0) {
            --m_pendingProbes;
        }

        if (reply->error() == QNetworkReply::NoError) {
            const QByteArray body = reply->readAll();
            QJsonParseError parseError;
            const QJsonDocument document = QJsonDocument::fromJson(body, &parseError);
            if (parseError.error == QJsonParseError::NoError && document.isObject()) {
                const QJsonObject object = document.object();
                const QString alias = object.value(QStringLiteral("alias")).toString();
                const QString fingerprint =
                    object.value(QStringLiteral("fingerprint")).toString();
                const QString ip = reply->url().host();
                if (!alias.isEmpty() && !ip.isEmpty()
                    && !isOwnFingerprint(fingerprint)) {
                    addDiscoveredDevice(alias, ip, fingerprint);
                }
            }
        }

        if (m_discoveryRunning) {
            if (m_pendingProbes <= 0) {
                finishDiscovery();
            } else {
                startQueuedProbes();
            }
        }
    }

    reply->deleteLater();
}

bool MainWindow::isOwnFingerprint(const QString &fingerprint) const
{
    return !fingerprint.isEmpty()
        && !m_fingerprint.isEmpty()
        && fingerprint.compare(m_fingerprint, Qt::CaseInsensitive) == 0;
}

void MainWindow::addDiscoveredDevice(const QString &alias,
                                     const QString &ip,
                                     const QString &fingerprint)
{
    if (ip.isEmpty() || isLocalAddress(ip) || isOwnFingerprint(fingerprint)) {
        return;
    }

    QString cleanAlias = alias;
    cleanAlias.replace(QLatin1Char('\n'), QLatin1Char(' '));
    cleanAlias.replace(QLatin1Char('\r'), QLatin1Char(' '));
    cleanAlias.replace(QLatin1Char('\t'), QLatin1Char(' '));
    cleanAlias = cleanAlias.simplified();
    if (cleanAlias.isEmpty()) {
        cleanAlias = ip;
    }

    QListWidgetItem *item = m_discoveredItems.value(ip, nullptr);
    if (!item) {
        item = new QListWidgetItem(m_deviceList);
        m_discoveredItems.insert(ip, item);
        appendLog(tr("发现设备：%1 (%2)").arg(cleanAlias, ip));
    }

    item->setText(QStringLiteral("%1    %2").arg(cleanAlias, ip));
    item->setData(Qt::UserRole, ip);
    item->setData(Qt::UserRole + 1, fingerprint);

    QString tooltip = tr("%1\nIP: %2").arg(cleanAlias, ip);
    if (!fingerprint.isEmpty()) {
        tooltip += tr("\n指纹: %1").arg(fingerprint);
    }
    item->setToolTip(tooltip);

    if (m_discoveryRunning) {
        m_deviceStatusLabel->setText(
            tr("正在扫描…已发现 %1 台").arg(m_discoveredItems.size()));
    } else {
        m_deviceStatusLabel->setText(
            tr("已发现 %1 台设备").arg(m_discoveredItems.size()));
    }
}

void MainWindow::onDeviceClicked(QListWidgetItem *item)
{
    if (!item) {
        return;
    }
    const QString ip = item->data(Qt::UserRole).toString();
    if (!ip.isEmpty()) {
        m_targetEdit->setText(ip);
    }
}

void MainWindow::startReceive()
{
    if (m_sendProcess->state() != QProcess::NotRunning) {
        appendLog(tr("发送过程中不能启动接收模式。"));
        return;
    }

    const QString cli = ensureCliPath();
    if (cli.isEmpty()) {
        return;
    }

    QStringList terminalArguments;
    const QString terminal = findTerminal(&terminalArguments);
    if (terminal.isEmpty()) {
        QMessageBox::warning(
            this,
            tr("找不到终端"),
            tr("未找到可用的终端模拟器，无法启动交互式接收模式。\n"
               "请安装 xterm、mate-terminal 或 gnome-terminal。"));
        return;
    }

    saveSettings();
    stopDiscovery();

    // Release port 53317 if an older CLI process is lingering
    QProcess::execute(QStringLiteral("pkill"), QStringList() << QStringLiteral("-9") << QStringLiteral("-f") << QStringLiteral("localsend-cli"));
    QThread::msleep(200);

    const QString downloadsPath = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation) + QStringLiteral("/LocalSend");
    QDir().mkpath(downloadsPath);

    const QString command = QStringLiteral(
        "cd %1 && %2; code=$?; echo; echo \"LocalSend CLI 已退出（退出码 $code）\"; "
        "read -r -p \"按回车键关闭窗口…\" _")
        .arg(shellQuote(downloadsPath), shellQuote(cli));

    QStringList arguments = terminalArguments;
    arguments << QStringLiteral("/bin/bash")
              << QStringLiteral("-c")
              << command;

    qint64 pid = 0;
    if (QProcess::startDetached(terminal, arguments, downloadsPath, &pid)) {
        appendLog(tr("已在系统终端中启动接收模式（保存至 %1）。").arg(downloadsPath));
        statusBar()->showMessage(tr("接收模式已启动"), 6000);
    } else {
        QMessageBox::critical(
            this,
            tr("启动失败"),
            tr("无法启动终端程序：%1").arg(terminal));
    }
}

QString MainWindow::resolveCliPath() const
{
    const QString fromEnvironment = qEnvironmentVariable("LOCALSEND_CLI");
    if (!fromEnvironment.isEmpty()) {
        const QFileInfo info(fromEnvironment);
        if (info.isFile() && info.isExecutable()) {
            return info.absoluteFilePath();
        }
    }

    QSettings settings(QString::fromLatin1(kSettingsOrg), QString::fromLatin1(kSettingsApp));
    const QString configured = settings.value(QString::fromLatin1(kCliPathKey)).toString();
    if (!configured.isEmpty()) {
        const QFileInfo info(configured);
        if (info.isFile() && info.isExecutable()) {
            return info.absoluteFilePath();
        }
    }

    const QString appDir = QCoreApplication::applicationDirPath();
    QStringList candidates;
    candidates << QDir(appDir).absoluteFilePath(QStringLiteral("localsend-cli"));
    candidates << QStringLiteral("/data/QtProjects/localsend/target/debug/localsend-cli");
    candidates << QStringLiteral("/data/QtProjects/localsend/target/release/localsend-cli");
    candidates << QDir::homePath() + QStringLiteral("/.local/bin/localsend-cli");
    candidates << QStringLiteral("/usr/local/bin/localsend-cli");
    candidates << QStringLiteral("/usr/bin/localsend-cli");

    for (const QString &candidate : candidates) {
        const QFileInfo info(candidate);
        if (info.isFile() && info.isExecutable()) {
            return info.absoluteFilePath();
        }
    }

    const QString fromPath = QStandardPaths::findExecutable(QStringLiteral("localsend-cli"));
    if (!fromPath.isEmpty()) {
        return fromPath;
    }

    return QString();
}

QString MainWindow::resolveIdentityPath() const
{
    const QString fromEnvironment = qEnvironmentVariable("LOCALSEND_IDENTITY");
    if (!fromEnvironment.isEmpty()) {
        const QFileInfo info(fromEnvironment);
        if (info.isFile()) {
            return info.absoluteFilePath();
        }
    }

    QString configHome = qEnvironmentVariable("XDG_CONFIG_HOME");
    if (configHome.isEmpty() || !QDir::isAbsolutePath(configHome)) {
        configHome = QDir::homePath() + QStringLiteral("/.config");
    }

    const QFileInfo info(
        QDir(configHome).absoluteFilePath(QStringLiteral("localsend-cli/identity.pem")));
    if (info.isFile()) {
        return info.absoluteFilePath();
    }
    return QString();
}

bool MainWindow::loadProbeIdentity()
{
    m_probeIdentityLoaded = false;

    auto warnOnce = [this](const QString &message) {
        if (!m_probeIdentityWarningLogged) {
            appendLog(message);
            m_probeIdentityWarningLogged = true;
        }
    };

    const QString path = resolveIdentityPath();
    if (path.isEmpty()) {
        warnOnce(tr("未找到 LocalSend CLI 的 TLS 身份文件 identity.pem。"));
        return false;
    }

    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        warnOnce(tr("无法读取身份文件 %1：%2").arg(path, file.errorString()));
        return false;
    }
    const QByteArray pem = file.readAll();
    file.close();

    const QList<QSslCertificate> certificates = QSslCertificate::fromData(pem, QSsl::Pem);
    QSslKey key(pem, QSsl::Rsa, QSsl::Pem);
    if (key.isNull()) {
        key = QSslKey(pem, QSsl::Ec, QSsl::Pem);
    }
    if (certificates.isEmpty() || key.isNull()) {
        warnOnce(tr("身份文件无效：%1").arg(path));
        return false;
    }

    QSslConfiguration configuration = QSslConfiguration::defaultConfiguration();
    configuration.setPeerVerifyMode(QSslSocket::VerifyNone);
    configuration.setLocalCertificate(certificates.first());
    configuration.setLocalCertificateChain(certificates);
    configuration.setPrivateKey(key);
    m_probeSslConfiguration = configuration;
    m_probeIdentityLoaded = true;
    m_probeIdentityWarningLogged = false;

    m_fingerprint = QString::fromLatin1(
        certificates.first().digest(QCryptographicHash::Sha256).toHex()).toUpper();
    appendLog(tr("已加载 TLS 身份：%1（指纹 %2）").arg(path, m_fingerprint));
    return true;
}

QString MainWindow::ensureCliPath()
{
    const QString found = resolveCliPath();
    if (!found.isEmpty()) {
        m_cliPath = found;
        return found;
    }

    const QMessageBox::StandardButton answer = QMessageBox::question(
        this,
        tr("未找到 localsend-cli"),
        tr("未能自动找到 localsend-cli。\n\n是否现在选择它的可执行文件？"),
        QMessageBox::Yes | QMessageBox::No,
        QMessageBox::Yes);
    if (answer != QMessageBox::Yes) {
        appendLog(tr("用户取消了 CLI 路径选择。"));
        return QString();
    }

    QSettings settings(QString::fromLatin1(kSettingsOrg), QString::fromLatin1(kSettingsApp));
    const QString startPath = settings.value(
        QString::fromLatin1(kCliPathKey), QDir::homePath()).toString();
    const QString file = QFileDialog::getOpenFileName(
        this,
        tr("选择 localsend-cli 可执行文件"),
        startPath,
        tr("所有文件 (*)"));
    if (file.isEmpty()) {
        return QString();
    }

    const QFileInfo info(file);
    if (!info.isFile() || !info.isExecutable()) {
        QMessageBox::warning(this, tr("无效的可执行文件"),
                             tr("所选文件不可执行：%1").arg(file));
        return QString();
    }

    const QString absolutePath = info.absoluteFilePath();
    settings.setValue(QString::fromLatin1(kCliPathKey), absolutePath);
    m_cliPath = absolutePath;
    appendLog(tr("已设置 CLI 路径：%1").arg(absolutePath));
    return absolutePath;
}

QString MainWindow::findTerminal(QStringList *arguments) const
{
    struct TerminalCandidate {
        const char *program;
        const char *flag;
    };

    static const TerminalCandidate candidates[] = {
        {"x-terminal-emulator", "-e"},
        {"mate-terminal", "-x"},
        {"ukui-terminal", "-e"},
        {"deepin-terminal", "-e"},
        {"qterminal", "-e"},
        {"konsole", "-e"},
        {"xfce4-terminal", "-x"},
        {"gnome-terminal", "--"},
        {"xterm", "-e"}
    };

    for (const TerminalCandidate &candidate : candidates) {
        const QString path = QStandardPaths::findExecutable(
            QString::fromLatin1(candidate.program));
        if (!path.isEmpty()) {
            if (arguments) {
                *arguments = QStringList() << QString::fromLatin1(candidate.flag);
            }
            return path;
        }
    }

    return QString();
}

void MainWindow::loadSettings()
{
    QSettings settings(QString::fromLatin1(kSettingsOrg), QString::fromLatin1(kSettingsApp));

    const QByteArray geometry = settings.value(QStringLiteral("ui/geometry")).toByteArray();
    if (!geometry.isEmpty()) {
        restoreGeometry(geometry);
    }

    const QString target = settings.value(
        QString::fromLatin1(kLastTargetKey)).toString();
    if (!target.isEmpty()) {
        m_targetEdit->setText(target);
    }
}

void MainWindow::saveSettings()
{
    QSettings settings(QString::fromLatin1(kSettingsOrg), QString::fromLatin1(kSettingsApp));
    settings.setValue(QStringLiteral("ui/geometry"), saveGeometry());

    const QString target = selectedTarget();
    if (!target.isEmpty()) {
        settings.setValue(QString::fromLatin1(kLastTargetKey), target);
    } else {
        settings.remove(QString::fromLatin1(kLastTargetKey));
    }
}

void MainWindow::dragEnterEvent(QDragEnterEvent *event)
{
    if (event->mimeData()->hasUrls()) {
        const QList<QUrl> urls = event->mimeData()->urls();
        for (const QUrl &url : urls) {
            if (url.isLocalFile()) {
                event->acceptProposedAction();
                return;
            }
        }
    }
    event->ignore();
}

void MainWindow::dropEvent(QDropEvent *event)
{
    QStringList paths;
    const QList<QUrl> urls = event->mimeData()->urls();
    for (const QUrl &url : urls) {
        if (url.isLocalFile()) {
            paths << url.toLocalFile();
        }
    }

    if (paths.isEmpty()) {
        event->ignore();
        return;
    }

    addPaths(paths);
    event->acceptProposedAction();
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    if (m_sendProcess && m_sendProcess->state() != QProcess::NotRunning) {
        const QMessageBox::StandardButton answer = QMessageBox::question(
            this,
            tr("正在发送"),
            tr("文件仍在发送中，确定要退出吗？"),
            QMessageBox::Yes | QMessageBox::No,
            QMessageBox::No);
        if (answer != QMessageBox::Yes) {
            event->ignore();
            return;
        }
        m_cancelRequested = true;
        m_sendProcess->kill();
        m_sendProcess->waitForFinished(1000);
    }

    saveSettings();
    stopDiscovery();
    event->accept();
}
