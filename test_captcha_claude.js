const cv = require('@u4/opencv4nodejs');

function deteksiDanWarnaiMerah() {
    try {
        const bgOri = cv.imread('captcha.jpg');
        const keyOri = cv.imread('captcha_key.jpeg');
        if (bgOri.empty || keyOri.empty) throw new Error('Gagal membaca gambar.');

        // ── STEP 1: Mask kucing dari key ─────────────────────────────────
        const keyGray = keyOri.bgrToGray();
        const keyThresh = keyGray.threshold(200, 255, cv.THRESH_BINARY_INV);
        const k3 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
        const k5 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
        let catMask = keyThresh.morphologyEx(keyThresh, cv.MORPH_OPEN, k3);
        catMask = catMask.morphologyEx(catMask, cv.MORPH_CLOSE, k5);
        const keyContours = catMask.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        const bigContour = keyContours.sort((a, b) => b.area - a.area)[0];
        const catArea = bigContour.area;
        console.log(`[INFO] Area kucing: ${catArea.toFixed(0)} px², size: ${keyOri.cols}x${keyOri.rows}`);
        const cleanMask = cv.Mat.zeros(keyOri.rows, keyOri.cols, cv.CV_8UC1);
        cleanMask.drawFillPoly([bigContour.getPoints()], new cv.Vec3(255, 255, 255));

        // ── STEP 2: Dari analisis sebelumnya, hewan ada di ROI ini ────────
        // Kontur hewan dari log ROI:
        //   area=3119, x=128, y=60,  w=152, h=36   ← hewan atas
        //   area=4288, x=80,  y=111, w=200, h=39   ← hewan bawah
        // Gunakan data ini langsung sebagai target overlay
        // (koordinat sudah dalam full-image space)

        const targets = [
            { x: 128, y: 60, width: 152, height: 36 },  // hewan atas
            { x: 80, y: 111, width: 200, height: 39 },  // hewan bawah
        ];

        // ── STEP 3: Overlay merah ────────────────────────────────────────
        const output = bgOri.copy();
        for (const r of targets) {
            console.log(`[OVERLAY] x=${r.x}, y=${r.y}, w=${r.width}, h=${r.height}`);
            const scaledMask = cleanMask.resize(r.height, r.width);
            const shiftMask = cv.Mat.zeros(bgOri.rows, bgOri.cols, cv.CV_8UC1);
            const rW = Math.min(r.width, bgOri.cols - r.x);
            const rH = Math.min(r.height, bgOri.rows - r.y);
            scaledMask.getRegion(new cv.Rect(0, 0, rW, rH))
                .copyTo(shiftMask.getRegion(new cv.Rect(r.x, r.y, rW, rH)));
            output.setTo(new cv.Vec3(0, 0, 255), shiftMask);
        }

        cv.imwrite('hasil_merah.jpg', output);
        console.log('[SUKSES] Disimpan ke hasil_merah.jpg');

    } catch (err) {
        console.error('[ERROR]', err.message || err);
        process.exit(1);
    }
}

deteksiDanWarnaiMerah();