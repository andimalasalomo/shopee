const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const request = require("request");
const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const cv = require("opencv-wasm");
const { Jimp } = require("jimp");
require("dotenv").config({ quiet: true });

puppeteer.use(StealthPlugin());

// ================= CAPTCHA SOLVER =================
async function getBase64ImageFromUrl(page, url) {
  try {
    return await page.evaluate(async (imageUrl) => {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }, url);
  } catch (err) {
    console.error("❌ getBase64ImageFromUrl Error:", err.message);
    return null;
  }
}

async function solveSliderCaptcha(bgB64, puzzleB64) {
  try {
    const bgData = bgB64.replace(/^data:image\/\w+;base64,/, "");
    const puzzleData = puzzleB64.replace(/^data:image\/\w+;base64,/, "");

    const bgBuf = Buffer.from(bgData, "base64");
    const puzzleBuf = Buffer.from(puzzleData, "base64");

    const bgJimp = await Jimp.read(bgBuf);
    const puzzleJimp = await Jimp.read(puzzleBuf);

    const src = new cv.Mat(bgJimp.bitmap.height, bgJimp.bitmap.width, cv.CV_8UC4);
    src.data.set(bgJimp.bitmap.data);

    const templ = new cv.Mat(puzzleJimp.bitmap.height, puzzleJimp.bitmap.width, cv.CV_8UC4);
    templ.data.set(puzzleJimp.bitmap.data);

    const processedSrc = new cv.Mat();
    const processedTempl = new cv.Mat();

    cv.cvtColor(src, processedSrc, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(templ, processedTempl, cv.COLOR_RGBA2GRAY);

    cv.Canny(processedSrc, processedSrc, 100, 200);
    cv.Canny(processedTempl, processedTempl, 100, 200);

    const result = new cv.Mat();
    const mask = new cv.Mat();

    cv.matchTemplate(processedSrc, processedTempl, result, cv.TM_CCORR_NORMED, mask);

    const minMax = cv.minMaxLoc(result);
    const x = minMax.maxLoc.x;

    src.delete();
    templ.delete();
    processedSrc.delete();
    processedTempl.delete();
    result.delete();
    mask.delete();

    // The puzzle image is usually slightly padded or scaled.
    // We adjust it if needed, but returning x is the core logic.
    return x;
  } catch (err) {
    console.error("❌ Error in solveSliderCaptcha:", err.message);
    return 0;
  }
}

moment.tz.setDefault("Asia/Jakarta");

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
let EDGE_PATH = process.platform === 'darwin'
  ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

if (process.platform === 'linux') {
  EDGE_PATH = '/usr/bin/google-chrome'; // Fallback for linux testing
}

// ================= CONTOH EMAIL & PASSWORD (GANTI DENGAN DATA ASLI) =================
const ACCOUNTS = [
  { email: "	oktarawageyuranda170426@gpsdhokgama.com", password: "MandalaROBBY304$" },
];

// ================= UTIL =================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR);

// ================= LOGIN SHOPEE =================
async function loginShopee(email, password, index) {
  console.log(`\n🚀 [AKUN ${index + 1}] Login : ${email}`);

  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, "_");
  const timestamp = Date.now().toString();
  const workerProfilePath = path.join(
    __dirname,
    "profile_edge",
    "manual",
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
      "--window-position=-2000,0",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-focus-on-start",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--no-sandbox",
      "--no-first-run",
      "--wm-window-animations-disabled",
      "--window-size=720,2000",
      "--disable-gpu",
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

  let loginResult = { success: false, cookies: null };

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

  // --- [REVISI 3: PENANDA AKUN (Visual)] ---
  await page.evaluateOnNewDocument((idx) => {
    setInterval(() => {
      const prefix = `[MANUAL ${idx + 1}]`;
      if (!document.title.startsWith(prefix)) {
        document.title =
          prefix + " - " + document.title.replace(/^\[MANUAL \d+\] - /, "");
      }
    }, 1000);
  }, index);

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
          for (let i = 0; i < 6; i++) {
            await clientB.send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: startX + (Math.random() * 8 - 4),
              y: startY + (Math.random() * 8 - 4),
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

      browser.once("targetcreated", async (target) => {
        if (target.type() !== "page") return;

        try {
          const newPage = await target.page();

          // --- TRICK CDP: Mematikan deteksi automation di jendela baru ---
          const session = await target.createCDPSession();

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

    // ---------- CAPTCHA SCANNING (MANUAL MODE - TANPA DB) ----------
    console.log("⏳ Sinkronisasi Captcha/Verifikasi (Silent CDP Mode)...");

    const captchaElement = await page.$("#modal > aside > div._9CE2ae > div > div:nth-child(2) > div > div.Qm81FR > h1");

    if (captchaElement) {
      let lastSrc = "";
      let lastX = "translateX(0px)";
      let lastPuzzleStyle = "";
      let numSliderX = 0;
      let numPuzzleX = 0;
      let numPuzzleY = 0;

      const selectorImg =
        "#modal > aside > div._9CE2ae > div > div:nth-child(2) > div > div.mOMhvN > div:nth-child(1) > div.kzPOuc > div:nth-child(1) > img";
      const selectorPuzzle = "#puzzleContainer";
      const selectorPuzzleImg = "#puzzleImgComponent";
      const selectorSlider = "#sliderContainer";

      const selectorTitleCaptcha = "#modal > aside > div._9CE2ae > div > div:nth-child(2) > div > div.Qm81FR > h1";

      // Tampilkan browser agar user bisa solve captcha manual
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
              console.log(`✅ Slider sukses! Captcha berhasil di-solve manual.`);

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
                console.log("🔄 Gambar Captcha berubah, mencoba auto-solve...");

                try {
                  const titleClient = await page.target().createCDPSession();
                  const { root: { nodeId: documentNodeId } } = await titleClient.send('DOM.getDocument');
                  const { nodeId } = await titleClient.send('DOM.querySelector', {
                    nodeId: documentNodeId,
                    selector: selectorTitleCaptcha
                  });

                  if (nodeId) {
                    await titleClient.send('Runtime.evaluate', {
                      expression: `document.querySelector('${selectorTitleCaptcha}').innerText = '[AUTO] Sedang menghitung jarak...'`,
                      returnByValue: true
                    });
                  }
                  await titleClient.detach();
                } catch (e) {
                  console.log(`❌ Gagal update title captcha via CDP.`);
                }

                // --- AUTO SOLVER LOGIC ---
                try {
                  // Wait for the puzzle piece to load
                  await delay(2000); // give the images a moment to fully render

                  // Get images via page evaluate to handle base64 or blob parsing
                  const bgUrl = await page.$eval(selectorImg, img => img.src).catch(() => null);
                  const puzzleUrl = await page.$eval(selectorPuzzleImg, img => img.src).catch(() => null);

                  if (bgUrl && puzzleUrl) {
                    console.log("📥 Mengambil gambar base64...");
                    const bgB64 = await getBase64ImageFromUrl(page, bgUrl);
                    const puzzleB64 = await getBase64ImageFromUrl(page, puzzleUrl);

                    if (bgB64 && puzzleB64) {
                      console.log("🧠 Menganalisis puzzle...");
                      // Original images on Shopee are typically wider. The puzzle area is around 340px
                      // But the background might be scaled.
                      // Let's compute offset via opencv-wasm
                      let xOffset = await solveSliderCaptcha(bgB64, puzzleB64);

                      // Sometimes we need a scale factor if the image displayed on screen
                      // is smaller than the original image size downloaded.
                      // Let's dynamically get the scale factor
                      const scaleInfo = await page.evaluate((bgSel) => {
                        const bgEl = document.querySelector(bgSel);
                        if (bgEl) {
                          return {
                            renderedWidth: bgEl.getBoundingClientRect().width,
                            naturalWidth: bgEl.naturalWidth || 340
                          };
                        }
                        return { renderedWidth: 340, naturalWidth: 340 };
                      }, selectorImg);

                      const scaleRatio = scaleInfo.renderedWidth / scaleInfo.naturalWidth;

                      const scaledOffset = Math.round(xOffset * scaleRatio);
                      console.log(`🎯 Jarak ditemukan: ${xOffset}px (Skala: ${scaledOffset}px)`);

                      // Get slider dimensions and position
                      const sliderEl = await page.$(selectorSlider);
                      if (sliderEl) {
                        const box = await sliderEl.boundingBox();
                        if (box) {
                          const startX = box.x + box.width / 2;
                          const startY = box.y + box.height / 2;

                          // Execute human-like drag
                          const client = await page.target().createCDPSession();
                          await client.send("Input.dispatchMouseEvent", {
                            type: "mouseMoved",
                            x: startX,
                            y: startY
                          });
                          await delay(100 + Math.random() * 50);

                          await client.send("Input.dispatchMouseEvent", {
                            type: "mousePressed",
                            x: startX,
                            y: startY,
                            button: "left",
                            clickCount: 1
                          });
                          await delay(100 + Math.random() * 50);

                          const steps = 15;
                          for (let i = 1; i <= steps; i++) {
                            const currentTargetX = startX + (scaledOffset * (i / steps));
                            const currentTargetY = startY + (Math.random() * 4 - 2); // slight vertical jitter
                            await client.send("Input.dispatchMouseEvent", {
                              type: "mouseMoved",
                              x: currentTargetX,
                              y: currentTargetY
                            });
                            await delay(20 + Math.random() * 30);
                          }

                          await delay(100 + Math.random() * 50);
                          await client.send("Input.dispatchMouseEvent", {
                            type: "mouseReleased",
                            x: startX + scaledOffset,
                            y: startY,
                            button: "left",
                            clickCount: 1
                          });
                          await client.detach();
                          console.log("✅ Auto geser selesai");
                        }
                      }
                    }
                  }
                } catch(err) {
                  console.error("❌ Auto-solver error:", err.message);
                }
                // --- END AUTO SOLVER LOGIC ---
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

      // Simpan cookie ke file lokal
      const cookieFile = path.join(COOKIE_DIR, `${safeEmail}.json`);
      fs.writeFileSync(cookieFile, JSON.stringify(loginStatus.cookies, null, 2));
      console.log(`💾 Cookie disimpan ke: ${cookieFile}`);

      await browser.close();
      return { success: true, cookies: loginStatus.cookies };
    } else {
      console.log(`❌ Gagal login atau timeout: ${page.url()}`);
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

// ================= MAIN =================
(async () => {
  console.log("🔥 BOT COOKIE MANUAL START");
  console.log(`📋 Total akun yang akan diproses: ${ACCOUNTS.length}`);

  for (let i = 0; i < ACCOUNTS.length; i++) {
    const account = ACCOUNTS[i];
    console.log(`\n========================================`);
    console.log(`📌 Memproses akun ${i + 1}/${ACCOUNTS.length}: ${account.email}`);
    console.log(`========================================`);

    const result = await loginShopee(account.email, account.password, i);

    if (result.success && result.cookies) {
      console.log(`✅ ${account.email} → Cookie berhasil disimpan!`);
    } else {
      console.log(`❌ ${account.email} → Gagal mendapatkan cookie.`);
    }

    // Jeda antar akun agar tidak terlalu cepat
    if (i < ACCOUNTS.length - 1) {
      console.log("⏳ Jeda 3 detik sebelum akun berikutnya...");
      await delay(3000);
    }
  }

  console.log("\n🏁 Semua akun selesai diproses!");
  process.exit(0);
})();
