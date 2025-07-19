// Krok 1: Importowanie potrzebnych modułów
const express = require('express');
const axios = require('axios');
const path = require('path');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Zwiększenie limitu dla danych JSON, aby zmieścić obraz w Base64
app.use(express.json({ limit: '10mb' }));

const apiKey = process.env.GOOGLE_API_KEY;
const searchEngineId = process.env.GOOGLE_CX;

if (!apiKey || !searchEngineId) {
    console.error("Błąd: Brak klucza GOOGLE_API_KEY lub GOOGLE_CX w pliku .env");
    process.exit(1);
}

// Inicjalizacja klienta Vision API
const visionClient = new ImageAnnotatorClient();

app.use(express.static(path.join(__dirname, 'public')));

// Endpoint dla wyszukiwania tekstowego
app.get('/api/search', async (req, res) => {
    // Dodano 'author' do pobieranych parametrów
    const { q, siteSearch, fileType, exclude, excludeSite, searchType, lr, author } = req.query;
    if (!q) return res.status(400).json({ error: 'Parametr "q" (zapytanie) jest wymagany.' });
    
    let finalQuery = q;
    if (siteSearch) finalQuery += ` site:${siteSearch}`;
    if (fileType) finalQuery += ` filetype:${fileType}`;
    if (exclude) finalQuery += ` ${exclude.split(' ').filter(w => w).map(w => `-${w.trim()}`).join(' ')}`;
    if (excludeSite) finalQuery += ` ${excludeSite.split(' ').filter(s => s).map(s => `-site:${s.trim()}`).join(' ')}`;
    if (searchType === 'sound') finalQuery += ` filetype:mp3 OR filetype:wav OR filetype:ogg`;
    // Nowa logika dodająca autora do zapytania (w cudzysłowie dla dokładnego dopasowania)
    if (author) finalQuery += ` "${author}"`;

    const apiUrl = `https://www.googleapis.com/customsearch/v1`;
    const params = { key: apiKey, cx: searchEngineId, q: finalQuery };
    if (lr) params.lr = lr;
    if (searchType === 'image') params.searchType = 'image';

    try {
        const googleResponse = await axios.get(apiUrl, { params });
        const items = googleResponse.data.items || [];
        let results;
        if (searchType === 'image') {
            results = items.map(item => ({
                source_title: item.title,
                imageUrl: item.link,
                contextUrl: item.image.contextLink,
                snippet: item.snippet
            }));
        } else {
            results = items.map(item => ({
                source_title: item.title,
                url: item.link,
                snippet: item.snippet,
                publication_time: item.pagemap?.metatags?.[0]?.['article:published_time'] || null
            }));
        }
        res.json({ results });
    } catch (error) {
        console.error("Błąd podczas komunikacji z Google Search API:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Wystąpił błąd po stronie serwera.' });
    }
});

// Endpoint dla wyszukiwania obrazem
app.post('/api/search-by-image', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'Brak danych obrazu.' });
        }

        const [visionResult] = await visionClient.webDetection({
            image: { content: image },
        });

        const webDetection = visionResult.webDetection;
        if (!webDetection || !webDetection.webEntities || webDetection.webEntities.length === 0) {
            return res.json({ results: [] });
        }

        const searchQuery = webDetection.webEntities
            .slice(0, 3)
            .map(entity => entity.description)
            .join(' ');
            
        if (!searchQuery) {
             return res.json({ results: [] });
        }

        const searchParams = {
            key: apiKey,
            cx: searchEngineId,
            q: searchQuery,
            searchType: 'image'
        };

        const searchResponse = await axios.get('https://www.googleapis.com/customsearch/v1', { params: searchParams });
        const items = searchResponse.data.items || [];
        
        const results = items.map(item => ({
            source_title: item.title,
            imageUrl: item.link,
            contextUrl: item.image.contextLink,
            snippet: item.snippet
        }));

        res.json({ results });

    } catch (error) {
        console.error('Błąd w /api/search-by-image:', error);
        res.status(500).json({ error: 'Wystąpił błąd podczas analizy obrazu.' });
    }
});


app.listen(PORT, () => {
    console.log(`Serwer uruchomiony na porcie ${PORT}`);
    console.log(`Przejdź do http://localhost:${PORT} w swojej przeglądarce.`);
});

