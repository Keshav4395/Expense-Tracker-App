import pandas as pd
import numpy as np
import os
import glob
from sklearn.preprocessing import StandardScaler
import joblib

DATASET_DIR = "datasets"
OUTPUT_DIR = "processed"

BEHAVIOR_TYPES = [
    "disciplined_saver","foody_person","gaming_person",
    "gym_enthusiast","online_shopper","travel_lover","weekend_party_person"
]

FEATURE_COLUMNS = [
    'day_of_week','is_weekend','salary','target_savings','daily_budget',
    'food_dining','groceries','transportation','rent','utilities',
    'parties_social','cigarettes_alcohol','entertainment','shopping',
    'online_shopping','coffee_snacks','gaming_apps','gym_fitness',
    'healthcare','travel','personal_care','total_daily_expense'
]

SEQUENCE_LENGTH = 30

os.makedirs(OUTPUT_DIR, exist_ok=True)

raw_sequences, labels = [], []

# ---------- Step 1: Clean + Collect ----------
for label, behavior in enumerate(BEHAVIOR_TYPES):
    for file in glob.glob(f"{DATASET_DIR}/{behavior}/*.csv"):
        df = pd.read_csv(file)
        df = df.sort_values("day") if "day" in df.columns else df
        df = df[FEATURE_COLUMNS]
        df = df.apply(pd.to_numeric, errors="coerce").fillna(0)

        if len(df) < SEQUENCE_LENGTH:
            continue

        seq = df.iloc[-SEQUENCE_LENGTH:].values
        raw_sequences.append(seq)
        labels.append(label)

raw_sequences = np.array(raw_sequences, dtype=np.float32)
labels = np.array(labels, dtype=np.int32)

# ---------- Step 2: Global Standardization ----------
scaler = StandardScaler()
flat = raw_sequences.reshape(-1, raw_sequences.shape[-1])
scaled = scaler.fit_transform(flat)
scaled_sequences = scaled.reshape(raw_sequences.shape)

# ---------- Step 3: Save Everything ----------
X, y = scaled_sequences, labels
np.savez(f"{OUTPUT_DIR}/dataset.npz", X=X, y=y)
joblib.dump(scaler, f"{OUTPUT_DIR}/scaler.pkl")

# Also save individual cleaned files (optional but useful)
for i, seq in enumerate(X):
    behavior = BEHAVIOR_TYPES[y[i]]
    os.makedirs(f"{OUTPUT_DIR}/{behavior}", exist_ok=True)
    pd.DataFrame(seq, columns=FEATURE_COLUMNS)\
      .to_csv(f"{OUTPUT_DIR}/{behavior}/sample_{i}.csv", index=False)

print("Preprocessing complete with proper standardization")
print(f"Saved dataset: {OUTPUT_DIR}/dataset.npz")
print(f"Saved scaler: {OUTPUT_DIR}/scaler.pkl")
