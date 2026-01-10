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

    # --- ÉTAPE 3 : Filtrage initial ---
    print("✅ Filtrage initial (Communes + Type Local)...")
    df['code_commune'] = df['code_commune'].astype(str).str.zfill(5)
    
    natures_valides = ["Vente", "Vente en l'état futur d'achèvement"]
    mask = (
        (df['code_commune'].isin(list_insee)) &
        (df['nature_mutation'].isin(natures_valides)) &
        (df['valeur_fonciere'] > 0) &
        (df['surface_reelle_bati'] > 0) &
        (df['code_type_local'].isin([1, 2])) 
    )
    df_filtered = df[mask].copy()

    # --- ÉTAPE 4 : Exclusion des ventes en bloc (Multi-lignes à prix identique) ---
    print("✅ Exclusion des ventes en bloc (multi-lots)...")
    check_bloc = df_filtered.groupby('id_mutation').agg({
        'valeur_fonciere': ['count', 'nunique']
    })
    check_bloc.columns = ['nb_lignes', 'nb_prix_uniques']
    ids_en_bloc = check_bloc[(check_bloc['nb_lignes'] > 1) & (check_bloc['nb_prix_uniques'] == 1)].index
    df_filtered = df_filtered[~df_filtered['id_mutation'].isin(ids_en_bloc)]

    # --- ÉTAPE 5 : Agrégation par mutation ---
    print("✅ Agrégation par mutation...")
    df_agg = df_filtered.groupby(['id_mutation', 'code_commune', 'code_type_local']).agg({
        'valeur_fonciere': 'first', 
        'surface_reelle_bati': 'sum'
    }).reset_index()
    df_agg['prix_m2'] = df_agg['valeur_fonciere'] / df_agg['surface_reelle_bati']

    # --- ÉTAPE 6 : Filtrage des 2.5% extrêmes (95% centraux) ---
    print("✅ Application de la fourchette (95% centraux)...")
    def filter_extremes(group):
        if len(group) < 5:
            return group
        low = group['prix_m2'].quantile(0.025)
        high = group['prix_m2'].quantile(0.975)
        return group[(group['prix_m2'] >= low) & (group['prix_m2'] <= high)]

    df_cleaned = df_agg.groupby(['code_commune', 'code_type_local'], group_keys=False).apply(filter_extremes)

    # --- ÉTAPE 7 : Statistiques finales ---
    print("✅ Calcul des statistiques et formatage min;max...")
    stats = df_cleaned.groupby(['code_commune', 'code_type_local']).agg({
        'prix_m2': ['mean', 'min', 'max'],
        'id_mutation': 'count'
    }).reset_index()

    stats.columns = ['code_commune', 'code_type_local', 'prix_m2_moy', 'pm2_min', 'pm2_max', 'nb_ventes']

    # Logique pour la chaîne min_max : 
    # Si min == max (une seule vente ou prix identiques), on ne met qu'une valeur.
    def format_min_max(row):
        p_min = int(round(row['pm2_min'], 0))
        p_max = int(round(row['pm2_max'], 0))
        if p_min == p_max:
            return str(p_min)
        return f"{p_min};{p_max}"

    stats['min_max_str'] = stats.apply(format_min_max, axis=1)

    # Pivotage
    stats_pivot = stats.pivot(index='code_commune', columns='code_type_local', values=['prix_m2_moy', 'nb_ventes', 'min_max_str'])
    stats_pivot.columns = [
        'prix_m2_maison_moy', 'prix_m2_appartement_moy',
        'nb_ventes_maison', 'nb_ventes_appartement',
        'min_max_maison', 'min_max_appartement'
    ]
    
    # --- ÉTAPE 8 : Jointure et Arrondis finaux ---
    print("✅ Jointure et arrondis à deux décimales...")
    gdf_final = gdf.merge(stats_pivot.reset_index(), left_on='INSEE_COM', right_on='code_commune', how='left')
    
    if 'code_commune' in gdf_final.columns:
        gdf_final = gdf_final.drop(columns=['code_commune'])

    # Arrondi strict à deux décimales pour les colonnes numériques de prix moyen
    gdf_final['prix_m2_maison_moy'] = gdf_final['prix_m2_maison_moy'].round(2)
    gdf_final['prix_m2_appartement_moy'] = gdf_final['prix_m2_appartement_moy'].round(2)
    
    # Remplissage des ventes (NaN -> 0)
    cols_ventes = ['nb_ventes_maison', 'nb_ventes_appartement']
    gdf_final[cols_ventes] = gdf_final[cols_ventes].fillna(0).astype(int)

    # --- ÉTAPE 9 : Export ---
    print(f"✅ Sauvegarde vers {OUTPUT_GEOJSON}...")
    gdf_final.to_file(OUTPUT_GEOJSON, driver='GeoJSON')
    print("🚀 Terminé ! Formatage min;max optimisé et arrondis à 2 décimales appliqués.")

if __name__ == "__main__":
    process_dvf_data()