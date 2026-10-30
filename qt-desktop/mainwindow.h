#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QByteArray>
#include <QHash>
#include <QMainWindow>
#include <QProcess>
#include <QSslConfiguration>
#include <QStringList>

class QCloseEvent;
class QDragEnterEvent;
class QDropEvent;
class QLabel;
class QLineEdit;
class QListWidget;
class QListWidgetItem;
class QNetworkAccessManager;
class QNetworkReply;
class QPlainTextEdit;
class QProgressBar;
class QPushButton;
class QUdpSocket;

QT_BEGIN_NAMESPACE
namespace Ui { class MainWindow; }
QT_END_NAMESPACE

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow() override;

protected:
    void dragEnterEvent(QDragEnterEvent *event) override;
    void dropEvent(QDropEvent *event) override;
    void closeEvent(QCloseEvent *event) override;

private slots:
    void chooseFiles();
    void chooseDirectory();
    void removeSelectedFiles();
    void clearFiles();
    void sendSelectedFiles();
    void cancelSend();
    void startReceive();
    void refreshDevices();
    void onDeviceClicked(QListWidgetItem *item);
    void onSendReadyRead();
    void onSendFinished(int exitCode, QProcess::ExitStatus exitStatus);
    void onSendError(QProcess::ProcessError error);
    void onDiscoveryReadyRead();

private:
    void buildUi();
    void addPaths(const QStringList &paths);
    void updateSummary();
    void appendLog(const QString &text);
    void setBusy(bool busy);
    void processSendBuffer(bool flush = false);
    void handleSendLine(const QString &line);
    void updateProgressFromStatusLine(const QString &line);
    void startDiscovery();
    void stopDiscovery();
    void finishDiscovery();
    void startQueuedProbes();
    void probeHost(const QString &ip, int generation);
    void onProbeFinished(QNetworkReply *reply, int generation);
    void addDiscoveredDevice(const QString &alias,
                             const QString &ip,
                             const QString &fingerprint);
    bool isOwnFingerprint(const QString &fingerprint) const;
    QString selectedTarget() const;
    QStringList selectedPaths() const;
    QString resolveCliPath() const;
    QString resolveIdentityPath() const;
    bool loadProbeIdentity();
    QString ensureCliPath();
    QString findTerminal(QStringList *arguments) const;
    void loadSettings();
    void saveSettings();
    static QString formatBytes(qint64 bytes);

    Ui::MainWindow *ui;

    QLineEdit *m_targetEdit;
    QListWidget *m_deviceList;
    QLabel *m_deviceStatusLabel;
    QPushButton *m_refreshButton;

    QListWidget *m_fileList;
    QLabel *m_summaryLabel;

    QPlainTextEdit *m_logView;
    QProgressBar *m_progressBar;
    QPushButton *m_sendButton;
    QPushButton *m_receiveButton;
    QPushButton *m_cancelButton;

    QProcess *m_sendProcess;
    QUdpSocket *m_discoverySocket;
    QNetworkAccessManager *m_network;

    QHash<QString, QListWidgetItem *> m_discoveredItems;
    QByteArray m_sendBuffer;
    QString m_fingerprint;
    QString m_cliPath;

    QStringList m_probeQueue;
    QSslConfiguration m_probeSslConfiguration;
    int m_activeProbes;
    bool m_probeIdentityLoaded;
    bool m_probeIdentityWarningLogged;

    int m_pendingProbes;
    int m_discoveryGeneration;
    bool m_discoveryRunning;
    bool m_cancelRequested;
};

#endif // MAINWINDOW_H
