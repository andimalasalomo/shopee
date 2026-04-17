const axios = require('axios');
const fs = require('fs');
const path = require('path');

const foundLog = 'found.log';
const pdfFolder = 'pdf';
const MAX_CONCURRENT = 10;
const GRAPHQL_URL = 'https://graphiql.astronaccishop.com/graphql';
const PDF_BASE_URL = 'https://graphiql.astronaccishop.com/uploads/pdf/';

// Pastikan folder pdf ada
if (!fs.existsSync(pdfFolder)) {
    fs.mkdirSync(pdfFolder);
}

async function downloadPdf(filename) {
    const url = `${PDF_BASE_URL}${filename}`;
    const filePath = path.join(pdfFolder, filename);

    if (fs.existsSync(filePath)) {
        console.log(`[SKIP] ${filename} sudah ada.`);
        return;
    }

    try {
        console.log(`⏳ Downloading: ${filename}...`);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (err) {
        console.error(`❌ Gagal download ${filename}: ${err.message}`);
    }
}

async function checkFiles() {
    console.log(`🚀 Memulai pengecekan GraphQL dari ID 1 sampai 9999...`);
    console.log(`📂 Hasil dicatat di: ${foundLog}`);
    console.log(`📥 Download folder: ${pdfFolder}\n`);

    for (let i = 1; i <= 9999; i += MAX_CONCURRENT) {
        const promises = [];

        for (let j = 0; j < MAX_CONCURRENT && (i + j) <= 9999; j++) {
            const id = i + j;

            const data = JSON.stringify({
                query: `query GetplaylistPdfsByIds($in: [Int!]!) {
  playlistPdfs(filter: {playlistId: {in: $in}}) {
    nodes {
      pdf {
        filePdf
        title
      }
      id
      playlistId
    }
  }
}`,
                variables: { "in": [id] }
            });

            const config = {
                method: 'post',
                url: GRAPHQL_URL,
                headers: {
                    'accept': '*/*',
                    'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYXNob3BfcGVyc29uIiwicGVyc29uX3V1aWQiOiI4MjU0NGQ3ZS1jNjY0LTQ5ODYtODFiNS1iYTlkMDIzOGI3MDYiLCJmdWxsbmFtZSI6IlJvYmJ5IEFuYml5YSIsInBlcnNvbl9lbWFpbCI6InJvYmJ5LmFuYml5YUBnbWFpbC5jb20iLCJlbWFpbCI6InJvYmJ5LmFuYml5YUBnbWFpbC5jb20iLCJleHAiOjE3Nzg5MjAyNDYsImxldmVsX3BlcnNvbiI6bnVsbCwiaWF0IjoxNzc2MzI4MjQ2LCJhdWQiOiJwb3N0Z3JhcGhpbGUiLCJpc3MiOiJwb3N0Z3JhcGhpbGUifQ.-AlKHiUivjcJcf0-vCpUF-wkFQjZwThxiD3QAsErFCA',
                    'content-type': 'application/json',
                    'origin': 'https://astronaccishop.com',
                    'referer': 'https://astronaccishop.com/',
                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
                },
                data: data
            };

            promises.push(
                axios.request(config)
                    .then(async (response) => {
                        const nodes = response.data?.data?.playlistPdfs?.nodes || [];
                        if (nodes.length > 0) {
                            for (const node of nodes) {
                                if (node.pdf && node.pdf.filePdf) {
                                    const logMsg = `[ID ${id}] ${node.pdf.filePdf}\n`;
                                    console.log('\x1b[32m%s\x1b[0m', logMsg.trim());
                                    fs.appendFileSync(foundLog, logMsg);

                                    // Download file
                                    await downloadPdf(node.pdf.filePdf);
                                }
                            }
                        }
                    })
                    .catch(() => {
                        // ignore error
                    })
            );
        }

        await Promise.all(promises);

        if (i % 100 === 1) {
            process.stdout.write(`\r⏳ Progress: ${i - 1 + MAX_CONCURRENT}/9999...`);
        }
    }

    console.log("\n\n✅ Selesai.");
}

checkFiles();
