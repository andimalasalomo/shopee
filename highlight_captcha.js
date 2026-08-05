const sharp = require('sharp');
const fs = require('fs');

/**
 * Program to highlight captcha holes with red color.
 * This script detects dark regions in the captcha image (the "holes")
 * and overlays them with a red tint.
 */
async function highlightCaptchaHoles(inputPath, outputPath) {
    try {
        console.log(`Processing ${inputPath}...`);
        
        // 1. Load the original image and get metadata
        const original = sharp(inputPath);
        const { width, height } = await original.metadata();

        // 2. Create a clean mask to identify the holes.
        // We use a combination of grayscale, thresholding, and blurring 
        // to isolate the dark puzzle holes while ignoring small noise.
        const mask = await original
            .clone()
            .greyscale()
            .threshold(70)    // Initial threshold to find dark areas
            .negate()         // Invert: holes become white (255)
            .median(3)        // Remove small speckle noise
            .blur(2)          // Soften edges
            .threshold(128)   // Re-threshold to get a solid shape
            .toBuffer();

        // 3. Create a premium red overlay (Vibrant Red)
        const redOverlay = await sharp({
            create: {
                width: width,
                height: height,
                channels: 4,
                background: { r: 220, g: 20, b: 60, alpha: 0.9 } // Crimson Red
            }
        })
        .png()
        .toBuffer();

        // 4. Composite the red overlay onto the original image using the mask
        await sharp(inputPath)
            .composite([
                {
                    input: redOverlay,
                    blend: 'over',
                    mask: mask
                }
            ])
            .toFile(outputPath);

        console.log(`Success! Result saved to: ${outputPath}`);
    } catch (error) {
        console.error('Error processing captcha:', error);
    }
}

// Run the function
const inputFile = 'captcha.jpg';
const outputFile = 'captcha_red.jpg';

if (fs.existsSync(inputFile)) {
    highlightCaptchaHoles(inputFile, outputFile);
} else {
    console.error(`File ${inputFile} not found. Please make sure it exists in the current directory.`);
}
