import pandas as pd
import os

# --- CONFIGURATION DES CHEMINS ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PATH_DVF = os.path.join(BASE_DIR, "dvf.csv.gz")
# Nom du nouveau fichier filtré
OUTPUT_CSV = os.path.join(BASE_DIR, "dvf_44137_filtered.csv")

def filter_dvf_by_commune(code_insee):
    if not os.path.exists(PATH_DVF):
        print(f"❌ Fichier source introuvable : {PATH_DVF}")
        return

    print(f"⏳ Lecture et filtrage pour la commune {code_insee}...")
    
    # Lecture par morceaux (chunks) pour économiser la mémoire vive
    # car le fichier DVF complet est très lourd
    chunk_list = []
    chunks = pd.read_csv(PATH_DVF, sep=',', low_memory=False, chunksize=100000)

    for chunk in chunks:
        # Nettoyage du code commune (ajout du 0 initial si nécessaire)
        chunk['code_commune'] = chunk['code_commune'].astype(str).str.zfill(5)
        
        # Filtrage
        filtered_chunk = chunk[chunk['code_commune'] == str(code_insee)]
        chunk_list.append(filtered_chunk)

    # Fusion des morceaux filtrés
    df_final = pd.concat(chunk_list)

    if df_final.empty:
        print(f"⚠️ Aucune donnée trouvée pour le code {code_insee}.")
    else:
        # Sauvegarde en CSV classique (non compressé pour une lecture facile)
        df_final.to_csv(OUTPUT_CSV, index=False, sep=',')
        print(f"✅ Fichier filtré enregistré : {OUTPUT_CSV}")
        print(f"📊 Nombre de lignes extraites : {len(df_final)}")

if __name__ == "__main__":
    filter_dvf_by_commune("44137")