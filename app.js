// Configuration
const CONFIG = {
    GEOJSON_PATH: './accessibility_work.geojson',
    MAP_STYLE: 'https://tiles.openfreemap.org/styles/bright',
    INITIAL_ZOOM: 8,
    SELECTED_ZOOM: 12,
    LAYER_IDS: {
        FILL: 'accessibility-fill',
        LINE: 'accessibility-line',
        HIGHLIGHT: 'accessibility-highlight'
    },
    SOURCE_ID: 'accessibility-data'
};


// État de l'application
const state = {
    map: null,
    features: [],
    selectedFeatureId: null,
    searchIndex: [],
    popup: null  // <-- AJOUT : référence à la popup
};

// Initialisation de l'application
async function init() {
    try {
        // Charger les données GeoJSON
        const data = await loadGeoJSON();
        state.features = data.features;
        
        // Initialiser la carte
        initMap(data);
        
        // Construire l'index de recherche
        buildSearchIndex();
        
        // Initialiser les événements
        initEventListeners();
        
    } catch (error) {
        showError(`Erreur lors du chargement: ${error.message}`);
        console.error('Erreur d\'initialisation:', error);
    }
}

// Charger le GeoJSON
async function loadGeoJSON() {
    const response = await fetch(CONFIG.GEOJSON_PATH);
    
    if (!response.ok) {
        throw new Error(`Impossible de charger ${CONFIG.GEOJSON_PATH} (${response.status})`);
    }
    
    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
        throw new Error('Le fichier GeoJSON ne contient aucune commune');
    }
    
    return data;
}

// Initialiser la carte MapLibre
function initMap(geojsonData) {
    state.map = new maplibregl.Map({
        container: 'map',
        style: CONFIG.MAP_STYLE,
        center: [2.3, 47.0], // Centre France par défaut
        zoom: CONFIG.INITIAL_ZOOM
    });

    state.popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'commune-popup'
    });
    
    state.map.on('load', () => {
        // Ajouter la source
        state.map.addSource(CONFIG.SOURCE_ID, {
            type: 'geojson',
            data: geojsonData
        });
        
        // Layer fill (polygones)
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.FILL,
            type: 'fill',
            source: CONFIG.SOURCE_ID,
            paint: {
                'fill-color': '#007AFF',
                'fill-opacity': 0.35
            }
        });
        
        // Layer line (contours)
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.LINE,
            type: 'line',
            source: CONFIG.SOURCE_ID,
            paint: {
                'line-color': '#007AFF',
                'line-width': 1.5,
                'line-opacity': 0.8
            }
        });
        
        // Layer highlight (sélection)
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.HIGHLIGHT,
            type: 'fill',
            source: CONFIG.SOURCE_ID,
            paint: {
                'fill-color': '#FF9500',
                'fill-opacity': 0.6
            },
            filter: ['==', 'ID', '']
        });
        
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.HIGHLIGHT + '-line',
            type: 'line',
            source: CONFIG.SOURCE_ID,
            paint: {
                'line-color': '#FF9500',
                'line-width': 3,
                'line-opacity': 1
            },
            filter: ['==', 'ID', '']
        });
        
        // Fit bounds initial
        const bounds = getBounds(geojsonData);
        state.map.fitBounds(bounds, {
            padding: { top: 50, bottom: 50, left: 30, right: 30 },
            maxZoom: 10
        });
        
        // Événements de clic sur la carte
        state.map.on('click', CONFIG.LAYER_IDS.FILL, handleMapClick);
        state.map.on('click', handleMapBackgroundClick);
        
        // Curseur pointer sur les polygones
        state.map.on('mouseenter', CONFIG.LAYER_IDS.FILL, () => {
            state.map.getCanvas().style.cursor = 'pointer';
        });
        state.map.on('mouseleave', CONFIG.LAYER_IDS.FILL, () => {
            state.map.getCanvas().style.cursor = '';
        });
    });
}

// Construire l'index de recherche
function buildSearchIndex() {
    state.searchIndex = state.features.map(feature => ({
        id: feature.properties.ID,
        nom: feature.properties.NOM,
        nomLower: feature.properties.NOM.toLowerCase(),
        geometry: feature.geometry
    }));
}

// Initialiser les événements UI
function initEventListeners() {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const closeButton = document.getElementById('close-sheet');
    
    // Recherche avec debounce
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            handleSearch(e.target.value);
        }, 200);
    });
    
    // Fermer les résultats si clic ailleurs
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            hideSearchResults();
        }
    });
    
    // Bouton fermer
    closeButton.addEventListener('click', closeBottomSheet);
}

// Gérer la recherche
function handleSearch(query) {
    const searchResults = document.getElementById('search-results');
    
    if (query.length < 2) {
        hideSearchResults();
        return;
    }
    
    const queryLower = query.toLowerCase();
    const matches = state.searchIndex.filter(item => 
        item.nomLower.includes(queryLower)
    ).slice(0, 10); // Limiter à 10 résultats
    
    if (matches.length === 0) {
        searchResults.innerHTML = '<div class="search-no-results">Aucune commune trouvée</div>';
        searchResults.classList.remove('hidden');
        return;
    }
    
    searchResults.innerHTML = matches.map(item => 
        `<div class="search-result-item" data-id="${item.id}">${item.nom}</div>`
    ).join('');
    
    // Ajouter les événements de clic
    searchResults.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
            const featureId = el.dataset.id;
            selectFeatureById(featureId);
            hideSearchResults();
            document.getElementById('search-input').value = el.textContent;
        });
    });
    
    searchResults.classList.remove('hidden');
}

// Masquer les résultats de recherche
function hideSearchResults() {
    document.getElementById('search-results').classList.add('hidden');
}

// Gérer le clic sur un polygone
function handleMapClick(e) {
    e.preventDefault();
    
    if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const nom = feature.properties.NOM;
        
        // AJOUT : Afficher la popup avec le nom
        state.popup
            .setLngLat(e.lngLat)
            .setHTML(`<strong>${nom}</strong>`)
            .addTo(state.map);
        
        selectFeature(feature);
    }
}

// Gérer le clic sur le fond de carte
function handleMapBackgroundClick(e) {
    // Vérifier qu'on n'a pas cliqué sur un polygone
    const features = state.map.queryRenderedFeatures(e.point, {
        layers: [CONFIG.LAYER_IDS.FILL]
    });
    
    if (features.length === 0) {
        closeBottomSheet();
    }
}

// Sélectionner une feature par ID
function selectFeatureById(featureId) {
    const feature = state.features.find(f => f.properties.ID === featureId);
    if (feature) {
        selectFeature(feature);
        
        // Calculer le centroïde et voler vers lui
        const centroid = calculateCentroid(feature.geometry);
        state.map.flyTo({
            center: centroid,
            zoom: CONFIG.SELECTED_ZOOM,
            duration: 1500
        });
    }
}

// Sélectionner une feature
function selectFeature(feature) {
    const featureId = feature.properties.ID;
    state.selectedFeatureId = featureId;
    
    // Mettre à jour le filtre de surbrillance
    state.map.setFilter(CONFIG.LAYER_IDS.HIGHLIGHT, ['==', 'ID', featureId]);
    state.map.setFilter(CONFIG.LAYER_IDS.HIGHLIGHT + '-line', ['==', 'ID', featureId]);
    
    // Afficher le bottom sheet
    showBottomSheet(feature.properties);
}

// Afficher le bottom sheet
function showBottomSheet(properties) {
    const sheet = document.getElementById('bottom-sheet');
    const nameEl = document.getElementById('feature-name');
    const idEl = document.getElementById('feature-id');
    
    nameEl.textContent = properties.NOM;
    idEl.textContent = properties.ID;
    
    sheet.classList.remove('hidden');
}

// Fermer le bottom sheet
function closeBottomSheet() {
    const sheet = document.getElementById('bottom-sheet');
    sheet.classList.add('hidden');
    
    // Retirer la surbrillance
    state.selectedFeatureId = null;
    state.map.setFilter(CONFIG.LAYER_IDS.HIGHLIGHT, ['==', 'ID', '']);
    state.map.setFilter(CONFIG.LAYER_IDS.HIGHLIGHT + '-line', ['==', 'ID', '']);
}

// Calculer le centroïde d'une géométrie
function calculateCentroid(geometry) {
    if (geometry.type === 'Polygon') {
        return getCentroidOfPolygon(geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
        // Trouver le plus grand polygone
        let largestPolygon = geometry.coordinates[0][0];
        let largestArea = 0;
        
        geometry.coordinates.forEach(poly => {
            const area = calculatePolygonArea(poly[0]);
            if (area > largestArea) {
                largestArea = area;
                largestPolygon = poly[0];
            }
        });
        
        return getCentroidOfPolygon(largestPolygon);
    }
    
    // Fallback: centre de la bbox
    const bounds = getBoundsOfGeometry(geometry);
    return [
        (bounds[0] + bounds[2]) / 2,
        (bounds[1] + bounds[3]) / 2
    ];
}

// Centroïde d'un polygone (moyenne des coordonnées)
function getCentroidOfPolygon(coordinates) {
    let sumLon = 0;
    let sumLat = 0;
    const count = coordinates.length;
    
    coordinates.forEach(coord => {
        sumLon += coord[0];
        sumLat += coord[1];
    });
    
    return [sumLon / count, sumLat / count];
}

// Calculer l'aire approximative d'un polygone
function calculatePolygonArea(coordinates) {
    let area = 0;
    const n = coordinates.length;
    
    for (let i = 0; i < n - 1; i++) {
        area += coordinates[i][0] * coordinates[i + 1][1];
        area -= coordinates[i + 1][0] * coordinates[i][1];
    }
    
    return Math.abs(area / 2);
}

// Obtenir les bounds d'une géométrie
function getBoundsOfGeometry(geometry) {
    let minLon = Infinity, minLat = Infinity;
    let maxLon = -Infinity, maxLat = -Infinity;
    
    const processCoordinates = (coords) => {
        if (typeof coords[0] === 'number') {
            // C'est un point [lon, lat]
            minLon = Math.min(minLon, coords[0]);
            maxLon = Math.max(maxLon, coords[0]);
            minLat = Math.min(minLat, coords[1]);
            maxLat = Math.max(maxLat, coords[1]);
        } else {
            coords.forEach(processCoordinates);
        }
    };
    
    processCoordinates(geometry.coordinates);
    return [minLon, minLat, maxLon, maxLat];
}

// Obtenir les bounds du GeoJSON complet
function getBounds(geojsonData) {
    let minLon = Infinity, minLat = Infinity;
    let maxLon = -Infinity, maxLat = -Infinity;
    
    geojsonData.features.forEach(feature => {
        const bounds = getBoundsOfGeometry(feature.geometry);
        minLon = Math.min(minLon, bounds[0]);
        minLat = Math.min(minLat, bounds[1]);
        maxLon = Math.max(maxLon, bounds[2]);
        maxLat = Math.max(maxLat, bounds[3]);
    });
    
    return [[minLon, minLat], [maxLon, maxLat]];
}

// Afficher une erreur
function showError(message) {
    const errorEl = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    
    errorText.textContent = message;
    errorEl.classList.remove('hidden');
    
    setTimeout(() => {
        errorEl.classList.add('hidden');
    }, 5000);
}

// Démarrer l'application au chargement de la page
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}