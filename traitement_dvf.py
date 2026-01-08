import pandas as pd
import geopandas as gpd
import os

# --- CONFIGURATION DYNAMIQUE DES CHEMINS ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PATH_DVF = os.path.join(BASE_DIR, "dvf.csv.gz")
PATH_GEOJSON = os.path.join(BASE_DIR, "accessibility_work.geojson")
OUTPUT_GEOJSON = os.path.join(BASE_DIR, "accessibility_work_prix_m2.geojson")

def process_dvf_data():
    if not os.path.exists(PATH_DVF) or not os.path.exists(PATH_GEOJSON):
        print("❌ Fichiers sources manquants.")
        return

    # --- ÉTAPE 1 : Chargement GeoJSON ---
    print("✅ Chargement du GeoJSON...")
    gdf = gpd.read_file(PATH_GEOJSON)
    gdf['INSEE_COM'] = gdf['INSEE_COM'].astype(str).str.zfill(5)
    list_insee = gdf['INSEE_COM'].unique()

    # --- ÉTAPE 2 : Lecture du DVF ---
    print("✅ Lecture de dvf.csv.gz...")
    df = pd.read_csv(PATH_DVF, sep=',', low_memory=False)

    # --- ÉTAPE 3 : Filtrage ---
    print("✅ Filtrage (Communes + Type Local + Nature Mutation)...")
    df['code_commune'] = df['code_commune'].astype(str).str.zfill(5)
    
    # Seules les ventes et VEFA sont conservées [cite: 7, 76]
    natures_valides = ["Vente", "Vente en l'état futur d'achèvement"]

    mask = (
        (df['code_commune'].isin(list_insee)) &
        (df['nature_mutation'].isin(natures_valides)) &
        (df['valeur_fonciere'] > 0) &
        (df['surface_reelle_bati'] > 0) &
        (df['code_type_local'].isin([1, 2])) # 1: Maison, 2: Appartement [cite: 63]
    )
    df_filtered = df[mask].copy()

    # --- ÉTAPE 4 : Agrégation par mutation ---
    # On regroupe par mutation pour sommer les surfaces de chaque local [cite: 40, 52]
    # et ne prendre qu'une seule fois la valeur foncière répétée [cite: 42]
    print("✅ Agrégation par mutation...")
    df_agg = df_filtered.groupby(['id_mutation', 'code_commune', 'code_type_local']).agg({
        'valeur_fonciere': 'first', 
        'surface_reelle_bati': 'sum'
    }).reset_index()

    # --- ÉTAPE 5 : Calcul du prix au m² ---
    df_agg['prix_m2'] = df_agg['valeur_fonciere'] / df_agg['surface_reelle_bati']
    
    # --- ÉTAPE 6 : Statistiques communales (MÉDIANE + COMPTAGE) ---
    print("✅ Calcul des médianes et volumes de ventes par commune...")
    
    # Calcul de la médiane
    medianes = df_agg.groupby(['code_commune', 'code_type_local'])['prix_m2'].median().unstack()
    medianes = medianes.rename(columns={1: 'prix_m2_maison', 2: 'prix_m2_appartement'})
    
    # Calcul du nombre de ventes (id_mutation uniques)
    comptage = df_agg.groupby(['code_commune', 'code_type_local'])['id_mutation'].count().unstack()
    comptage = comptage.rename(columns={1: 'nb_ventes_maison', 2: 'nb_ventes_appartement'})
    
    # Fusion des statistiques
    stats = pd.concat([medianes, comptage], axis=1).reset_index()

    # --- ÉTAPE 7 : Jointure ---
    print("✅ Jointure avec le GeoJSON...")
    gdf_final = gdf.merge(stats, left_on='INSEE_COM', right_on='code_commune', how='left')
    
    if 'code_commune' in gdf_final.columns:
        gdf_final = gdf_final.drop(columns=['code_commune'])

    # --- ÉTAPE 8 : Export ---
    print(f"✅ Sauvegarde vers {OUTPUT_GEOJSON}...")
    # Remplacement des NaN par 0 pour les colonnes de comptage
    cols_ventes = ['nb_ventes_maison', 'nb_ventes_appartement']
    gdf_final[cols_ventes] = gdf_final[cols_ventes].fillna(0).astype(int)
    
    gdf_final.to_file(OUTPUT_GEOJSON, driver='GeoJSON')
    print(f"🚀 Terminé ! Colonnes ajoutées : prix_m2_... et nb_ventes_...")

if __name__ == "__main__":
    process_dvf_data()