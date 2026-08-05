const mysql = require("mysql2/promise");
const moment = require("moment-timezone");
const axios = require("axios");
require("dotenv").config({ quiet: true });

process.env.TZ = "Asia/Jakarta";
moment.tz.setDefault("Asia/Jakarta");

// Menggunakan Pool agar stabil saat banyak query paralel
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 50,
    queueLimit: 0,
});

const CONFIG = {
    LIMIT_ORDERS: 100,
    LIMIT_ACCOUNTS: 100,
    INTERVAL_MS: 10000,
};

// Fungsi eksekusi follow ke Shopee API menggunakan cookie dari database
async function executeFollow(shopId, cookieJsonString, type_country) {
    try {
        if (!cookieJsonString || cookieJsonString === "") {
            return { success: false, error: "Data cookie di database kosong" };
        }

        const cookies = JSON.parse(cookieJsonString);
        const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        const csrfToken =
            cookies.find((c) => c.name === "csrftoken")?.value || null;

        let domainShopee = "shopee.co.id";
        if (type_country === "MY") {
            domainShopee = "shopee.com.my";
        } else if (type_country === "SG") {
            domainShopee = "shopee.sg";
        }

        const response = await axios({
            method: "post",
            url: `https://${domainShopee}/api/v4/shop/follow`,
            headers: {
                accept: "application/json",
                "accept-language": "en-US,en;q=0.9,id;q=0.8,vi;q=0.7,ru;q=0.6",
                "content-type": "application/json",
                origin: `https://${domainShopee}`,
                referer: `https://${domainShopee}/shop/${shopId}`,
                "user-agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "x-api-source": "rweb",
                "x-csrftoken": csrfToken,
                "x-requested-with": "XMLHttpRequest",
                Cookie: cookieString,
            },
            data: {
                shopid: parseInt(shopId),
            },
            timeout: 10000,
        });

        const body = response.data;
        // Cek sukses sesuai format shopee
        if (body.error === 0 && body.data && body.data.follow_successful === true) {
            return { success: true, body };
        } else {
            return { success: false, body };
        }
    } catch (error) {
        const errorMsg = error.response
            ? JSON.stringify(error.response.data)
            : error.message;
        return { success: false, error: errorMsg };
    }
}

async function processSingleOrder(order) {
    let accounts = [];
    let connection;

    try {
        const isRefill = order.status === "Success";
        const neededCount = isRefill ? order.remains_refill : order.remains;
        const processingCount = Math.min(neededCount, CONFIG.LIMIT_ACCOUNTS);

        if (processingCount <= 0) return;

        // --- TAHAP 1: RESERVASI AKUN (Full DB Mode) ---
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Ambil akun beserta kolom cookie dari database
        let type_country = "ID";
        if (order.service_id == 10) {
            type_country = "MY";
        } else if (order.service_id == 11) {
            type_country = "SG";
        }

        [accounts] = await connection.query(
            `SELECT a.id, a.email, a.cookie FROM akun_shopee a 
       WHERE a.status = 1 
         AND a.type_country = ?
         AND NOT EXISTS (
           SELECT 1 FROM bot_follow_shopee b 
           WHERE b.id_akun_bot = a.id 
             AND b.target = ? 
             AND b.service_id = ?
         )
       ORDER BY a.date_cookie ASC 
       LIMIT ? FOR UPDATE SKIP LOCKED`,
            [type_country, order.shop_id, order.service_id, processingCount],
        );

        if (accounts.length === 0) {
            await connection.rollback();
            connection.release();
            return;
        }

        const accountIds = accounts.map((acc) => acc.id);
        const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");

        // Geser antrean date_cookie
        await connection.query(
            `UPDATE akun_shopee SET date_cookie = ? WHERE id IN (?)`,
            [currentTime, accountIds],
        );

        await connection.commit();
        connection.release();

        // --- TAHAP 2: EKSEKUSI API & COMMIT PER AKUN ---
        console.log(
            `[${moment().format("DD/MM/YY HH:mm:ss")}]  - Order #${order.id}: Memproses ${accounts.length} akun (DB Mode).`,
        );

        for (const acc of accounts) {
            // Langsung eksekusi API menggunakan cookie yang diambil dari tabel
            const followResult = await executeFollow(
                order.shop_id,
                acc.cookie,
                type_country,
            );

            if (followResult.success) {
                let connAcc;
                try {
                    connAcc = await pool.getConnection();
                    await connAcc.beginTransaction();

                    // Simpan history
                    await connAcc.query(
                        `INSERT INTO bot_follow_shopee (id_pembelian_sosmed, id_akun_bot, target, email_akun_bot, terminal, service_id) 
             VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            order.id,
                            acc.id,
                            order.shop_id,
                            acc.email,
                            order.terminal_eksekusi || 0,
                            order.service_id,
                        ],
                    );

                    // Update remains (-1 per akun)
                    const updateOrderQuery = isRefill
                        ? `UPDATE pembelian_sosmed SET remains_refill = remains_refill - 1 WHERE id = ?`
                        : `UPDATE pembelian_sosmed SET remains = remains - 1 WHERE id = ?`;

                    await connAcc.execute(updateOrderQuery, [order.id]);

                    await connAcc.commit();
                    console.log(
                        `      [v] ${acc.email} SUKSES memproses Order #${order.id}`,
                    );
                } catch (dbErr) {
                    if (connAcc) await connAcc.rollback();
                    console.error(`      [*] DB Error for ${acc.email}:`, dbErr.message);
                } finally {
                    if (connAcc) connAcc.release();
                }
            } else {
                // GAGAL FOLLOW -> Update status akun menjadi 2
                console.log(
                    `      [x] ${acc.email} GAGAL: ${followResult.error || JSON.stringify(followResult.body)}`,
                );

                let connFail;
                try {
                    connFail = await pool.getConnection();
                    await connFail.query(
                        `UPDATE akun_shopee SET status = 2 WHERE id = ?`,
                        [acc.id],
                    );
                } catch (failErr) {
                    console.error(
                        `      [!] Gagal update status akun ${acc.email}:`,
                        failErr.message,
                    );
                } finally {
                    if (connFail) connFail.release();
                }
            }
        }
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (e) { }
            connection.release();
        }
        console.error(
            `[${moment().format("DD/MM/YY HH:mm:ss")}]  - Order #${order.id} Global Error:`,
            err.message,
        );
    }
}

async function startProgramProcessing() {
    console.log(
        `[${moment().format("DD/MM/YY HH:mm:ss")}] Memulai program (Full Database Mode)...`,
    );

    while (true) {
        try {
            const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");

            //new country
            const [orders] = await pool.query(
                `SELECT * FROM pembelian_sosmed 
         WHERE service_id IN (1, 10, 11)
         AND (
           (status = 'Processing' AND remains > 0 AND date_created < ?) 
           OR 
           (status = 'Success' AND refill = 1 AND remains_refill > 0)
         ) 
         GROUP BY shop_id
         LIMIT ?`,
                [currentTime, CONFIG.LIMIT_ORDERS],
            );

            if (orders.length === 0) {
                console.log(
                    `[${moment().format("DD/MM/YY HH:mm:ss")}] Tidak ada pesanan. Menunggu 10 detik...`,
                );
                await new Promise((resolve) => setTimeout(resolve, CONFIG.INTERVAL_MS));
                continue;
            }

            console.log(
                `[${moment().format("DD/MM/YY HH:mm:ss")}] Mengeksekusi ${orders.length} pesanan secara paralel...`,
            );

            // Jalankan semua pesanan paralel
            await Promise.all(orders.map((order) => processSingleOrder(order)));
        } catch (err) {
            console.error(
                `[${moment().format("DD/MM/YY HH:mm:ss")}] Global Loop Error:`,
                err.message,
            );
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
}

startProgramProcessing();
