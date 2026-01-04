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
    SOURCE_ID: 'accessibility-data',
    // Configuration des temps et couleurs
    TIME_CONFIG: {
        600: { color: '#34C759', label: '10 min' },      // Vert
        1200: { color: '#FF9500', label: '20 min' },     // Orange
        1800: { color: '#FF3B30', label: '30 min' }      // Rouge
    }
};

// État de l'application
const state = {
    map: null,
    features: [],
    selectedFeatureId: null,
    searchIndex: [],
    popup: null
};

// État du tableau
const tableState = {
    currentFilter: 'all',
    sortedData: []
};

// Convertir les secondes en minutes
function secondsToMinutes(seconds) {
    return Math.round(seconds / 60);
}

// Obtenir la configuration pour un temps donné
function getTimeConfig(seconds) {
    if (seconds <= 600) {
        return CONFIG.TIME_CONFIG[600];
    } else if (seconds <= 1200) {
        return CONFIG.TIME_CONFIG[1200];
    } else {
        return CONFIG.TIME_CONFIG[1800];
    }
}

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
        
        // Initialiser le tableau
        initTable();
        initTableEventListeners();
        
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
        center: [2.3, 47.0],
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
        
        // Layer fill (polygones) avec couleurs selon cost_level
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.FILL,
            type: 'fill',
            source: CONFIG.SOURCE_ID,
            paint: {
                'fill-color': [
                    'case',
                    ['<=', ['get', 'cost_level_min'], 600], CONFIG.TIME_CONFIG[600].color,
                    ['<=', ['get', 'cost_level_min'], 1200], CONFIG.TIME_CONFIG[1200].color,
                    CONFIG.TIME_CONFIG[1800].color
                ],
                'fill-opacity': 0.6
            }
        });
        
        // Layer line (contours) avec couleurs selon cost_level
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.LINE,
            type: 'line',
            source: CONFIG.SOURCE_ID,
            paint: {
                'line-color': [
                    'case',
                    ['<=', ['get', 'cost_level_min'], 600], CONFIG.TIME_CONFIG[600].color,
                    ['<=', ['get', 'cost_level_min'], 1200], CONFIG.TIME_CONFIG[1200].color,
                    CONFIG.TIME_CONFIG[1800].color
                ],
                'line-width': 1.5,
                'line-opacity': 0.9
            }
        });
        
        // Layer highlight (sélection)
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.HIGHLIGHT,
            type: 'fill',
            source: CONFIG.SOURCE_ID,
            paint: {
                'fill-color': '#FFD700',
                'fill-opacity': 0.7
            },
            filter: ['==', 'ID', '']
        });
        
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.HIGHLIGHT + '-line',
            type: 'line',
            source: CONFIG.SOURCE_ID,
            paint: {
                'line-color': '#FFD700',
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
    ).slice(0, 10);
    
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
        
        // Afficher la popup avec le nom
        state.popup
            .setLngLat(e.lngLat)
            .setHTML(`<strong>${nom}</strong>`)
            .addTo(state.map);
        
        selectFeature(feature);
    }
}

// Gérer le clic sur le fond de carte
function handleMapBackgroundClick(e) {
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
    const timeEl = document.getElementById('feature-time');
    
    nameEl.textContent = properties.NOM;
    
    // Afficher le temps en minutes depuis cost_level
    const minutes = secondsToMinutes(properties.cost_level_min);
    timeEl.textContent = `${minutes} min`;
    
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
    
    // Fermer la popup
    if (state.popup) {
        state.popup.remove();
    }
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

// ========================================
// FONCTIONS DU TABLEAU
// ========================================

// Initialiser le tableau
function initTable() {
    // Préparer les données triées
    tableState.sortedData = state.features
        .map(f => ({
            id: f.properties.ID,
            nom: f.properties.NOM,
            insee: f.properties.INSEE_COM || 'N/A',
            time: f.properties.cost_level_min,
            geometry: f.geometry
        }))
        .sort((a, b) => {
            // Trier par temps puis par nom
            if (a.time !== b.time) return a.time - b.time;
            return a.nom.localeCompare(b.nom);
        });
    
    // Calculer les compteurs
    updateCounters();
    
    // Afficher toutes les communes
    renderTable('all');
}

// Mettre à jour les compteurs
function updateCounters() {
    const count600 = tableState.sortedData.filter(c => c.time <= 600).length;
    const count1200 = tableState.sortedData.filter(c => c.time > 600 && c.time <= 1200).length;
    const count1800 = tableState.sortedData.filter(c => c.time > 1200).length;
    const countAll = tableState.sortedData.length;
    
    document.getElementById('count-600').textContent = count600;
    document.getElementById('count-1200').textContent = count1200;
    document.getElementById('count-1800').textContent = count1800;
    document.getElementById('count-all').textContent = countAll;
}

// Afficher le tableau
function renderTable(filterTime) {
    const tbody = document.getElementById('table-body');
    tableState.currentFilter = filterTime;
    
    // Filtrer les données
    let filteredData = tableState.sortedData;
    if (filterTime === '600') {
        filteredData = tableState.sortedData.filter(c => c.time <= 600);
    } else if (filterTime === '1200') {
        filteredData = tableState.sortedData.filter(c => c.time > 600 && c.time <= 1200);
    } else if (filterTime === '1800') {
        filteredData = tableState.sortedData.filter(c => c.time > 1200);
    }
    
    // Générer le HTML
    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="table-empty">Aucune commune trouvée</td></tr>';
        return;
    }
    
    tbody.innerHTML = filteredData.map(commune => {
        const minutes = secondsToMinutes(commune.time);
        const timeClass = commune.time <= 600 ? 'time-600' : 
                         commune.time <= 1200 ? 'time-1200' : 'time-1800';
        
        return `
            <tr data-id="${commune.id}">
                <td class="commune-name">${commune.nom}</td>
                <td class="commune-insee">${commune.insee}</td>
                <td><span class="time-badge ${timeClass}">${minutes} min</span></td>
            </tr>
        `;
    }).join('');
    
    // Ajouter les événements de clic
    tbody.querySelectorAll('tr').forEach(row => {
        const communeId = row.dataset.id;
        if (communeId) {
            row.addEventListener('click', () => {
                selectFeatureById(communeId);
                closeTablePanel();
            });
        }
    });
}

// Ouvrir le panneau tableau
function openTablePanel() {
    document.getElementById('table-panel').classList.remove('hidden');
}

// Fermer le panneau tableau
function closeTablePanel() {
    document.getElementById('table-panel').classList.add('hidden');
}

// Initialiser les événements du tableau
function initTableEventListeners() {
    const toggleBtn = document.getElementById('toggle-table-btn');
    const closeBtn = document.getElementById('close-table-btn');
    const filterBtns = document.querySelectorAll('.filter-btn');
    
    // Ouvrir/fermer le panneau
    toggleBtn.addEventListener('click', openTablePanel);
    closeBtn.addEventListener('click', closeTablePanel);
    
    // Filtres
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Retirer la classe active de tous les boutons
            filterBtns.forEach(b => b.classList.remove('active'));
            // Ajouter la classe active au bouton cliqué
            btn.classList.add('active');
            // Afficher les données filtrées
            const filterTime = btn.dataset.time;
            renderTable(filterTime);
        });
    });
}

// Démarrer l'application au chargement de la page
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}