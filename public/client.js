document.addEventListener('DOMContentLoaded', () => {
    // Elemen UI
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const logConsole = document.getElementById('log-console');
    
    // Input Konfigurasi
    const senderMnemonicInput = document.getElementById('senderMnemonic');
    const feePayerMnemonicInput = document.getElementById('feePayerMnemonic');
    const recipientAddressInput = document.getElementById('recipientAddress');
    const parallelRequestsInput = document.getElementById('parallelRequests');
    const amountPerTxInput = document.getElementById('amountPerTx');

    let ws;

    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${protocol}://${window.location.host}`);

        ws.onopen = () => addLog('✅ Terhubung ke server.', 'success');
        ws.onmessage = handleServerMessage;
        ws.onclose = () => {
            addLog('🔌 Koneksi terputus. Mencoba menghubungkan kembali...', 'error');
            updateButtonState(false);
            setTimeout(connectWebSocket, 5000);
        };
        ws.onerror = (error) => addLog('❌ WebSocket error.', 'error');
    }

    function handleServerMessage(event) {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
            addLog(data.message, data.level);
        } else if (data.type === 'status') {
            updateButtonState(data.running);
        }
    }

    function addLog(message, level = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${level}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logConsole.appendChild(entry);
        logConsole.parentElement.scrollTop = logConsole.parentElement.scrollHeight;
    }

    function updateButtonState(isRunning) {
        startButton.disabled = isRunning;
        stopButton.disabled = !isRunning;
        // Kunci input saat berjalan
        const inputs = [senderMnemonicInput, feePayerMnemonicInput, recipientAddressInput, parallelRequestsInput, amountPerTxInput];
        inputs.forEach(input => input.disabled = isRunning);
    }

    startButton.addEventListener('click', () => {
        const config = {
            senderMnemonic: senderMnemonicInput.value.trim(),
            feePayerMnemonic: feePayerMnemonicInput.value.trim(),
            recipientAddress: recipientAddressInput.value.trim(),
            parallelRequests: parseInt(parallelRequestsInput.value, 10),
            amountPerTx: amountPerTxInput.value.trim()
        };

        if (!config.senderMnemonic || !config.recipientAddress || !config.amountPerTx) {
            addLog("❌ Harap isi Mnemonic Pengirim, Alamat Penerima, dan Jumlah Pi.", 'error');
            return;
        }

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ command: 'start', config }));
            updateButtonState(true);
            addLog('▶️ Perintah START dengan konfigurasi baru dikirim.', 'warn');
        }
    });

    stopButton.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ command: 'stop' }));
            addLog('⏹️ Perintah STOP dikirim.', 'warn');
        }
    });

    // Mulai koneksi
    connectWebSocket();
});
