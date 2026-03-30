const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const png2icons = require('png2icons');

const inputPath = path.resolve(__dirname, '../Season Fresh/public/season-fresh-logo.jpeg');
const tempPngPath = path.resolve(__dirname, 'build/icon_temp.png');
const outputPath = path.resolve(__dirname, 'build/icon.ico');

async function convertIcon() {
    try {
        console.log('Loading JPEG with Sharp:', inputPath);
        
        const buildDir = path.dirname(outputPath);
        if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

        // 1. Resize to a 256x256 raw buffer with an alpha channel
        const { data, info } = await sharp(inputPath)
            .resize({ width: 256, height: 256, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        // 2. Flood-fill from edge to make near-white background transparent
        const width = info.width;
        const height = info.height;
        const channels = info.channels; // should be 4 (RGBA)
        
        // Define what constitutes "near white" (accounting for JPEG compression)
        const isWhite = (i) => {
            return data[i] > 235 && data[i+1] > 235 && data[i+2] > 235;
        };

        const visited = new Uint8Array(width * height);
        const queue = [];

        // Add all edge pixels to the starting queue
        for (let x = 0; x < width; x++) {
            queue.push([x, 0]);
            queue.push([x, height - 1]);
        }
        for (let y = 0; y < height; y++) {
            queue.push([0, y]);
            queue.push([width - 1, y]);
        }

        while (queue.length > 0) {
            const [x, y] = queue.pop();
            const idx = y * width + x;
            if (visited[idx]) continue;
            visited[idx] = 1;

            const pIdx = idx * channels;
            
            // If the pixel is near-white or already transparent (from our padding)
            if (data[pIdx + 3] === 0 || isWhite(pIdx)) {
                // Make completely transparent
                data[pIdx + 0] = 255;
                data[pIdx + 1] = 255;
                data[pIdx + 2] = 255;
                data[pIdx + 3] = 0;
                
                // Add neighbors
                if (x > 0) queue.push([x - 1, y]);
                if (x < width - 1) queue.push([x + 1, y]);
                if (y > 0) queue.push([x, y - 1]);
                if (y < height - 1) queue.push([x, y + 1]);
            }
        }

        console.log('Processed flood fill for transparency.');

        // 3. Write modified buffer to PNG
        await sharp(data, {
            raw: {
                width: width,
                height: height,
                channels: channels
            }
        }).png().toFile(tempPngPath);

        console.log('Converting PNG to ICO...');
        const pngBuf = fs.readFileSync(tempPngPath);
        const icoBuf = png2icons.createICO(pngBuf, png2icons.BICUBIC2, 0, false, true);
        
        if (!icoBuf) throw new Error("Failed to create ICO buffer");

        fs.writeFileSync(outputPath, icoBuf);
        console.log('Saved transparent ICO to:', outputPath);

        if (fs.existsSync(tempPngPath)) {
            fs.unlinkSync(tempPngPath);
        }
        console.log('Success! Icon with transparent background generated.');
    } catch (err) {
        console.error('Error converting icon:', err);
    }
}

convertIcon();
