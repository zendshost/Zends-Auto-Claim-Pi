document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const logConsole = document.getElementById('log-console');

    let ws;

    function connectWebSocket() {
        // Gunakan wss:// jika di-deploy dengan HTTPS
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${protocol}://${window.location.host}`);

        ws.onopen = () => {
            addLog('✅ Terhubung ke server.', 'success');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'log') {
                addLog(data.message, data.level);
            } else if (data.type === 'status') {
                updateButtonState(data.running);
            }
        };

        ws.onclose = () => {
            addLog('🔌 Koneksi terputus. Mencoba menghubungkan kembali dalam 5 detik...', 'error');
            updateButtonState(false);
            setTimeout(connectWebSocket, 5000);
        };

        ws.onerror = (error) => {
            addLog('❌ WebSocket error. Lihat konsol browser untuk detail.', 'error');
            console.error('WebSocket Error:', error);
        };
    }

    function addLog(message, level = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${level}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logConsole.appendChild(entry);
        // Auto-scroll to bottom
        logConsole.parentElement.scrollTop = logConsole.parentElement.scrollHeight;
    }

    function updateButtonState(isRunning) {
        if (isRunning) {
            startButton.disabled = true;
            stopButton.disabled = false;
        } else {
            startButton.disabled = false;
            stopButton.disabled = true;
        }
    }

    startButton.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ command: 'start' }));
            updateButtonState(true);
            addLog('▶️ Perintah START dikirim ke server.', 'warn');
        } else {
            addLog('Tidak dapat mengirim perintah, koneksi WebSocket tidak terbuka.', 'error');
        }
    });

    stopButton.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ command: 'stop' }));
            updateButtonState(false);
            addLog('⏹️ Perintah STOP dikirim ke server.', 'warn');
        }
    });

    // Mulai koneksi
    connectWebSocket();
});
