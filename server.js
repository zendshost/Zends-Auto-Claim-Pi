// Import Modul
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('ws');
const StellarSdk = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
require("dotenv").config();

// --- Konfigurasi & Inisialisasi ---
const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

// Sajikan file statis dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

let isRunning = false; // Variabel untuk mengontrol loop
let clientWs = null; // Menyimpan koneksi WebSocket client

// Fungsi untuk mengirim log ke browser
const logToBrowser = (message, level = 'info') => {
    console.log(message); // Juga tampilkan di konsol server
    if (clientWs && clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify({ type: 'log', level, message }));
    }
};

// --- Logika Pi Sender ---
async function getPiWalletAddressFromSeed(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error("Mnemonic tidak valid.");
    }
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const derivationPath = "m/44'/314159'/0'";
    const { key } = ed25519.derivePath(derivationPath, seed.toString('hex'));
    return StellarSdk.Keypair.fromRawEd25519Seed(key);
}

async function runSenderLogic() {
    if (!isRunning) return;

    logToBrowser("🚀 Memulai inisialisasi bot...");
    const mnemonic = process.env.MNEMONIC;
    const recipient = process.env.RECEIVER_ADDRESS;

    if (!mnemonic || !recipient) {
        logToBrowser("❌ Pastikan MNEMONIC dan RECEIVER_ADDRESS sudah diatur di file .env", 'error');
        isRunning = false;
        return;
    }

    try {
        const piServer = new StellarSdk.Server('https://api-mainnet.vercel.app');
        const senderKeypair = await getPiWalletAddressFromSeed(mnemonic);
        const senderPublic = senderKeypair.publicKey();

        logToBrowser(`🔑 Alamat Pengirim: ${senderPublic}`);
        logToBrowser(`🎯 Alamat Penerima: ${recipient}`);
        logToBrowser("✅ Inisialisasi selesai. Memulai loop transaksi...");
        logToBrowser("======================================================");

        // Loop utama
        while (isRunning) {
            try {
                const account = await piServer.loadAccount(senderPublic);
                const piBalance = account.balances.find(b => b.asset_type === 'native');
                const balance = parseFloat(piBalance.balance);

                logToBrowser(`Pi Balance: ${balance}`);

                const amountToSend = balance - 1.01;

                if (amountToSend <= 0) {
                    logToBrowser("⚠️ Saldo tidak cukup. Memeriksa kembali...", 'warn');
                    // Jeda super singkat (0.25 detik) untuk menghindari blokir IP
                    await new Promise(resolve => setTimeout(resolve, 250));
                    continue;
                }

                const formattedAmount = amountToSend.toFixed(7);
                logToBrowser(`➡️  Mengirim: ${formattedAmount} Pi`);

                const tx = new StellarSdk.TransactionBuilder(account, {
                    fee: await piServer.fetchBaseFee(),
                    networkPassphrase: 'Pi Network',
                })
                    .addOperation(StellarSdk.Operation.payment({
                        destination: recipient,
                        asset: StellarSdk.Asset.native(),
                        amount: formattedAmount,
                    }))
                    .setTimeout(30)
                    .build();

                tx.sign(senderKeypair);
                const result = await piServer.submitTransaction(tx);

                logToBrowser(`✅ Transaksi Berhasil! Hash: ${result.hash}`, 'success');
                logToBrowser(`🔗 Link: https://pi-blockchain.net/tx/${result.hash}`);
                logToBrowser("------------------------------------------------------");

            } catch (e) {
                const errorMessage = e.response?.data?.extras?.result_codes?.transaction || e.message || "Error tidak diketahui";
                logToBrowser(`❌ Terjadi Error: ${errorMessage}`, 'error');
                logToBrowser("------------------------------------------------------");
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    } catch (initError) {
        logToBrowser(`❌ Gagal inisialisasi: ${initError.message}`, 'error');
    }

    logToBrowser("🛑 Proses pengiriman dihentikan.");
    if (clientWs) clientWs.send(JSON.stringify({ type: 'status', running: false }));
}


// --- Manajemen Koneksi WebSocket (TETAP SAMA) ---
wss.on('connection', (ws) => {
    logToBrowser('🖥️ Client terhubung ke server.');
    clientWs = ws;
    ws.send(JSON.stringify({ type: 'status', running: isRunning }));
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.command === 'start') {
            if (!isRunning) {
                isRunning = true;
                runSenderLogic();
            }
        } else if (data.command === 'stop') {
            isRunning = false;
        }
    });
    ws.on('close', () => {
        logToBrowser('🔌 Client terputus.');
        clientWs = null;
    });
});

// Jalankan server (TETAP SAMA)
server.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});
