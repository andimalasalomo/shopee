const cv = require('@u4/opencv4nodejs');

function deteksiViaGarisTepi() {
    try {
        const bg = cv.imread('captcha.jpg');
        const key = cv.imread('captcha_key.jpeg');

        // 1. Ambil Garis Tepi Kucing (Key)
        const keyGray = key.bgrToGray();
        // Canny deteksi outline
        const keyEdges = keyGray.canny(100, 200);

        // 2. Ambil Garis Tepi Background
        const bgGray = bg.bgrToGray();
        const bgEdges = bgGray.canny(100, 200);

        // Simpan debug untuk lihat apakah garis kucing & lubang terlihat
        cv.imwrite('debug_edges.jpg', bgEdges);

        // 3. Template Matching menggunakan garis tepi
        // TM_CCORR_NORMED sangat kuat untuk mencocokkan outline
        const matched = bgEdges.matchTemplate(keyEdges, cv.TM_CCORR_NORMED);

        // Kita cari lokasi terbaik
        const minMax = matched.minMaxLoc();
        const score = minMax.maxVal;
        const pos = minMax.maxLoc;

        console.log(`[DEBUG] Skor Kecocokan Outline: ${score.toFixed(4)}`);

        // Jika skor cukup meyakinkan
        if (score > 0.05) { // Nilai kecil karena background sawah sangat berisik
            console.log(`=> LUBANG DITEMUKAN! X: ${pos.x}, Y: ${pos.y}`);

            // Ambil kontur asli untuk mewarnai solid merah
            const keyMask = keyGray.threshold(240, 255, cv.THRESH_BINARY_INV);
            const keyContours = keyMask.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            const catPoints = keyContours.sort((c0, c1) => c1.area - c0.area)[0].getPoints();

            // Geser titik ke lokasi temuan
            const shiftedPoints = catPoints.map(p => new cv.Point2(p.x + pos.x, p.y + pos.y));

            bg.drawFillPoly([shiftedPoints], new cv.Vec(0, 0, 255));
            cv.imwrite('hasil_merah.jpg', bg);
            console.log('\n[SUKSES] Berhasil mewarnai berdasarkan outline!');
        } else {
            console.log('\n[GAGAL] Outline tidak cocok. Tekstur sawah terlalu menutupi lubang.');
        }

    } catch (err) {
        console.error(err);
    }
}

deteksiViaGarisTepi();