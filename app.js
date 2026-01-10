// Configuration
const CONFIG = {
    GEOJSON_PATH: './accessibility_work_prix_m2_moyenne.geojson',
    MAP_STYLE: 'https://tiles.openfreemap.org/styles/bright',
    INITIAL_ZOOM: 8,
    SELECTED_ZOOM: 12,
    LAYER_IDS: {
        FILL: 'accessibility-fill',
        LINE: 'accessibility-line',
        HIGHLIGHT: 'accessibility-highlight'
    },
    SOURCE_ID: 'accessibility-data',
    TIME_CONFIG: {
        600: { color: '#34C759', label: '10 min' },
        1200: { color: '#FF9500', label: '20 min' },
        1800: { color: '#FF3B30', label: '30 min' }
    }
};

// État de l'application
const state = {
    map: null,
    features: [],
    selectedFeatureId: null,
    searchIndex: [],
    popup: null,
    fuse: null
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

// Formater le prix au m²
function formatPrice(price) {
    if (!price || price === 0 || price === null || isNaN(price)) {
        return 'N/A';
    }
    const priceNum = typeof price === 'string' ? parseFloat(price) : price;
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(priceNum);
}

// Formater le nombre de ventes
function formatVentes(nbVentes) {
    if (!nbVentes || nbVentes === 0 || nbVentes === null) {
        return 'Aucune donnée';
    }
    const venteText = nbVentes === 1 ? 'vente' : 'ventes';
    return `${nbVentes} ${venteText}`;
}

// Formater les min/max
function formatMinMax(minMaxStr) {
    if (!minMaxStr || minMaxStr === '') {
        return '';
    }
    
    if (minMaxStr.includes(';')) {
        const [min, max] = minMaxStr.split(';');
        const minPrice = formatPrice(parseFloat(min));
        const maxPrice = formatPrice(parseFloat(max));
        return `${minPrice} à ${maxPrice}`;
    } else {
        return '';
    }
}

// Initialisation de l'application
async function init() {
    try {
        const data = await loadGeoJSON();
        state.features = data.features;
        
        initMap(data);
        buildSearchIndex();
        initEventListeners();
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
        center: [-1.553621, 47.218371],
        zoom: CONFIG.INITIAL_ZOOM,
        attributionControl: false,
        bearing: 0,
        pitch: 0,
        dragRotate: false,
        touchPitch: false
    });
    
    state.map.keyboard.disable();
    state.map.keyboard.enable();
    state.map.keyboard.disableRotation();

    state.popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'commune-popup'
    });
    
    state.map.on('load', () => {
        state.map.addSource(CONFIG.SOURCE_ID, {
            type: 'geojson',
            data: geojsonData
        });
        
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.FILL,
            type: 'fill',
            source: CONFIG.SOURCE_ID,
            paint: {
                'fill-color': [
                    'case',
                    ['<=', ['get', 'cost_level'], 600], CONFIG.TIME_CONFIG[600].color,
                    ['<=', ['get', 'cost_level'], 1200], CONFIG.TIME_CONFIG[1200].color,
                    CONFIG.TIME_CONFIG[1800].color
                ],
                'fill-opacity': 0.6
            }
        });
        
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.LINE,
            type: 'line',
            source: CONFIG.SOURCE_ID,
            paint: {
                'line-color': [
                    'case',
                    ['<=', ['get', 'cost_level'], 600], '#14B33E',
                    ['<=', ['get', 'cost_level'], 1200], CONFIG.TIME_CONFIG[1200].color,
                    CONFIG.TIME_CONFIG[1800].color
                ],
                'line-width': 1.5,
                'line-opacity': 0.9
            }
        });
        
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.HIGHLIGHT,
            type: 'fill',
            source: CONFIG.SOURCE_ID,
            paint: {
                'fill-color': '#FFFFFF',
                'fill-opacity': 0.3
            },
            filter: ['==', 'ID', '']
        });
        
        state.map.addLayer({
            id: CONFIG.LAYER_IDS.HIGHLIGHT + '-line',
            type: 'line',
            source: CONFIG.SOURCE_ID,
            paint: {
                'line-color': '#FFFFFF',
                'line-width': 3,
                'line-opacity': 1
            },
            filter: ['==', 'ID', '']
        });
        
        state.map.on('click', CONFIG.LAYER_IDS.FILL, handleMapClick);
        state.map.on('click', handleMapBackgroundClick);
        
        state.map.on('mouseenter', CONFIG.LAYER_IDS.FILL, () => {
            state.map.getCanvas().style.cursor = 'pointer';
        });
        state.map.on('mouseleave', CONFIG.LAYER_IDS.FILL, () => {
            state.map.getCanvas().style.cursor = '';
        });
    });
}

// Fonction pour normaliser les chaînes (enlever les accents)
function normalizeString(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Construire l'index de recherche avec Fuse.js
function buildSearchIndex() {
    state.searchIndex = state.features.map(feature => ({
        id: feature.properties.ID,
        nom: feature.properties.NOM,
        nomNormalized: normalizeString(feature.properties.NOM), // Version sans accents
        geometry: feature.geometry
    }));
    
    const options = {
        keys: ['nom', 'nomNormalized'], // Recherche sur les deux versions
        threshold: 0.3,
        ignoreLocation: true,
        minMatchCharLength: 1,
        shouldSort: true
    };

}

// Initialiser les événements UI
function initEventListeners() {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const closeButton = document.getElementById('close-sheet');
    const helpBtn = document.getElementById('help-btn');
    const bottomSheet = document.getElementById('bottom-sheet');
    const handle = bottomSheet.querySelector('.bottom-sheet-handle');
    
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            handleSearch(e.target.value);
        }, 200);
    });
    
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            hideSearchResults();
        }
    });
    
    closeButton.addEventListener('click', closeBottomSheet);
    helpBtn.addEventListener('click', showHelpInfo);
    initBottomSheetDrag(bottomSheet, handle);
}

// Afficher l'info d'aide
function showHelpInfo() {
    const message = "Cette carte affiche les communes accessibles en voiture en 30 minutes maximum depuis un lieu de travail dans le nord-est de Nantes, en conditions de trafic fluide.\n\n" +
                   "• Vert : accessible en 10 min ou moins\n" +
                   "• Orange : accessible entre 10 et 20 min\n" +
                   "• Rouge : accessible entre 20 et 30 min\n\n" +
                   "Cliquez sur une commune pour voir les prix immobiliers moyens.";
    
    alert(message);
}

// Initialiser le drag du bottom sheet
function initBottomSheetDrag(sheet, handle) {
    let startY = 0;
    let currentTranslate = 0;
    let isDragging = false;
    
    const handleStart = (e) => {
        isDragging = true;
        startY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        sheet.style.transition = 'none';
    };
    
    const handleMove = (e) => {
        if (!isDragging) return;
        
        const currentY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        const diff = currentY - startY;
        
        if (diff > 0) {
            currentTranslate = diff;
            sheet.style.transform = `translateX(-50%) translateY(${diff}px)`;
        }
    };
    
    const handleEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        
        sheet.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        
        if (currentTranslate > 100) {
            closeBottomSheet();
        } else {
            sheet.style.transform = 'translateX(-50%) translateY(0)';
        }
        
        currentTranslate = 0;
    };
    
    handle.addEventListener('mousedown', handleStart);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    
    handle.addEventListener('touchstart', handleStart, { passive: true });
    document.addEventListener('touchmove', handleMove, { passive: true });
    document.addEventListener('touchend', handleEnd);
}

// Gérer la recherche avec Fuse.js
function handleSearch(query) {
    const searchResults = document.getElementById('search-results');
    
    
    if (query.length < 1) {
        hideSearchResults();
        return;
    }
    
    searchResults.innerHTML = results.map(result => {
        const item = result.item;
        return `<div class="search-result-item" data-id="${item.id}">${item.nom}</div>`;
    }).join('');
    
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
    
    state.map.setFilter(CONFIG.LAYER_IDS.HIGHLIGHT, ['==', 'ID', featureId]);
    state.map.setFilter(CONFIG.LAYER_IDS.HIGHLIGHT + '-line', ['==', 'ID', featureId]);
    
    showBottomSheet(feature.properties);
}

// Afficher le bottom sheet
function showBottomSheet(properties) {
    const sheet = document.getElementById('bottom-sheet');
    const nameEl = document.getElementById('feature-name');
    const timeEl = document.getElementById('feature-time');
    const prixApptEl = document.getElementById('feature-prix-appt');
    const prixMaisonEl = document.getElementById('feature-prix-maison');
    const minmaxApptEl = document.getElementById('feature-minmax-appt');
    const minmaxMaisonEl = document.getElementById('feature-minmax-maison');
    const ventesApptEl = document.getElementById('feature-ventes-appt');
    const ventesMaisonEl = document.getElementById('feature-ventes-maison');
    
    nameEl.textContent = properties.NOM;
    
    const minutes = secondsToMinutes(properties.cost_level);
    timeEl.textContent = `${minutes} min`;
    
    prixApptEl.textContent = formatPrice(properties.prix_m2_appartement_moy);
    minmaxApptEl.textContent = formatMinMax(properties.min_max_appartement);
    ventesApptEl.textContent = formatVentes(properties.nb_ventes_appartement);
    
    prixMaisonEl.textContent = formatPrice(properties.prix_m2_maison_moy);
    minmaxMaisonEl.textContent = formatMinMax(properties.min_max_maison);
    ventesMaisonEl.textContent = formatVentes(properties.nb_ventes_maison);
    
    sheet.classList.remove('hidden');
}

// Fermer le bottom sheet
function closeBottomSheet() {
    const sheet = document.getElementById('bottom-sheet');
    sheet.classList.add('hidden');
    
    state.selectedFeatureId = null;
    state.map.setFilter(CONFIG.LAYER_IDS.HIGHLIGHT, ['==', 'ID', '']);
    state.map.setFilter(CONFIG.LAYER_IDS.HIGHLIGHT + '-line', ['==', 'ID', '']);
    
    if (state.popup) {
        state.popup.remove();
    }
}

// Calculer le centroïde avec Turf.js
function calculateCentroid(geometry) {
    try {
        const feature = turf.feature(geometry);
        const centroid = turf.centroid(feature);
        return centroid.geometry.coordinates;
    } catch (error) {
        console.error('Erreur calcul centroïde:', error);
        const bounds = getBoundsOfGeometry(geometry);
        return [
            (bounds[0] + bounds[2]) / 2,
            (bounds[1] + bounds[3]) / 2
        ];
    }
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

// Initialiser le tableau
function initTable() {
    tableState.sortedData = state.features
        .map(f => ({
            id: f.properties.ID,
            nom: f.properties.NOM,
            insee: f.properties.INSEE_COM || 'N/A',
            time: f.properties.cost_level,
            geometry: f.geometry
        }))
        .sort((a, b) => {
            if (a.time !== b.time) return a.time - b.time;
            return a.nom.localeCompare(b.nom);
        });
    
    updateCounters();
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
    
    let filteredData = tableState.sortedData;
    if (filterTime === '600') {
        filteredData = tableState.sortedData.filter(c => c.time <= 600);
    } else if (filterTime === '1200') {
        filteredData = tableState.sortedData.filter(c => c.time > 600 && c.time <= 1200);
    } else if (filterTime === '1800') {
        filteredData = tableState.sortedData.filter(c => c.time > 1200);
    }
    
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
    
    toggleBtn.addEventListener('click', openTablePanel);
    closeBtn.addEventListener('click', closeTablePanel);
    
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filterTime = btn.dataset.time;
            renderTable(filterTime);
        });
    });
}

// Démarrer l'application
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}