const net = require('net');
const dgram = require('dgram');

const LOOPBACK_HOST = '127.0.0.1';

function closeTcpServer(server) {
    return new Promise((resolve) => {
        if (!server) return resolve();
        try {
            server.close(() => resolve());
        } catch (e) {
            resolve();
        }
    });
}

function closeUdpSocket(socket) {
    return new Promise((resolve) => {
        if (!socket) return resolve();
        try {
            socket.close(() => resolve());
        } catch (e) {
            resolve();
        }
    });
}

function listenTcp(server, host) {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            server.removeListener('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            server.removeListener('error', onError);
            resolve(server.address().port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ host, port: 0, exclusive: true });
    });
}

function bindUdp(socket, host, port) {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            socket.removeListener('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            socket.removeListener('error', onError);
            resolve();
        };
        socket.once('error', onError);
        socket.once('listening', onListening);
        socket.bind({ address: host, port, exclusive: true });
    });
}

async function allocateLocalProxyPort(options = {}) {
    const host = options.host || LOOPBACK_HOST;
    const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 20;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const tcpServer = net.createServer();
        let udpSocket = null;
        try {
            const port = await listenTcp(tcpServer, host);
            udpSocket = dgram.createSocket('udp4');
            await bindUdp(udpSocket, host, port);

            await closeUdpSocket(udpSocket);
            await closeTcpServer(tcpServer);
            return port;
        } catch (error) {
            lastError = error;
            await closeUdpSocket(udpSocket);
            await closeTcpServer(tcpServer);
        }
    }

    const error = new Error(`Unable to allocate a local TCP/UDP proxy port after ${maxAttempts} attempts`);
    error.code = 'LOCAL_PROXY_PORT_UNAVAILABLE';
    error.cause = lastError;
    throw error;
}

function isXrayLocalBindFailure(logText, port) {
    const text = String(logText || '');
    if (!text) return false;

    const bindFailure = /failed to start[\s\S]*?listen\s+(?:tcp|udp)[\s\S]*?(?:bind:|address already in use|access permissions|forbidden by its access permissions|WSAEACCES)/i;
    if (!bindFailure.test(text)) return false;
    if (!Number.isInteger(Number(port))) return true;

    return new RegExp(`(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):${Number(port)}\\b`, 'i').test(text);
}

module.exports = {
    allocateLocalProxyPort,
    isXrayLocalBindFailure
};
