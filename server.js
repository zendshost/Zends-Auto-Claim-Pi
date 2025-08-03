const express = require('express');
const http = require('http');
const path = require('path');
const { Server: WebSocketServer } = require('ws');
const StellarSdk = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
require("dotenv").config();

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

let isRunning = false;
let currentConfig = {};
let clientWs = null;

const logToBrowser = (message, level = 'info') => {
    console.log(message);
    if (clientWs && clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify({ type: 'log', level, message }));
    }
};

async function getKeypairFromMnemonic(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error("Mnemonic tidak valid.");
    }
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const derivationPath = "m/44'/314159'/0'";
    const { key } = ed25519.derivePath(derivationPath, seed.toString('hex'));
    return StellarSdk.Keypair.fromRawEd25519Seed(key);
}

// --- LOGIKA SPAMMER UTAMA ---
async function runSpammer(config) {
    if (!isRunning) return;

    logToBrowser("🚀 Memulai proses spam paralel...");
    try {
        const piServer = new StellarSdk.Server('https://apimainnet.vercel.app');
        
        // 1. Siapkan semua keypair
        const senderKeypair = await getKeypairFromMnemonic(config.senderMnemonic);
        const useFeePayer = config.feePayerMnemonic && config.feePayerMnemonic.length > 0;
        let feePayerKeypair = null;
        if (useFeePayer) {
            feePayerKeypair = await getKeypairFromMnemonic(config.feePayerMnemonic);
            logToBrowser(`🔑 Wallet Pengirim: ${senderKeypair.publicKey()}`);
            logToBrowser(`💰 Wallet Pembayar Fee: ${feePayerKeypair.publicKey()}`);
        } else {
            logToBrowser(`🔑 Wallet Pengirim (juga membayar fee): ${senderKeypair.publicKey()}`);
        }
        logToBrowser(`🎯 Alamat Penerima: ${config.recipientAddress}`);
        logToBrowser(`⚡ Mode Spam: ${config.parallelRequests} request/batch`);
        logToBrowser(`💸 Jumlah per TX: ${config.amountPerTx} Pi`);
        logToBrowser("======================================================");

        // 2. Loop utama untuk setiap batch spam
        while (isRunning) {
            try {
                // Ambil base fee SEKALI per batch untuk efisiensi
                const baseFee = await piServer.fetchBaseFee();
                
                // Ambil status akun terbaru SEKALI per batch
                const senderAccount = await piServer.loadAccount(senderKeypair.publicKey());
                let feePayerAccount = null;
                if (useFeePayer) {
                    feePayerAccount = await piServer.loadAccount(feePayerKeypair.publicKey());
                }

                logToBrowser(`--- Memulai Batch Baru | Saldo Pengirim: ${senderAccount.balances[0].balance} Pi ---`);

                const promises = [];
                for (let i = 0; i < config.parallelRequests; i++) {
                    const txPromise = buildAndSubmitTx({
                        piServer,
                        senderKeypair,
                        feePayerKeypair,
                        senderAccount,
                        feePayerAccount,
                        recipient: config.recipientAddress,
                        amount: config.amountPerTx,
                        baseFee: baseFee,
                        sequenceIndex: i, // Untuk increment sequence number
                        txId: i + 1
                    });
                    promises.push(txPromise);
                }

                // Tunggu semua transaksi dalam batch selesai
                await Promise.allSettled(promises);
                logToBrowser(`--- Batch Selesai. Menyiapkan batch berikutnya... ---`);
                
            } catch (e) {
                logToBrowser(`❌ Error Kritis di dalam loop batch: ${e.message}`, 'error');
                await new Promise(resolve => setTimeout(resolve, 3000)); // Jeda jika ada error besar
            }
        }
    } catch (initError) {
        logToBrowser(`❌ Gagal Inisialisasi: ${initError.message}`, 'error');
    }

    logToBrowser("🛑 Proses spam dihentikan.");
    if (clientWs) clientWs.send(JSON.stringify({ type: 'status', running: false }));
    isRunning = false;
}

async function buildAndSubmitTx({piServer, senderKeypair, feePayerKeypair, senderAccount, feePayerAccount, recipient, amount, baseFee, sequenceIndex, txId}) {
    try {
        // PENTING: Kalkulasi sequence number secara manual untuk setiap transaksi paralel
        const txSequence = (BigInt(senderAccount.sequence) + BigInt(sequenceIndex) + 1n).toString();

        const transaction = new StellarSdk.TransactionBuilder(
                // Akun sumber transaksi (yang sequence-nya dipakai)
                new StellarSdk.Account(senderAccount.id, txSequence), {
                    fee: baseFee, // Fee akan di-override oleh FeeBump jika ada
                    networkPassphrase: 'Pi Network',
                })
            .addOperation(StellarSdk.Operation.payment({
                destination: recipient,
                asset: StellarSdk.Asset.native(),
                amount: amount,
            }))
            .setTimeout(30)
            .build();

        // Tandatangani oleh pengirim
        transaction.sign(senderKeypair);

        let txToSubmit = transaction;

        // Jika ada wallet fee, bungkus dengan FeeBumpTransaction
        if (feePayerKeypair && feePayerAccount) {
            const feePayerSequence = (BigInt(feePayerAccount.sequence) + BigInt(sequenceIndex) + 1n).toString();
            const feePayerForBump = new StellarSdk.Account(feePayerAccount.id, feePayerSequence);

            txToSubmit = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
                feePayerKeypair.publicKey(), // Akun yang bayar fee
                (parseInt(baseFee) * 2).toString(), // Fee untuk fee-bump (biasanya 2x lipat)
                transaction, // Transaksi yang dibungkus
                'Pi Network',
                feePayerForBump
            );
            txToSubmit.sign(feePayerKeypair);
        }
        
        // Kirim transaksi ke jaringan
        const result = await piServer.submitTransaction(txToSubmit);
        logToBrowser(`[TX ${txId}] ✅ Berhasil! Hash: ${result.hash.substring(0, 15)}...`, 'success');

    } catch (e) {
        const errorMessage = e.response?.data?.extras?.result_codes?.transaction || e.message || "Error tidak diketahui";
        logToBrowser(`[TX ${txId}] ❌ Gagal: ${errorMessage}`, 'error');
    }
}


// --- Manajemen Koneksi ---
wss.on('connection', (ws) => {
    logToBrowser('🖥️ Client terhubung.');
    clientWs = ws;
    ws.send(JSON.stringify({ type: 'status', running: isRunning }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.command === 'start') {
                if (!isRunning) {
                    isRunning = true;
                    currentConfig = data.config;
                    runSpammer(currentConfig); // Jalankan dengan config dari UI
                }
            } else if (data.command === 'stop') {
                isRunning = false;
            }
        } catch (e) {
            logToBrowser(`Error memproses pesan client: ${e.message}`, 'error');
        }
    });

    ws.on('close', () => {
        logToBrowser('🔌 Client terputus.');
        if (clientWs === ws) clientWs = null;
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});
