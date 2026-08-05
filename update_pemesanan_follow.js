const { chromium } = require("playwright");
const mysql = require("mysql2/promise");
const moment = require("moment-timezone");
require("dotenv").config({ quiet: true });
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

//puppeteer.use(StealthPlugin());

process.env.TZ = "Asia/Jakarta";

moment.tz.setDefault("Asia/Jakarta");

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

function clearChromeHistory(profilePath) {
    const filesToDelete = [
        "History",
        "History-journal",
        "Visited Links",
        "Visited Links-journal",
    ];

    for (const file of filesToDelete) {
        const filePath = path.join(profilePath, file);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.log(`Gagal hapus ${filePath}`);
            }
        }
    }
}

function extractUsername(order) {
    let target = order.target;

    if (!target) return "";

    // 1. Ubah ke lowercase untuk pengecekan domain agar lebih aman
    const lowerTarget = target.toLowerCase();

    // Shortlink tidak memiliki username di URL
    //new country
    if (order.service_id == 1) {
        if (
            lowerTarget.includes("s.shopee.co.id") ||
            lowerTarget.includes("id.shp.ee")
        ) {
            return "$andi2026andi$";
        }

        if (lowerTarget.includes("shopee.co.id/")) {
            const match = target.match(/shopee\.co\.id\/([^/?]+)/i);
            return match ? match[1] : "";
        }
    } else if (order.service_id == 10) {
        if (
            lowerTarget.includes("s.shopee.com.my") ||
            lowerTarget.includes("my.shp.ee")
        ) {
            return "$andi2026andi$";
        }

        if (lowerTarget.includes("shopee.com.my/")) {
            const match = target.match(/shopee\.com\.my\/([^/?]+)/i);
            return match ? match[1] : "";
        }
    } else if (order.service_id == 11) {
        if (
            lowerTarget.includes("s.shopee.sg") ||
            lowerTarget.includes("sg.shp.ee")
        ) {
            return "$andi2026andi$";
        }

        if (lowerTarget.includes("shopee.sg/")) {
            const match = target.match(/shopee\.sg\/([^/?]+)/i);
            return match ? match[1] : "";
        }
    }

    // Jika mengandung http/www tapi bukan shopee.co.id standard, anggap tidak valid
    if (lowerTarget.includes("http") || lowerTarget.includes("www.")) {
        return "";
    }

    // Jika sudah berupa username
    return target.split(/[/?]/)[0];
}

async function getShopInfo(username, order) {
    let browser;
    try {
        // clearChromeHistory("Profile 16"); // Disabled as path is likely different on server

        browser = await puppeteer.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--start-maximized",
            ],
            defaultViewport: null,
        });

        // ⚠️ JANGAN newPage() sembarangan
        const pages = await browser.pages();
        const page = pages.find((p) => p.url() !== "about:blank") || pages[0];

        let printed = false;
        let shopInfo = null;

        page.on("response", async (response) => {
            if (printed) return;

            const url_response = response.url();

            if (url_response.includes("/api/v4/search/search_user")) {
                try {
                    const data = await response.json();
                    const users = data?.data?.users || [];

                    if (users.length > 0) {
                        const matchedUser = users.find(
                            (user) => user.username === username,
                        );
                        if (matchedUser && matchedUser.follower_count !== undefined) {
                            printed = true;

                            shopInfo = {
                                status: "success",
                                shopid: matchedUser.shopid,
                                follower_count: matchedUser.follower_count,
                                shop: true,
                            };
                        }
                    }
                } catch (err) {
                    // response bukan JSON, abaikan
                }
            }
        });

        //new country
        let baseUrl = "";
        if (order.service_id == 1) {
            baseUrl = "https://shopee.co.id";
        } else if (order.service_id == 10) {
            baseUrl = "https://shopee.com.my";
        } else if (order.service_id == 11) {
            baseUrl = "https://shopee.sg";
        }

        const url = `${baseUrl}/search_user?keyword=${encodeURIComponent(
            username,
        )}`;

        await page.goto(url, { waitUntil: "networkidle2" });

        await new Promise((resolve) => setTimeout(resolve, 5000));

        return shopInfo;
    } catch (error) {
        console.error(`Error getShopInfo for ${username}:`, error.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

async function getShopInfoDepan(username, order) {
    let url_target = order.target;
    let browser;
    try {
        // clearChromeHistory("Profile 16"); // Disabled

        browser = await puppeteer.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--start-maximized",
            ],
            defaultViewport: null,
        });

        // ⚠️ JANGAN newPage() sembarangan
        const pages = await browser.pages();
        const page = pages.find((p) => p.url() !== "about:blank") || pages[0];

        await page.setCacheEnabled(false);

        const client = await page.target().createCDPSession();
        await client.send("Network.enable");
        await client.send("Network.clearBrowserCache");
        await client.send("Network.setCacheDisabled", { cacheDisabled: true });

        let printed = false;
        let shopInfo = null;

        page.on("response", async (response) => {
            if (printed) return;

            const url_response = response.url();
            // console.log(url_response)
            if (url_response.includes("/api/v4/shop/get_shop_base_v2")) {
                try {
                    const data = await response.json();
                    if (data?.data && data.data.follower_count !== undefined) {
                        printed = true;
                        shopInfo = {
                            status: "success",
                            shopid: data.data.shopid,
                            follower_count: data.data.follower_count,
                            shop: data.data.account?.is_seller === true,
                        };
                    }
                } catch (err) {
                    // Ignore
                }
            }
        });

        let url;
        if (username == "$andi2026andi$") {
            url = url_target;
        } else {
            //new country
            let baseUrl = "";
            if (order.service_id == 1) {
                baseUrl = "https://shopee.co.id";
            } else if (order.service_id == 10) {
                baseUrl = "https://shopee.com.my";
            } else if (order.service_id == 11) {
                baseUrl = "https://shopee.sg";
            }

            url = `${baseUrl}/${username}`;
        }

        await page.goto(url, { waitUntil: "networkidle2" });

        await client.send("Page.reload", { ignoreCache: true });

        await new Promise((resolve) => setTimeout(resolve, 5000));

        console.log("shopInfoDepan", shopInfo);

        return shopInfo;
    } catch (error) {
        console.error(`Error getShopInfoDepan for ${username}:`, error.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

async function startProgramPending() {
    console.log(
        `[${moment().format("DD/MM/YY HH:mm:ss")}] Memulai program pending...`,
    );

    while (true) {
        // Delete akun_shopee status 2 yang tidak terpakai
        try {
            const oneDaysAgo = moment()
                .subtract(1, "days")
                .format("YYYY-MM-DD HH:mm:ss");

            const threeDaysAgo = moment()
                .subtract(3, "days")
                .format("YYYY-MM-DD HH:mm:ss");

            // 1. Chunking hapus akun_shopee by ID mapping
            let totalDeletedAkun = 0;
            let hasMoreAkun = true;

            while (hasMoreAkun) {
                // Ambil ID terelebih dahulu untuk mencegah dead lock range index
                const [oldAkunRows] = await pool.query(
                    "SELECT id FROM akun_shopee WHERE status = 2 AND date_updated < ? LIMIT 500",
                    [oneDaysAgo],
                );

                if (oldAkunRows.length === 0) {
                    hasMoreAkun = false;
                } else {
                    const idsToDelete = oldAkunRows.map((row) => row.id);
                    const [delResult] = await pool.query(
                        "DELETE FROM akun_shopee WHERE id IN (?)",
                        [idsToDelete],
                    );

                    totalDeletedAkun += delResult.affectedRows;
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }

            console.log("[CLEANUP] Total akun dihapus :", totalDeletedAkun);

            if (totalDeletedAkun > 0) {
                console.log(
                    `[CLEANUP] Berhasil menghapus ${totalDeletedAkun} akun status 2 (sebelum ${oneDaysAgo})`,
                );
            }

            // 2. Chunking hapus bot_follow_shopee by ID mapping
            let totalDeletedHistory = 0;
            let hasMoreHistory = true;

            while (hasMoreHistory) {
                // Ambil ID terelebih dahulu
                const [oldHistoryRows] = await pool.query(
                    "SELECT id FROM bot_follow_shopee WHERE date_created < ? LIMIT 1000",
                    [threeDaysAgo],
                );

                if (oldHistoryRows.length === 0) {
                    hasMoreHistory = false;
                } else {
                    const idHistsToDel = oldHistoryRows.map((row) => row.id);
                    const [delHistory] = await pool.query(
                        "DELETE FROM bot_follow_shopee WHERE id IN (?)",
                        [idHistsToDel],
                    );

                    totalDeletedHistory += delHistory.affectedRows;
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }

            if (totalDeletedHistory > 0) {
                console.log(
                    `[CLEANUP] Berhasil menghapus ${totalDeletedHistory} bot_follow_shopee yang lebih lama dari 3 hari (sebelum ${threeDaysAgo})`,
                );
            }
        } catch (err) {
            console.error("[CLEANUP ERROR]", err.message);
        }

        try {
            //new country
            const query = `
        SELECT * FROM pembelian_sosmed
        WHERE service_id IN (1, 10, 11)
        AND (
          (status = 'Pending' AND cek_error < 3)
          OR (status = 'Processing' AND remains = 0)
          OR (refill = 1 AND remains_refill = 0)
        )
        ORDER BY id ASC
      `;

            const [results] = await pool.query(query);

            if (results.length > 0) {
                console.log(
                    `[${moment().format("HH:mm:ss")}] Yes data: ${results.length} records ditemukan.`,
                );

                for (const row of results) {
                    //new country
                    if (row.service_id == 1) {
                        if (
                            row.target &&
                            (row.target.includes("http") || row.target.includes("www.")) &&
                            !row.target.toLowerCase().includes("shopee.co.id") &&
                            !row.target.toLowerCase().includes("s.shopee.co.id") &&
                            !row.target.toLowerCase().includes("id.shp.ee")
                        ) {
                            console.log(
                                `   [FAIL] ID: ${row.id} - Link bukan shopee.co.id (${row.target}). Menandai sebagai Error.`,
                            );
                            try {
                                await pool.query(
                                    "UPDATE pembelian_sosmed SET status = ?, date_done = ?, harga_fix = 0, date_updated = NULL WHERE id = ?",
                                    ["Error", moment().format("YYYY-MM-DD HH:mm:ss"), row.id],
                                );
                            } catch (dbErr) {
                                console.error(
                                    `   [ERROR DB] Gagal update status Error untuk ID ${row.id}:`,
                                    dbErr.message,
                                );
                            }
                            continue;
                        }
                    } else if (row.service_id == 10) {
                        if (
                            row.target &&
                            (row.target.includes("http") || row.target.includes("www.")) &&
                            !row.target.toLowerCase().includes("shopee.com.my") &&
                            !row.target.toLowerCase().includes("s.shopee.com.my") &&
                            !row.target.toLowerCase().includes("my.shp.ee")
                        ) {
                            console.log(
                                `   [FAIL] ID: ${row.id} - Link bukan shopee.com.my (${row.target}). Menandai sebagai Error.`,
                            );
                            try {
                                await pool.query(
                                    "UPDATE pembelian_sosmed SET status = ?, date_done = ?, harga_fix = 0, date_updated = NULL WHERE id = ?",
                                    ["Error", moment().format("YYYY-MM-DD HH:mm:ss"), row.id],
                                );
                            } catch (dbErr) {
                                console.error(
                                    `   [ERROR DB] Gagal update status Error untuk ID ${row.id}:`,
                                    dbErr.message,
                                );
                            }
                            continue;
                        }
                    } else if (row.service_id == 11) {
                        if (
                            row.target &&
                            (row.target.includes("http") || row.target.includes("www.")) &&
                            !row.target.toLowerCase().includes("shopee.sg") &&
                            !row.target.toLowerCase().includes("s.shopee.sg") &&
                            !row.target.toLowerCase().includes("sg.shp.ee")
                        ) {
                            console.log(
                                `   [FAIL] ID: ${row.id} - Link bukan shopee.sg (${row.target}). Menandai sebagai Error.`,
                            );
                            try {
                                await pool.query(
                                    "UPDATE pembelian_sosmed SET status = ?, date_done = ?, harga_fix = 0, date_updated = NULL WHERE id = ?",
                                    ["Error", moment().format("YYYY-MM-DD HH:mm:ss"), row.id],
                                );
                            } catch (dbErr) {
                                console.error(
                                    `   [ERROR DB] Gagal update status Error untuk ID ${row.id}:`,
                                    dbErr.message,
                                );
                            }
                            continue;
                        }
                    }

                    if (
                        row.status === "Processing" &&
                        row.link_start_count === "salah" &&
                        !row.date_updated
                    ) {
                        try {
                            await pool.query(
                                "UPDATE pembelian_sosmed SET date_updated = NOW() WHERE id = ?",
                                [row.id],
                            );
                        } catch (dbErr) {
                            console.error(
                                `   [ERROR DB] Gagal update date_updated untuk ID ${row.id}:`,
                                dbErr.message,
                            );
                        }
                        continue;
                    }

                    if (
                        row.status === "Processing" &&
                        row.link_start_count === "salah" &&
                        row.date_updated
                    ) {
                        const diffMinutes = moment().diff(
                            moment(row.date_updated),
                            "minutes",
                        );
                        if (diffMinutes < 15) {
                            continue;
                        }
                    }

                    const username = extractUsername(row);
                    console.log(`Processing ID: ${row.id} - Username: ${username}`);

                    let value_get_shop = 1;
                    let info = null;

                    if (value_get_shop != 1) {
                        info = await getShopInfo(username, row);
                        if (!info || info.status !== "success") {
                            if (row.date_updated) {
                                const diffMinutes = moment().diff(
                                    moment(row.date_updated),
                                    "minutes",
                                );
                                if (diffMinutes < 15) {
                                    continue;
                                }
                            }

                            console.log(
                                "Gagal mendapatkan info dari getShopInfo, mencoba getShopInfoDepan",
                            );
                            info = await getShopInfoDepan(username, row);
                            value_get_shop = 2;
                        }
                    }

                    info = await getShopInfoDepan(username, row);
                    value_get_shop = 2;

                    if (value_get_shop === 2 && !row.date_updated) {
                        try {
                            await pool.query(
                                "UPDATE pembelian_sosmed SET date_updated = NOW() WHERE id = ?",
                                [row.id],
                            );
                        } catch (dbErr) {
                            console.error(
                                `   [ERROR DB] Gagal update date_updated untuk ID ${row.id}:`,
                                dbErr.message,
                            );
                        }
                        continue;
                    }

                    if (info && info.status === "success") {
                        console.log(
                            `   [OK] ShopID: ${info.shopid}, Followers: ${info.follower_count}`,
                        );

                        try {
                            let updateQuery = "";
                            let updateParams = [];

                            if (row.status === "Pending") {
                                // Jika masih Pending, update shop_id, start_count, dan pindah ke Processing
                                // Khusus jika status awalnya pending saja
                                const linkStartCountStatus =
                                    info.shop === true ? "benar" : "salah";

                                updateQuery = `
                  UPDATE pembelian_sosmed
                  SET shop_id = ?, start_count = ?, status = ?, link_start_count = ?, date_updated = NULL
                  WHERE id = ?
                `;
                                updateParams = [
                                    info.shopid,
                                    info.follower_count,
                                    "Processing",
                                    linkStartCountStatus,
                                    row.id,
                                ];
                            } else if (
                                (row.status === "Processing" && row.remains === 0) ||
                                (row.refill === 1 && row.remains_refill === 0)
                            ) {
                                const targetCount = row.start_count + row.jumlah;

                                let sisa =
                                    parseInt(targetCount) - parseInt(info.follower_count);

                                console.log("Sisa : ", sisa);
                                console.log("Total Target :", parseInt(targetCount));
                                console.log(
                                    "FOllower Sekarang : ",
                                    parseInt(info.follower_count),
                                );

                                //paksa dia auto success
                                sisa = 0;

                                if (sisa <= 0) {
                                    updateQuery = `
                    UPDATE pembelian_sosmed
                    SET status = ?, date_done = ?, remains = 0, remains_refill = 0, refill = 0, date_updated = NULL
                    WHERE id = ?
                  `;
                                    updateParams = [
                                        "Success",
                                        moment().format("YYYY-MM-DD HH:mm:ss"),
                                        row.id,
                                    ];
                                } else {
                                    if (row.refill === 1) {
                                        updateQuery = `UPDATE pembelian_sosmed SET remains_refill = ?, date_updated = NULL WHERE id = ?`;
                                        updateParams = [sisa, row.id];
                                    } else {
                                        updateQuery = `UPDATE pembelian_sosmed SET remains = ?, date_updated = NULL WHERE id = ?`;
                                        updateParams = [sisa, row.id];
                                    }
                                }
                            }

                            if (updateQuery !== "") {
                                await pool.query(updateQuery, updateParams);
                                console.log(
                                    `   [UPDATED] Berhasil update database untuk ID: ${row.id}`,
                                );
                            }
                        } catch (dbErr) {
                            console.error(
                                `   [ERROR DB] Gagal update ID ${row.id}:`,
                                dbErr.message,
                            );
                        }
                    } else if (info && info.status === "error") {
                        if (row.status === "Pending") {
                            const currentErrorCount = row.cek_error + 1;
                            if (currentErrorCount >= 3) {
                                console.log(
                                    `   [FAIL] ID: ${row.id} - Gagal mendapatkan info toko untuk ${username} (Percobaan ke-${currentErrorCount}). Menandai sebagai Error.`,
                                );
                                try {
                                    const errorQuery = `
                  UPDATE pembelian_sosmed
                  SET status = ?, date_done = ?, harga_fix = 0, cek_error = ?, date_updated = NULL
                  WHERE id = ?
                `;
                                    await pool.query(errorQuery, [
                                        "Error",
                                        moment().format("YYYY-MM-DD HH:mm:ss"),
                                        currentErrorCount,
                                        row.id,
                                    ]);
                                    console.log(
                                        `   [UPDATED] ID: ${row.id} telah diset ke Error.`,
                                    );
                                } catch (dbErr) {
                                    console.error(
                                        `   [ERROR DB] Gagal mengeset Error untuk ID ${row.id}:`,
                                        dbErr.message,
                                    );
                                }
                            } else {
                                console.log(
                                    `   [RETRY-API] ID: ${row.id} - API Error untuk ${username}. Increment cek_error ke-${currentErrorCount}.`,
                                );
                                try {
                                    await pool.query(
                                        "UPDATE pembelian_sosmed SET cek_error = ? WHERE id = ?",
                                        [currentErrorCount, row.id],
                                    );
                                } catch (dbErr) {
                                    console.error(
                                        `   [ERROR DB] Gagal update cek_error untuk ID ${row.id}:`,
                                        dbErr.message,
                                    );
                                }
                            }
                        }
                    } else {
                        const currentErrorCount = row.cek_error + 1;
                        console.log(
                            `   [RETRY-TIMEOUT] ID: ${row.id} - Gagal mendapatkan respon untuk ${username}. Increment cek_error ke-${currentErrorCount}.`,
                        );
                        try {
                            await pool.query(
                                "UPDATE pembelian_sosmed SET cek_error = ? WHERE id = ?",
                                [currentErrorCount, row.id],
                            );
                        } catch (dbErr) {
                            console.error(
                                `   [ERROR DB] Gagal update cek_error untuk ID ${row.id}:`,
                                dbErr.message,
                            );
                        }

                        if (row.status === "Pending") {
                            if (currentErrorCount >= 3) {
                                console.log(
                                    `   [FAIL] ID: ${row.id} - Gagal mendapatkan info toko untuk ${username} (Percobaan ke-${currentErrorCount}). Menandai sebagai Error.`,
                                );

                                try {
                                    const errorQuery = `
                  UPDATE pembelian_sosmed
                  SET status = ?, date_done = ?, harga_fix = 0, cek_error = ?, date_updated = NULL
                  WHERE id = ?
                `;
                                    await pool.query(errorQuery, [
                                        "Error",
                                        moment().format("YYYY-MM-DD HH:mm:ss"),
                                        currentErrorCount,
                                        row.id,
                                    ]);
                                    console.log(
                                        `   [UPDATED] ID: ${row.id} telah diset ke Error.`,
                                    );
                                } catch (dbErr) {
                                    console.error(
                                        `   [ERROR DB] Gagal mengeset Error untuk ID ${row.id}:`,
                                        dbErr.message,
                                    );
                                }
                            }
                        }
                    }
                }
            } else {
                console.log(`[${moment().format("HH:mm:ss")}] No data pending.`);
            }

            // Tunggu 5 detik sebelum iterasi berikutnya
            await new Promise((resolve) => setTimeout(resolve, 5000));
        } catch (err) {
            console.error(
                `[${moment().format("HH:mm:ss")}] Global Loop Error:`,
                err.message,
            );
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
}

startProgramPending();
