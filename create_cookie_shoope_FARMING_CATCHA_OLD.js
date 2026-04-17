const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const request = require("request");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const moment = require("moment-timezone");
require("dotenv").config({ quiet: true });

puppeteer.use(StealthPlugin());

moment.tz.setDefault("Asia/Jakarta");

const WORKER_ID = process.argv[2] ? parseInt(process.argv[2], 10) : 0;
const TOTAL_WORKER = process.argv[3] ? parseInt(process.argv[3], 10) : 1;

console.log(`🧠 Worker ${WORKER_ID + 1}/${TOTAL_WORKER}`);

// ================= CONFIG =================
const COOKIE_DIR = path.resolve(__dirname, "cookie");

let TYPE_COOKIE = process.env.TYPE_COOKIE || "ID";
let BASE_URL = "https://shopee.co.id";
let SHOPEE_LANG = "id";

if (TYPE_COOKIE === "MY") {
  BASE_URL = "https://shopee.com.my";
  SHOPEE_LANG = "en";
} else if (TYPE_COOKIE === "SG") {
  BASE_URL = "https://shopee.sg";
  SHOPEE_LANG = "en";
}

let LOGIN_URL = `${BASE_URL}/buyer/login`;

// EDGE ASLI
const EDGE_PATH =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

// ================= UTIL =================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR);

// ================= DATABASE =================
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 50,
  queueLimit: 0,
});

async function updateProfile(account, cookies) {
  const generatePhotoId = account.url_photo;
  const firstName = account.nama_depan;
  const lastName = account.nama_belakang;
  const nickname = `${firstName} ${lastName}`.trim();

  if (!generatePhotoId) {
    console.log("Update Profile Skip: url_photo kosong");
    return false;
  }

  console.log(`\n🟡 Start Update Profile: ${account.email}`);

  const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const csrfToken = cookies.find((c) => c.name === "csrftoken")?.value || "";

  const options = {
    method: "POST",
    url: `${BASE_URL}/api/v4/account/update_profile`,
    headers: {
      accept: "application/json",
      "accept-language": "en-GB,en;q=0.9",
      "content-type": "application/json",
      origin: BASE_URL,
      referer: `${BASE_URL}/user/account/profile`,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      "x-api-source": "pc",
      "x-csrftoken": csrfToken,
      "x-requested-with": "XMLHttpRequest",
      Cookie: cookieString,
      "x-shopee-language": SHOPEE_LANG,
      "x-sz-sdk-version": "1.12.27",
    },
    body: JSON.stringify({
      portrait: generatePhotoId,
      nickname: nickname,
    }),
  };

  return new Promise((resolve) => {
    // Tambahkan 'async' di depan (error, response) agar bisa pakai await di dalamnya
    request(options, async (error, response) => {
      if (error) {
        console.log("❌ REQUEST ERROR Update Profile:", error.message);
        return resolve(false);
      }

      try {
        const body = JSON.parse(response.body);
        if (response.statusCode === 200 && body.error === 0) {
          console.log("✅ UPDATE PROFILE SUCCESS");
          resolve(true);
        } else {
          // --- DI SINI PERBAIKANNYA ---
          console.log("❌ API ERROR Update Profile:", response.body);
          console.log(
            "⏳ Menahan browser selama 30 detik untuk inspeksi sebelum ditutup...",
          );

          //await delay(30000);

          console.log("✅ Waktu tunggu selesai, melepaskan browser...");
          resolve(false);
          // ----------------------------
        }
      } catch (e) {
        console.log("❌ JSON PARSE ERROR Update Profile");
        resolve(false);
      }
    });
  });
}

// ================= LOGIN SHOPEE =================
async function loginShopee(email, password, id_akun, id_worker, lang) {
  console.log(`\n🚀 [WORKER ${id_worker}] Login : ${email} dengan ID ${id_akun}`);

  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, "_");
  const timestamp = Date.now().toString();
  const workerProfilePath = path.join(
    __dirname,
    "profile_edge",
    id_worker.toString(),
  );

  if (fs.existsSync(workerProfilePath)) {
    try {
      fs.rmSync(workerProfilePath, { recursive: true, force: true });
    } catch (e) {
      console.log(
        `⚠️ Gagal menghapus folder profil lama (biasanya karena EBUSY), skip:`,
        e.message,
      );
    }
  }

  const uniqueProfilePath = path.join(workerProfilePath, safeEmail, timestamp);

  if (!fs.existsSync(uniqueProfilePath)) {
    fs.mkdirSync(uniqueProfilePath, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: EDGE_PATH,
    userDataDir: uniqueProfilePath,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      // HAPUS "--start-maximized", ganti dengan koordinat gaib:
      "--window-position=-2000,0",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-focus-on-start",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--no-first-run",
      "--wm-window-animations-disabled",
      "--window-size=720,2000",
      "--disable-gpu",
      //"--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/145.0.3800.97",
      `--user-data-dir=${uniqueProfilePath}`,
    ],
  });

  console.log("✅ Browser terbuka");

  const page = (await browser.pages())[0];

  // --- [REVISI 1: PURE CDP STEALTH FINGERPRINT] ---
  // Ini dijalankan SEBELUM navigasi ke URL manapun
  const mainSession = await page.target().createCDPSession();

  await mainSession.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
        // Hapus jejak automation
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        
        // Tambahkan identitas chrome agar terlihat seperti user asli
        window.chrome = { runtime: {} };
        
        // Set bahasa agar konsisten dengan settingan browser asli
        Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US', 'en'] });
        
        // Mocking hardware concurrency agar tidak terlihat seperti headless default
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    `,
  });

  let loginStatus = { success: false, cookies: null, banned: false };

  // Simpan status posisi di level worker agar tidak panggil CDP terus-menerus
  let isAlreadyOnScreen = false;

  const moveBrowser = async (state) => {
    try {
      const session = await page.target().createCDPSession();
      const { windowId } = await session.send("Browser.getWindowForTarget");

      if (state === "hide") {
        isAlreadyOnScreen = false;
        await session.send("Browser.setWindowBounds", {
          windowId: windowId,
          bounds: {
            windowState: "normal",
            left: -2000, // Dilempar ke luar layar
            top: 0,
          },
        });
      } else {
        // console.log(
        //   `[WORKER ${WORKER_ID}] Menarik browser kembali ke layar...`,
        // );

        await session.send("Browser.setWindowBounds", {
          windowId: windowId,
          bounds: {
            windowState: "normal",
            left: 1100, // WAJIB ADA: Narik dari -2000 ke 0 agar terlihat lagi
            top: 0,
            width: 720,
            height: 720,
          },
        });

        isAlreadyOnScreen = true;
      }
      await session.detach();
    } catch (e) {
      console.error("Gagal gerakin browser:", e.message);
    }
  };

  // --- [REVISI 3: PENANDA WORKER (Tetap Gunakan evaluateOnNewDocument)] ---
  // Ini satu-satunya bagian yang oke pakai evaluateOnNewDocument karena fungsinya visual
  // --- [REVISI 3: PENANDA WORKER (Sinkron dengan Terminal 0)] ---
  await page.evaluateOnNewDocument((wid) => {
    setInterval(() => {
      const prefix = `[WORKER ${wid}]`;
      if (!document.title.startsWith(prefix)) {
        // Menggunakan template literal standar untuk mengganti judul
        document.title =
          prefix + " - " + document.title.replace(/^\[WORKER \d+\] - /, "");
      }
    }, 1000);
  }, WORKER_ID);

  try {
    await page.goto(LOGIN_URL, {
      waitUntil: "networkidle2",
    });

    // ---------- POPUP BAHASA (PURE CDP - SELECTOR PRESISI) ----------
    let bahasaClicked = false;
    const startBahasa = Date.now();

    // Sesi CDP untuk halaman utama
    const clientB = await page.target().createCDPSession();

    try {
      console.log("🔍 Mencari Popup Bahasa via Selector Presisi...");

      while (Date.now() - startBahasa < 8000) {
        // 1. Ambil Root Document
        const { root } = await clientB.send("DOM.getDocument", { depth: -1 });

        // 2. Cari Node ID menggunakan selector spesifik kamu
        const { nodeId } = await clientB.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector:
            "#modal > div.SqO999 > div.UsynuF > div > div.S9b8DU > div:nth-child(1) > button",
        });

        if (nodeId) {
          // 3. Ambil koordinat tombol dari layout engine browser
          const { model } = await clientB.send("DOM.getBoxModel", { nodeId });
          const startX = (model.content[0] + model.content[2]) / 2;
          const startY = (model.content[1] + model.content[5]) / 2;

          console.log(
            `🚀 Tombol Bahasa ditemukan! Koordinat: ${Math.round(startX)}, ${Math.round(startY)}`,
          );

          // 4. SIMULASI GERAKAN MOUSE (JITTER) - Agar terdeteksi sebagai Manusia
          // Manusia akan menggerakkan kursor mendekati tombol, tidak langsung klik.
          for (let i = 0; i < 6; i++) {
            await clientB.send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: startX + (Math.random() * 8 - 4), // Goyang kiri-kanan 4 pixel
              y: startY + (Math.random() * 8 - 4), // Goyang atas-bawah 4 pixel
            });
            await delay(20 + Math.random() * 20);
          }

          // 5. EKSEKUSI KLIK HARDWARE (Pressed -> Tahan -> Released)
          await clientB.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: startX,
            y: startY,
            button: "left",
            clickCount: 1,
          });

          // Jeda tahan klik (seperti tekanan jari manusia)
          await delay(100 + Math.random() * 50);

          await clientB.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: startX,
            y: startY,
            button: "left",
            clickCount: 1,
          });

          bahasaClicked = true;
          console.log("✅ Popup Bahasa berhasil diklik via CDP.");
          break;
        }
        await delay(500); // Tunggu 0.5 detik sebelum cek lagi
      }
    } catch (e) {
      console.log("⚠️ Gagal klik bahasa:", e.message);
    } finally {
      await clientB.detach();
    }

    if (!bahasaClicked) {
      console.log("⚠️ Popup Bahasa tidak muncul atau selector berubah.");
    }

    await delay(5000);

    // ---------- LOGIN TOMBOL GOOGLE (REVISED ANTI-GLITCH) ----------

    // 1. PASANG PERANGKAP (Menunggu Popup Muncul secara Normal)

    const targetCreatedPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Popup Timeout")),
        15000,
      );

      // Menggunakan event targetcreated adalah standar industri yang aman,
      // tapi rahasianya ada di apa yang kita lakukan SETELAH target tercipta.
      browser.once("targetcreated", async (target) => {
        if (target.type() !== "page") return;

        try {
          const newPage = await target.page();

          // --- TRICK CDP: Mematikan deteksi automation di jendela baru ---
          const session = await target.createCDPSession();

          // Gunakan CDP untuk menghapus jejak webdriver di popup secara paksa
          await session.send("Page.addScriptToEvaluateOnNewDocument", {
            source: `
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                `,
          });

          clearTimeout(timeout);
          resolve(newPage);
        } catch (e) {
          console.log("Gagal mengamankan popup via CDP:", e.message);
        }
      });
    });

    // --- [REVISI: PURE CDP READINESS CHECK SEBELUM KLIK] ---
    const clientG = await page.target().createCDPSession();

    try {
      console.log("⏳ Menunggu Shopee & SDK Google siap (Pure CDP)...");

      let isReady = false;
      const startTime = Date.now();

      while (!isReady && Date.now() - startTime < 15000) {
        // Timeout 15 detik
        // 1. Cek apakah Document sudah 'complete'
        const { result } = await clientG.send("Runtime.evaluate", {
          expression: "document.readyState === 'complete'",
        });

        // 2. AMBIL ROOT DOCUMENT (Wajib ada agar variabel 'root' terdefinisi)
        const { root } = await clientG.send("DOM.getDocument", { depth: -1 });

        // 3. CARI NODE ID (Gunakan variabel 'root' yang baru diambil di atas)
        const { nodeId } = await clientG.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector:
            ".E1LjPA > button:nth-child(2), button.vv9870, .social-white-google",
        });

        if (result.value && nodeId) {
          // 3. JEDA EXTRA (Crucial): Berikan waktu 1-2 detik agar event listener terpasang
          // Seringkali tombol muncul tapi fungsinya belum "nempel" (hydration)
          await delay(1500 + Math.random() * 1000);
          isReady = true;

          // Ambil koordinat setelah yakin ready
          const { model } = await clientG.send("DOM.getBoxModel", { nodeId });
          const x = (model.content[0] + model.content[2]) / 2;
          const y = (model.content[1] + model.content[5]) / 2;

          console.log(
            `🎯 Shopee Ready! Menembak koordinat: ${Math.round(x)}, ${Math.round(y)}`,
          );

          // --- EKSEKUSI KLIK HARDWARE ---
          const steps = 5;
          for (let i = 1; i <= steps; i++) {
            await clientG.send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: x + (Math.random() * 10 - 5),
              y: y + (Math.random() * 10 - 5),
              button: "none",
            });
            await delay(20 + Math.random() * 30);
          }

          // 2. Berhenti sejenak di atas tombol
          await clientG.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x,
            y,
          });
          await delay(150 + Math.random() * 100);

          // 3. Tekan (Mouse Pressed)
          await clientG.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x,
            y,
            button: "left",
            clickCount: 1,
          });

          // 4. Jeda tahan
          await delay(80 + Math.random() * 60);

          // 5. Lepas (Mouse Released)
          await clientG.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x,
            y,
            button: "left",
            clickCount: 1,
          });
          // --- [AKHIR DARI PENGGANTIAN] ---
        } else {
          await delay(500);
        }
      }

      if (!isReady)
        throw new Error("Shopee tidak kunjung siap setelah 15 detik");
    } catch (err) {
      console.error("❌ Gagal interaksi Google:", err.message);
    } finally {
      await clientG.detach();
    }

    // 7. TUNGGU HASIL DARI PERANGKAP (targetCreatedPromise)
    let newPage;
    try {
      newPage = await targetCreatedPromise;
      console.log("✅ Popup Google berhasil ditangkap dan diamankan via CDP.");

      // Pastikan popup ditaruh di depan
      await newPage.bringToFront();
    } catch (err) {
      console.log("❌ Popup tidak muncul:", err.message);
    }

    // --- INPUT EMAIL & PASSWORD ---
    try {
      // === 1. PROSES INPUT EMAIL ===
      await newPage.waitForSelector('input[type="email"]', {
        visible: true,
      });
      await newPage.type('input[type="email"]', email, { delay: 100 });
      console.log(`✅ Email ${email} telah dimasukkan!`);

      await newPage.click("#identifierNext");
      console.log("✅ Tombol Next Email telah diklik!");

      await newPage.waitForSelector('input[type="password"]', {
        visible: true,
        timeout: 15000,
      });
      await newPage.type('input[type="password"]', password, {
        delay: 100,
      });
      console.log("✅ Password telah dimasukkan!");

      const passwordNextButtonSelector =
        "#passwordNext > div > button > div.VfPpkd-RLmnJb";
      await newPage.waitForSelector(passwordNextButtonSelector, {
        timeout: 10000,
      });
      await newPage.click(passwordNextButtonSelector);
      console.log("✅ Tombol Next Password berhasil diklik!");
    } catch (err) {
      console.error(
        "❌ Terjadi kesalahan pada proses login Popup:",
        err.message,
      );
    }

    await delay(2000);

    // ---------- TRICK: HANDLE 'I UNDERSTAND' & RE-LOGIN ----------

    // 1. Deteksi & Klik "I Understand" di Popup (Jika Muncul)
    const clientConfirm = await newPage.target().createCDPSession();
    // 1. Deklarasikan variabel status di awal agar bisa dibaca di mana saja
    let needReclick = false;

    try {
      const confirmSelector =
        "#gaplustosNext button, [id*='confirm'], [id*='tosNext'] button";

      console.log("🔍 Mengecek tombol 'I Understand'...");

      // Gunakan newPage (Tab Popup)
      const confirmButton = await newPage
        .waitForSelector(confirmSelector, {
          timeout: 5000,
          visible: true,
        })
        .catch(() => null);

      if (confirmButton) {
        console.log("📜 Tombol ditemukan, melakukan klik...");
        await confirmButton.click();

        // 2. Set nilainya menjadi true jika berhasil
        needReclick = false;
        console.log("✅ Tombol 'I Understand' berhasil diklik!");
        await delay(3000);
      }
    } catch (err) {
      console.log("ℹ️ Error saat klik confirm:", err.message);
      // Jika error pun, kita bisa atur needReclick tetap false atau true tergantung kebutuhan
      needReclick = false;
    }

    // 2. Klik "Continue" (Jika muncul setelah pilih email di percobaan kedua)
    // ---------- GOOGLE CONSENT ----------
    try {
      await newPage.waitForFunction(
        () => {
          return [...document.querySelectorAll("button")].some(
            (b) =>
              b.innerText.includes("Continue") ||
              b.innerText.includes("Lanjutkan"),
          );
        },
        { timeout: 10000 },
      );

      await newPage.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find(
          (b) =>
            b.innerText.includes("Continue") ||
            b.innerText.includes("Lanjutkan"),
        );
        if (btn) btn.click();
      });

      console.log("✅ Tombol Continue");
    } catch {
      console.log("⚠️ Tombol Continue tidak muncul / timeout");
    }

    await delay(3000);

    // 3. EKSEKUSI TRICK: KLIK ULANG TOMBOL GOOGLE DI SHOPEE
    if (needReclick) {
      console.log(
        "🔄 Menjalankan Trik Re-Click: Klik Google untuk kedua kalinya...",
      );
      await delay(2000);

      const finalClientG = await page.target().createCDPSession();
      try {
        const { root: fRoot } = await finalClientG.send("DOM.getDocument", {
          depth: -1,
        });
        const { nodeId: fNodeId } = await finalClientG.send(
          "DOM.querySelector",
          {
            nodeId: fRoot.nodeId,
            selector:
              ".E1LjPA > button:nth-child(2), button.vv9870, .social-white-google",
          },
        );

        if (fNodeId) {
          const secondPopupPromise = new Promise((resolve) =>
            browser.once("targetcreated", (t) => resolve(t.page())),
          );

          const { model } = await finalClientG.send("DOM.getBoxModel", {
            nodeId: fNodeId,
          });
          const xf = (model.content[0] + model.content[2]) / 2;
          const yf = (model.content[1] + model.content[5]) / 2;

          await finalClientG.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: xf,
            y: yf,
            button: "left",
            clickCount: 1,
          });
          await delay(100);
          await finalClientG.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: xf,
            y: yf,
            button: "left",
            clickCount: 1,
          });

          // 2. TANGKAP POPUP KEDUA
          const secondPopup = await secondPopupPromise;
          console.log("📱 Popup Pemilihan Email muncul.");

          const clientSelectEmail = await secondPopup
            .target()
            .createCDPSession();
          try {
            console.log("📧 Menunggu daftar email muncul...");
            let emailAccountNodeId = null;
            const startSelect = Date.now();

            while (!emailAccountNodeId && Date.now() - startSelect < 10000) {
              try {
                // 1. Ambil Document terbaru di SETIAP perulangan loop
                const { root } = await clientSelectEmail.send(
                  "DOM.getDocument",
                  { depth: -1 },
                );

                // 2. Cari Node ID menggunakan Root yang paling fresh
                const { nodeId } = await clientSelectEmail.send(
                  "DOM.querySelector",
                  {
                    nodeId: root.nodeId,
                    selector: `div[data-identifier="${email}"], [data-email="${email}"], li.aZvCDf`,
                  },
                );

                if (nodeId) {
                  emailAccountNodeId = nodeId;
                } else {
                  await delay(1000); // Beri waktu loading halaman
                }
              } catch (domErr) {
                // Jika error "Could not find node", kita abaikan dan coba lagi di loop berikutnya
                console.log("⏳ Menunggu stabilitas DOM...");
                await delay(500);
              }
            }

            if (emailAccountNodeId) {
              const { model } = await clientSelectEmail.send(
                "DOM.getBoxModel",
                { nodeId: emailAccountNodeId },
              );
              const x = (model.content[0] + model.content[2]) / 2;
              const y = (model.content[1] + model.content[5]) / 2;

              await clientSelectEmail.send("Input.dispatchMouseEvent", {
                type: "mouseMoved",
                x,
                y,
              });
              await delay(200);
              await clientSelectEmail.send("Input.dispatchMouseEvent", {
                type: "mousePressed",
                x,
                y,
                button: "left",
                clickCount: 1,
              });
              await delay(100);
              await clientSelectEmail.send("Input.dispatchMouseEvent", {
                type: "mouseReleased",
                x,
                y,
                button: "left",
                clickCount: 1,
              });
              console.log("✅ Email berhasil dipilih di klik kedua!");

              // ---------- GOOGLE CONSENT (FIXED: Menggunakan secondPopup) ----------
              try {
                // Gunakan secondPopup karena ini adalah jendela yang aktif sekarang
                await secondPopup.waitForFunction(
                  () => {
                    return [...document.querySelectorAll("button")].some(
                      (b) =>
                        b.innerText.includes("Continue") ||
                        b.innerText.includes("Lanjutkan"),
                    );
                  },
                  { timeout: 10000 },
                );

                await secondPopup.evaluate(() => {
                  const btn = [...document.querySelectorAll("button")].find(
                    (b) =>
                      b.innerText.includes("Continue") ||
                      b.innerText.includes("Lanjutkan"),
                  );
                  if (btn) btn.click();
                });

                console.log("✅ Tombol Continue Berhasil Diklik!");
              } catch (e) {
                console.log("⚠️ Tombol Continue tidak muncul / timeout");
              }
              // --------------------------------------------------------------------
            }
          } finally {
            await clientSelectEmail.detach();
          }
        }
      } catch (e) {
        console.log("⚠️ Gagal Re-click:", e.message);
      } finally {
        await finalClientG.detach();
      }
    }

    await delay(3000);

    // ---------- SHOPEE SETUJU (ULTRA SAFE CDP METHOD) ----------
    try {
      let setujuClicked = false;
      const startSetuju = Date.now();

      while (Date.now() - startSetuju < 8000) {
        // Timeout 8 detik
        // Gunakan XPath untuk mencari tombol dengan teks variasi bahasa
        const [btnSetuju] = await page.$$(
          "xpath///button[contains(., 'Setuju') or contains(., 'Agree') or contains(., 'Confirm') or contains(., 'Lanjutkan')]",
        );

        if (btnSetuju) {
          const box = await btnSetuju.boundingBox();

          if (box && box.width > 0 && box.height > 0) {
            const client = await page.target().createCDPSession();
            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;

            console.log(
              `🚀 Klik tombol Setuju di koordinat: ${startX}, ${startY}`,
            );

            // Simpulkan klik manusia melalui CDP
            await client.send("Input.dispatchMouseEvent", {
              type: "mousePressed",
              x: startX,
              y: startY,
              button: "left",
              clickCount: 1,
            });

            await delay(150);

            await client.send("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              x: startX,
              y: startY,
              button: "left",
              clickCount: 1,
            });

            await client.detach();
            setujuClicked = true;
            break;
          }
        }
        await delay(800); // Polling interval
      }

      if (setujuClicked) {
        console.log("✅ Tombol Setuju BERHASIL diklik via CDP");
      } else {
        console.log("ℹ️ Tombol Setuju tidak muncul/ditemukan");
      }
    } catch (err) {
      console.log("⚠️ Gagal memproses klik Setuju via CDP:", err.message);
    }

    await delay(3000);

    // ---------- CAPTCHA SCANNING (DEEP INTEGRATION - MANUAL FILTER MODE) ----------
    console.log("⏳ Sinkronisasi Captcha/Verifikasi (Silent CDP Mode)...");

    const captchaElement = await page.$("#modal > aside > div._9CE2ae > div > div:nth-child(2) > div > div.Qm81FR > h1");

    if (captchaElement) {
      let lastSrc = "";
      let lastX = "translateX(0px)";
      let lastPuzzleStyle = "";
      let numSliderX = 0;
      let numPuzzleX = 0;
      let numPuzzleY = 0;
      let id_image = 0;
      let cekCaptcha;
      let logMelepasSlider = '';
      let isAutoResolved = false; // Akan selalu false karena kita hanya mau manual

      const selectorImg =
        "#modal > aside > div._9CE2ae > div > div:nth-child(2) > div > div.mOMhvN > div:nth-child(1) > div.kzPOuc > div:nth-child(1) > img";
      const selectorPuzzle = "#puzzleContainer";
      const selectorPuzzleImg = "#puzzleImgComponent";
      const selectorSlider = "#sliderContainer";

      const selectorTitleCaptcha = "#modal > aside > div._9CE2ae > div > div:nth-child(2) > div > div.Qm81FR > h1"

      // Mulai dengan mode sembunyi (Silent Monitoring)
      await moveBrowser("show");

      const client = await page.target().createCDPSession();

      while (true) {
        try {
          const { root } = await client.send("DOM.getDocument", { depth: -1 });
          const sliderNode = await client
            .send("DOM.querySelector", {
              nodeId: root.nodeId,
              selector: selectorSlider,
            })
            .catch(() => null);

          // 1. JIKA SLIDER SUDAH HILANG (SUKSES GESER MANUAL)
          if (!sliderNode || !sliderNode.nodeId) {
            await delay(300);
            const stillExist = await page.$(selectorSlider);

            if (!stillExist) {
              await moveBrowser("hide");
              console.log(`✅ [WORKER ${WORKER_ID}] Slider sukses!`);
              const resolveData = `${lastPuzzleStyle}\n\n#sliderContainer\n${lastX};`;

              if (lastSrc) {
                // Karena kita hanya show yang baru, maka status di-update ke 1 (solved)
                await pool.query(
                  "UPDATE captcha_shopee SET data_resolve = ?, puzzleX = ?, puzzleY = ?, sliderX = ?, status = 1 WHERE image = ? AND status = 0 AND id = ?",
                  [resolveData, numPuzzleX, numPuzzleY, numSliderX, lastSrc, id_image],
                );
                console.log("✅ Data resolve tersimpan ke database, ID . "+id_image+", slider : "+ lastX);
              }

              // Klik tombol Setuju/Lanjutkan
              const [btnSetuju] = await page.$$(
                "xpath///button[contains(., 'Setuju') or contains(., 'Agree') or contains(., 'Confirm') or contains(., 'Lanjutkan')]",
              );

              if (btnSetuju) {
                const box = await btnSetuju.boundingBox();
                if (box) {
                  await client.send("Input.dispatchMouseEvent", {
                    type: "mousePressed",
                    x: box.x + box.width / 2,
                    y: box.y + box.height / 2,
                    button: "left",
                    clickCount: 1,
                  });
                  await delay(100);
                  await client.send("Input.dispatchMouseEvent", {
                    type: "mouseReleased",
                    x: box.x + box.width / 2,
                    y: box.y + box.height / 2,
                    button: "left",
                    clickCount: 1,
                  });
                }
              }

              break;
            }
            continue;
          }

          // 2. MONITORING GAMBAR (SRC) VIA CDP
          const nodeImg = await client
            .send("DOM.querySelector", {
              nodeId: root.nodeId,
              selector: selectorImg,
            })
            .catch(() => null);

          if (nodeImg && nodeImg.nodeId) {
            const { attributes } = await client.send("DOM.getAttributes", {
              nodeId: nodeImg.nodeId,
            });
            const srcIdx = attributes.indexOf("src");

            if (srcIdx !== -1) {
              const currentSrc = attributes[srcIdx + 1];

              if (currentSrc !== lastSrc) {
                lastSrc = currentSrc;
                lastX = "translateX(0px)";
                // console.log("🔄 Gambar Captcha berubah, mengecek status...");

                let [newcekCaptcha] = await pool.query(
                  "SELECT id, data_resolve, status FROM captcha_shopee WHERE image = ?",
                  [lastSrc],
                );

                cekCaptcha = newcekCaptcha

                // A. JIKA CAPTCHA BARU (Belum ada di DB sama sekali)
                if (cekCaptcha.length === 0) {
                  try {
                    await pool.query(
                      "INSERT INTO captcha_shopee (image) VALUES (?)",
                      [lastSrc],
                    );
                   
                    const [cekUlang] = await pool.query(
                      "SELECT id, data_resolve, status FROM captcha_shopee WHERE image = ?",
                      [lastSrc],
                    );
                    cekCaptcha = cekUlang;

                     console.log(
                      "🆕 Captcha Baru Terdeteksi ID "+cekCaptcha[0].id,
                    );
                    
                    await moveBrowser("show");
                  } catch (err) {
                    const [cekUlang] = await pool.query(
                      "SELECT id, data_resolve, status FROM captcha_shopee WHERE image = ?",
                      [lastSrc],
                    );
                    cekCaptcha = cekUlang;
                  }
                }

                // B. JIKA CAPTCHA LAMA (Sudah ada di DB)
                if (cekCaptcha.length > 0) {
                  // Update counter total kemunculan
                  await pool.query(
                    "UPDATE captcha_shopee SET total = total + 1 WHERE id = ?",
                    [cekCaptcha[0].id],
                  );

                  // Logika permintaanmu: Jika sudah ada data_resolve, tetap sembunyikan (Silent)
                  if (cekCaptcha[0].data_resolve) {
                    console.log(
                      `🙈 Captcha Lama (ID: ${cekCaptcha[0].id}) sudah ada solusi. Tetap Silent (Menunggu ganti otomatis)...`,
                    );
                    await moveBrowser("hide");
                  } else {
                    // Jika ada di DB tapi data_resolve kosong, tetap show
                    console.log(
                      `⚠️ Captcha Lama (ID: ${cekCaptcha[0].id}) tapi belum ada solusi. MENAMPILKAN LAYAR...`,
                    );
                    await moveBrowser("show");
                  }
                }

                const teksBaru = `WORKER[${WORKER_ID}] - ID IMAGE : ${cekCaptcha[0].id}`;
      
                //rubah title capcha
                try {
                    // 1. Dapatkan CDP Session
                    const client = await page.target().createCDPSession();

                    // 2. Ambil Root Node dari dokumen
                    const { root: { nodeId: documentNodeId } } = await client.send('DOM.getDocument');

                    // 3. Cari Node ID berdasarkan selector kamu
                    const { nodeId } = await client.send('DOM.querySelector', {
                        nodeId: documentNodeId,
                        selector: selectorTitleCaptcha
                    });

                    if (nodeId) {
                        // 4. Gunakan Runtime.evaluate untuk mengubah innerText pada node tersebut
                        // Kita gunakan NodeID untuk memastikan kita mengubah elemen yang tepat
                        await client.send('Runtime.evaluate', {
                            expression: `document.querySelector('${selectorTitleCaptcha}').innerText = '${teksBaru}'`,
                            returnByValue: true
                        });
                    }
                } catch (e) {
                    console.log(`❌ [WORKER ${WORKER_ID}] Gagal via CDP: Selector mungkin belum muncul.`);
                }
                //end rubah title capcha

              }
            }
          }

          // 3. MONITORING KOORDINAT GESER (LIVE UPDATE)
          const { attributes: attrSli } = await client.send(
            "DOM.getAttributes",
            { nodeId: sliderNode.nodeId },
          );
          const styleIdxS = attrSli.indexOf("style");

          if (styleIdxS !== -1) {
            const styleValS = attrSli[styleIdxS + 1];
            const currentX =
              styleValS.match(/translateX\([^)]+\)/)?.[0] || "translateX(0px)";

            if (currentX !== lastX) {
              lastX = currentX;
              const matchX = currentX.match(/translateX\(([-\d.]+)px\)/);
              if (matchX) numSliderX = parseFloat(matchX[1]);

              // Ambil koordinat Puzzle secara Live
              const nodeP = await client
                .send("DOM.querySelector", {
                  nodeId: root.nodeId,
                  selector: selectorPuzzle,
                })
                .catch(() => null);
              const nodePI = await client
                .send("DOM.querySelector", {
                  nodeId: root.nodeId,
                  selector: selectorPuzzleImg,
                })
                .catch(() => null);

              if (nodeP && nodePI) {
                const { attributes: aP } = await client.send(
                  "DOM.getAttributes",
                  { nodeId: nodeP.nodeId },
                );
                const { attributes: aPI } = await client.send(
                  "DOM.getAttributes",
                  { nodeId: nodePI.nodeId },
                );
                const sP = aP[aP.indexOf("style") + 1] || "";
                const sPI = aPI[aPI.indexOf("style") + 1] || "";

                const pX =
                  sP.match(/translateX\([^)]+\)/)?.[0] || "translateX(0px)";
                const pY =
                  sP.match(/translateY\([^)]+\)/)?.[0] || "translateY(0px)";
                const pR = sPI.match(/rotate\([^)]+\)/)?.[0] || "rotate(0deg)";

                const matchPX = pX.match(/translateX\(([-\d.]+)px\)/);
                const matchPY = pY.match(/translateY\(([-\d.]+)px\)/);
                if (matchPX) numPuzzleX = parseFloat(matchPX[1]);
                if (matchPY) numPuzzleY = parseFloat(matchPY[1]);

                lastPuzzleStyle = `#puzzleContainer\n${pX}\n${pY}\ntransform: ${pR}`;

                id_image = cekCaptcha[0].id
                let newLogMelepasSlider = "ID Image saat melepas slider "+id_image;
                if(logMelepasSlider != newLogMelepasSlider){
                  logMelepasSlider = newLogMelepasSlider
                  console.log("ID Image saat melepas slider ",id_image)
                }
              }
            }
          }
        } catch (e) {
          // Silence
        }
        await delay(300); // Polling cepat untuk record lastX
      }

      await client.detach();
    }
    await delay(3000);
    // ---------- CEK LOGIN AKHIR (ULTRA SAFE CDP RUNTIME) ----------
    console.log("⏳ Cek status login akhir via Direct CDP Runtime...");
    const startCheckLogin = Date.now();
    let loginStatus = { success: false, cookies: null };

    // Membuat session CDP sekali saja untuk efisiensi
    const cdp = await page.target().createCDPSession();

    while (Date.now() - startCheckLogin < 12000) {
      // Timeout sedikit lebih longgar (12 detik)
      const url = page.url();

      // Mengeksekusi pengecekan elemen langsung di Runtime Chrome (Sangat Silent)
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: `(function() {
                const avatar = document.querySelector(".shopee-avatar, .navbar__username");
                const failedId = document.evaluate("//*[contains(text(), 'Gagal untuk log in dengan Google')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                const failedEn = document.evaluate("//*[contains(text(), 'Failed to log in with Google')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                
                return {
                    isLoggedIn: !!avatar,
                    isFailed: !!(failedId || failedEn)
                };
            })()`,
        returnByValue: true,
      });

      const check = result.value;

      // Logika Kondisi
      if (
        check.isLoggedIn ||
        url.includes("captcha") ||
        url.includes("anti_bot") ||
        url.includes("verify")
      ) {
        loginStatus.cookies = await page.cookies();
        loginStatus.success = true;
        break;
      }

      if (check.isFailed) {
        console.log("❌ Sinyal Gagal Login terdeteksi (CDP Runtime).");
        break;
      }

      await delay(1000);
    }

    await cdp.detach(); // Tutup session CDP setelah selesai

    // Eksekusi penutupan browser
    if (loginStatus.success) {
      console.log(`✅ Proses Selesai: Akun ${email} Terverifikasi.`);
      await browser.close();
      return loginStatus;
    } else {
      console.log(`❌ Gagal login atau timeout: ${page.url()}`);
      //await delay(9999999);
      await browser.close();
      return { success: false };
    }
  } catch (err) {
    console.error("❌ Error login fatal:", err.message);

    // Tunggu 5 detik sebelum menutup agar kamu bisa melihat layar terakhir
    console.log("⏳ Menahan browser selama 5 detik untuk inspeksi manual...");
    await delay(5000);

    if (typeof browser !== "undefined" && browser) {
      await browser.close();
    }
    return { success: false };
  }
}

/// ================= MAIN =================
(async () => {
  console.log("🔥 BOT COOKIE START");
  let start_date_time = moment().format("YYYY-MM-DD HH:mm:ss");

  while (true) {
    const [settingRows] = await pool.query(
      "SELECT * FROM setting_shopee WHERE id = 1",
    );

    if (settingRows[0].status_server === "ON") {
      console.log("Stop dikarenakan status server ON");
      await delay(5000);
      process.exit(0);
    }

    if (settingRows[0].max_cookie <= WORKER_ID) {
      console.log("Stop dikarenakan max cookie");
      await delay(5000);
      process.exit(0);
    }

    //start set lang cookie
    TYPE_COOKIE = settingRows[0].type_cookie;
    BASE_URL = "https://shopee.co.id";
    SHOPEE_LANG = "id";

    if (TYPE_COOKIE === "MY") {
      BASE_URL = "https://shopee.com.my";
      SHOPEE_LANG = "en";
    } else if (TYPE_COOKIE === "SG") {
      BASE_URL = "https://shopee.sg";
      SHOPEE_LANG = "en";
    }
    LOGIN_URL = `${BASE_URL}/buyer/login`;
    //end set lang cookie

    const MAX_ACCOUNT_COOKIE = settingRows[0].max_account_cookie;

    let end_date_time = moment().format("YYYY-MM-DD HH:mm:ss");
    const diff = moment(end_date_time).diff(moment(start_date_time), "minutes");

    if (diff >= 60) {
      console.log("⏰ Istirahat rutin 5 menit...");
      await delay(5 * 60 * 1000);
      start_date_time = moment().format("YYYY-MM-DD HH:mm:ss");
    }

    try {
      if (MAX_ACCOUNT_COOKIE !== "UNLIMITED") {
        const limitMax = parseInt(MAX_ACCOUNT_COOKIE);
        const [cekMaxRow] = await pool.query(
          "SELECT COUNT(id) AS total FROM akun_shopee WHERE type_country = ? AND status = 1",
          [TYPE_COOKIE],
        );

        if (cekMaxRow[0].total >= limitMax) {
          console.log(
            `⚠️ Limit tercapai (${cekMaxRow[0].total}). Menunggu 1 menit...`,
          );
          await delay(60000);
          continue;
        }
      }

      const [candidates] = await pool.query(
        "SELECT id FROM akun_shopee WHERE status = 0 AND total_error_cookie < 3 AND terminal_cookie = ? LIMIT 1",
        [WORKER_ID + 1],
      );

      //andi
        // const [candidates] = await pool.query(
        //   "SELECT id FROM akun_shopee WHERE status = 0  LIMIT 1",
        //   [],
        // );

      if (candidates.length > 0) {
        const lockedId = candidates[0].id;
        const [details] = await pool.query(
          "SELECT s.*, g.nama_depan, g.nama_belakang, g.url_photo FROM akun_shopee s LEFT JOIN akun_gsuite g ON s.email = g.email WHERE s.id = ?",
          [lockedId],
        );

        if (details.length === 0) continue;

        const targetAccount = details[0];
        const result = await loginShopee(
          targetAccount.email.trim(),
          targetAccount.password,
          targetAccount.id,
          WORKER_ID + 1,
          SHOPEE_LANG,
        );

        if (result.success && result.cookies) {
          const updateResult = await updateProfile(
            targetAccount,
            result.cookies,
          );
          if (updateResult) {
            await pool.query(
              "UPDATE akun_shopee SET cookie = ?, status = 1, date_cookie = NOW(), type_country = ? WHERE id = ?",
              [JSON.stringify(result.cookies), TYPE_COOKIE, targetAccount.id],
            );
            console.log(`💾 ${targetAccount.email} → Done & Saved`);
          } else {
            await pool.query(
              "UPDATE akun_shopee SET terminal_cookie = NULL WHERE id = ?",
              [targetAccount.id],
            );
          }
        } else if (result.banned) {
          await pool.query(
            "UPDATE akun_shopee SET status = 2, date_updated = NOW() WHERE id = ?",
            [targetAccount.id],
          );
        } else {
          await pool.query(
            "UPDATE akun_shopee SET terminal_cookie = NULL WHERE id = ?",
            [targetAccount.id],
          );
        }
      } else {
        console.log("💤 Menunggu data...");
        await delay(3000);
      }
    } catch (err) {
      console.error("Fatal Error:", err);
      await delay(3000);
    }
  }
})();
