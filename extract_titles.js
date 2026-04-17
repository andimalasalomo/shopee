const axios = require('axios');

async function getTitles() {
    try {
        const res = await axios.get("https://astronaccishop.com/produk", {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = res.data;
        
        // Find titles in HTML. Looking for anything that looks like a product name/title. 
        // Based on the page source structure I saw earlier, they are often in <a> or <h4>/<h3> tags.
        // Let's use regex to find anything that might be an ebook title.
        const matches = html.match(/"title":"([^"]+)"/g);
        if (matches) {
            const uniqueTitles = [...new Set(matches.map(m => m.match(/"title":"([^"]+)"/)[1]))];
            console.log(JSON.stringify(uniqueTitles));
        } else {
            console.log("[]");
        }
    } catch (e) {
        console.error(e.message);
    }
}

getTitles();
