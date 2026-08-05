const { Jimp } = require("jimp");
const { cv } = require("opencv-wasm");

async function testAdaptive() {
  const bg = await Jimp.read("log_auto_resolve/captcha_1_1777460166663_bg.png");
  const bgW = bg.bitmap.width;
  const bgH = bg.bitmap.height;

  const src = new cv.Mat(bgH, bgW, cv.CV_8UC4);
  src.data.set(bg.bitmap.data);
  const gSrc = new cv.Mat();
  cv.cvtColor(src, gSrc, cv.COLOR_RGBA2GRAY);

  const blurred = new cv.Mat();
  cv.GaussianBlur(gSrc, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

  const thresh = new cv.Mat();
  // blockSize 81, C=15
  cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 81, 15);

  const out = bg.clone();
  for (let y = 0; y < bgH; y++) {
    for (let x = 0; x < bgW; x++) {
      const idx = (bgW * y + x) << 2;
      const isDark = thresh.data[y * bgW + x] === 255;
      if (isDark) {
        out.bitmap.data[idx] = 255;
        out.bitmap.data[idx+1] = 0;
        out.bitmap.data[idx+2] = 255;
      } else {
        out.bitmap.data[idx] = 255;
        out.bitmap.data[idx+1] = 255;
        out.bitmap.data[idx+2] = 255;
      }
    }
  }

  await out.write("log_auto_resolve/test_adaptive_1.png");

  src.delete(); gSrc.delete(); blurred.delete(); thresh.delete();
}

testAdaptive().catch(console.error);
