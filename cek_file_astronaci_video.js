const axios = require('axios');
const fs = require('fs');

const foundLog = 'found_video.log';
const MAX_CONCURRENT = 10;
const GRAPHQL_URL = 'https://graphiql.astronaccishop.com/graphql';

async function checkVideos() {
    console.log(`🚀 Memulai pengecekan VIDEO dari ID 1 sampai 9999...`);
    console.log(`📂 Hasil akan dicatat di: ${foundLog}\n`);

    for (let i = 1; i <= 9999; i += MAX_CONCURRENT) {
        const promises = [];

        for (let j = 0; j < MAX_CONCURRENT && (i + j) <= 9999; j++) {
            const id = i + j;
            
            const data = JSON.stringify({
                query: `query GetplaylistVideosByIds($in: [Int!]!) {
  playlistVideos(filter: {playlistId: {in: $in}}) {
    nodes {
      video {
        linkVideo    
        description
        createdAt
        playlistId
        status
        title
        urlTitle
        seq
        __typename
      }
      id
      playlistId
      __typename
    }
    totalCount
    __typename
  }
}`,
                variables: { "in": [id] }
            });

            const config = {
                method: 'post',
                url: GRAPHQL_URL,
                headers: { 
                    'accept': '*/*', 
                    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7', 
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
                    .then(response => {
                        const nodes = response.data?.data?.playlistVideos?.nodes || [];
                        if (nodes.length > 0) {
                            nodes.forEach(node => {
                                if (node.video && node.video.linkVideo) {
                                    const logMsg = `[ID ${id}] ${node.video.title} -> ${node.video.linkVideo}\n`;
                                    console.log('\x1b[36m%s\x1b[0m', logMsg.trim());
                                    fs.appendFileSync(foundLog, logMsg);
                                }
                            });
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

    console.log("\n\n✅ Selesai mengecek semua video.");
}

checkVideos();
