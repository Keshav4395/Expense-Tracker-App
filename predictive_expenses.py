import os
import glob
import json
import joblib
import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow import keras

print("Loading model components...")

PREFERRED_MODEL_DIR = 'models_exp1'
FALLBACK_MODEL_DIR = 'models'

# Load config (model metadata)

cfg_candidates = [
    os.path.join(PREFERRED_MODEL_DIR, 'model_config.json'),
    os.path.join(FALLBACK_MODEL_DIR, 'model_config.json'),
    'models/model_config.json'
]

cfg_path = next((p for p in cfg_candidates if os.path.exists(p)), None)
if cfg_path is None:
    raise FileNotFoundError(
        "Missing config file. Checked these locations:\n" +
        "\n".join(cfg_candidates) +
        "\nPlace your model_config.json in one of them (e.g. models_exp1/model_config.json)."
    )

print(f"Using config: {cfg_path}")
with open(cfg_path, 'r') as f:
    config_data = json.load(f)

BEHAVIOR_TYPES = config_data.get('behavior_types', [])
FEATURE_COLUMNS = config_data.get('feature_columns', [])
SEQUENCE_LENGTH = config_data.get('sequence_length', None)

if not BEHAVIOR_TYPES or not FEATURE_COLUMNS or SEQUENCE_LENGTH is None:
    raise ValueError("model_config.json missing required keys: 'behavior_types', 'feature_columns', or 'sequence_length'")

print(f"Loaded config: {len(BEHAVIOR_TYPES)} behaviors, {len(FEATURE_COLUMNS)} features, seq_len={SEQUENCE_LENGTH}")

MODEL_KERAS_CANDIDATES = [
    os.path.join(PREFERRED_MODEL_DIR, 'best_model_saved.keras'),
    os.path.join(PREFERRED_MODEL_DIR, 'best_saved_model.keras'),
    os.path.join(FALLBACK_MODEL_DIR, 'best_model_saved.keras'),
    os.path.join(FALLBACK_MODEL_DIR, 'best_saved_model.keras'),
    'models/best_model_saved.keras',
    'models/best_saved_model.keras'
]

MODEL_DIR_CANDIDATES = [
    os.path.join(PREFERRED_MODEL_DIR, 'best_saved_model'),
    os.path.join(PREFERRED_MODEL_DIR, 'best_model_saved'),
    os.path.join(FALLBACK_MODEL_DIR, 'best_saved_model'),
    os.path.join(FALLBACK_MODEL_DIR, 'best_model_saved'),
    'models/best_saved_model',
    'models/best_model_saved'
]

model = None
load_errors = []

# Helper to test for the Lambda/python-lambda unsafe-deserialization error text
def _is_unsafe_lambda_error(exc):
    txt = str(exc).lower()
    return ('deserializing it is unsafe' in txt) or ('the `{arg_name}` of this `lambda` layer is a python lambda' in txt)

# Try .keras file candidates first (preferred)
for mp in MODEL_KERAS_CANDIDATES:
    if os.path.exists(mp):
        try:
            print(f"Trying to load Keras file: {mp}")
            model = keras.models.load_model(mp)
            print(f"Loaded model from Keras file: {mp}")
            break
        except Exception as e:
            load_errors.append((f"keras_load:{mp}", e))
            # If it's the lambda/unsafe-deserialization error, attempt a careful retry
            if _is_unsafe_lambda_error(e):
                print("Detected a `Lambda` layer with a Python lambda that prevented safe deserialization.")
                print("   If you trust this model file, the loader will retry after enabling unsafe deserialization.")
                try:
                    # Try to enable unsafe deserialization if available
                    if hasattr(keras, "config") and hasattr(keras.config, "enable_unsafe_deserialization"):
                        print("   Enabling keras.config.enable_unsafe_deserialization() and retrying load...")
                        keras.config.enable_unsafe_deserialization()
                        model = keras.models.load_model(mp)
                        print(f"Loaded model from Keras file with unsafe deserialization: {mp}")
                        break
                    else:
                        print("   Warning: keras.config.enable_unsafe_deserialization() not available in this TF/Keras build.")
                except Exception as e2:
                    load_errors.append((f"keras_load_unsafe_retry:{mp}", e2))
                    model = None

# If not loaded via .keras, try SavedModel directories via load_model
if model is None:
    for md in MODEL_DIR_CANDIDATES:
        if os.path.exists(md) and os.path.isdir(md):
            try:
                print(f"Trying to load SavedModel directory with load_model: {md}")
                model = keras.models.load_model(md)
                print(f"Loaded model from SavedModel directory: {md}")
                break
            except Exception as e:
                load_errors.append((f"savedmodel_load:{md}", e))
                model = None

# Last resort: try wrapping SavedModel with TFSMLayer (Keras 3)
if model is None:
    for md in MODEL_DIR_CANDIDATES:
        if os.path.exists(md) and os.path.isdir(md):
            try:
                print(f"Attempting to wrap SavedModel with TFSMLayer: {md}")
                from tensorflow.keras.layers import TFSMLayer
                model = tf.keras.Sequential([TFSMLayer(md, call_endpoint='serving_default')])
                print(f"Wrapped SavedModel using TFSMLayer: {md}")
                break
            except Exception as e:
                load_errors.append((f"tfsmlayer_wrap:{md}", e))
                model = None

if model is None:
    print("Failed to load model. Attempts and errors:")
    for name, err in load_errors:
        print(f"  - {name}: {repr(err)}")
    raise RuntimeError(
        "Could not load model. Ensure a .keras file (preferred) or SavedModel directory exists. "
        "Place 'best_model_saved.keras' or a compatible SavedModel under 'models_exp1/' or 'models/'."
    )

# Load scaler (try models_exp1 then fallback)

SCALER_CANDIDATES = [
    os.path.join(PREFERRED_MODEL_DIR, 'scaler.pkl'),
    os.path.join(FALLBACK_MODEL_DIR, 'scaler.pkl'),
    'models/scaler.pkl'
]

SCALER_PATH = next((p for p in SCALER_CANDIDATES if os.path.exists(p)), None)
if SCALER_PATH is None:
    raise FileNotFoundError(
        "Missing scaler file. Looked for scaler.pkl in these locations:\n" +
        "\n".join(SCALER_CANDIDATES) +
        "\nIf your training saved a scaler, place it as 'scaler.pkl' alongside your model."
    )

scaler = joblib.load(SCALER_PATH)
print(f"Loaded scaler from: {SCALER_PATH}")
print("Model and scaler ready.")

# Prediction helpers

def _prepare_sequence_from_df(df):
 
    # Check columns
    missing = [c for c in FEATURE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"DataFrame missing required feature columns: {missing}")

    if len(df) < SEQUENCE_LENGTH:
        raise ValueError(f"Need at least {SEQUENCE_LENGTH} rows, got {len(df)}")

    # Use most recent rows (tail) to match training
    seq_df = df[FEATURE_COLUMNS].tail(SEQUENCE_LENGTH).astype(np.float32)

    # Flatten -> scaler expects shape (n_samples, SEQ_LEN * n_features)
    flattened = seq_df.values.reshape(1, -1)  # shape (1, SEQ_LEN * n_features)

    # Transform with scaler
    try:
        flattened_scaled = scaler.transform(flattened)
    except Exception as e:
        expected_dim = getattr(scaler, "n_features_in_", None)
        raise RuntimeError(
            f"Scaler.transform failed. Scaler expects input dim={expected_dim}. "
            f"Got flattened dim={flattened.shape[1]}. Error: {e}"
        )

    # Reshape back to (1, SEQUENCE_LENGTH, n_features)
    n_features = len(FEATURE_COLUMNS)
    X = flattened_scaled.reshape(1, SEQUENCE_LENGTH, n_features)
    return X

def predict_behavior(csv_file_or_df):
    """Predict behavior from CSV path or DataFrame. Returns (behavior, confidence, top3, recommendations)."""

    print("\nAnalyzing data...")

    try:
        if isinstance(csv_file_or_df, str):
            if not os.path.exists(csv_file_or_df):
                raise FileNotFoundError(f"CSV file not found: {csv_file_or_df}")
            df = pd.read_csv(csv_file_or_df)
        else:
            df = csv_file_or_df.copy()

        # Sort by day if present (assume ascending)
        if 'day' in df.columns:
            try:
                df = df.sort_values(by='day')
            except Exception:
                pass

        X = _prepare_sequence_from_df(df)  # (1, seq_len, n_features)
    except Exception as e:
        print(f"Preprocessing error: {e}")
        return None

    # Predict
    try:
        preds = model.predict(X, verbose=0)[0]  # 1D array of probabilities
    except Exception as e:
        print(f"Model prediction failed: {e}")
        return None

    pred_idx = int(np.argmax(preds))
    confidence = float(preds[pred_idx]) * 100.0
    behavior = BEHAVIOR_TYPES[pred_idx] if 0 <= pred_idx < len(BEHAVIOR_TYPES) else "unknown"

    # Top 3
    top3_idx = np.argsort(preds)[-3:][::-1]
    top3 = [(BEHAVIOR_TYPES[i] if 0 <= i < len(BEHAVIOR_TYPES) else f"idx_{i}", float(preds[i]) * 100.0) for i in top3_idx]

    print(f"\nPredicted: {behavior}")
    print(f"   Confidence: {confidence:.1f}%")
    print("\nTop 3 Predictions:")
    for b, p in top3:
        print(f"   {b}: {p:.1f}%")

    recs = generate_recommendations(behavior)
    return behavior, confidence, top3, recs

def generate_recommendations(behavior):
    currency = '₹'
    tips = {
        'disciplined_saver': [
            f" Excellent habits! Invest {currency}500 more/month",
            " Track investments quarterly",
            f" Keep saving—aim for {currency}10k/month surplus"
        ],
        'foody_person': [
            f" Cook 4x/week - Save {currency}6000/month",
            " Meal prep on weekends",
            f" Use discounts: {currency}1000+/month savings"
        ],
        'gaming_person': [
            f"Budget {currency}2000/month on games",
            "Buy during sales",
            " Explore free alternatives"
        ],
        'gym_enthusiast': [
            " Great discipline!",
            f" Home workouts 2x/week: Save {currency}2000",
            f"Buy bulk supplements: {currency}500 savings"
        ],
        'online_shopper': [
            "24-hour wait before buying",
            "Remove saved cards",
            f"Track all: Limit to {currency}3000/month"
        ],
        'travel_lover': [
            f"Book advance: Save {currency}5000/trip",
            f" Budget stays: {currency}2000/night max",
            " Off-season travel"
        ],
        'weekend_party_person': [
            f"Limit to 2/month: Save {currency}4000+",
            f"Home pre-games: {currency}1000/month",
            " Set party budgets"
        ]
    }
    recs = tips.get(behavior, [f"Continue tracking in the app for {behavior}-specific tips!"])
    print("\n Recommendations:")
    for r in recs:
        print("   " + r)
    return recs

# API simulation helper

def predict_from_api_data(api_data):
    """
    api_data: list of dicts [{'day': '2023-01-01', 'salary': 50000, ...}, ...]
    """
    df = pd.DataFrame(api_data)
    out = predict_behavior(df)
    if out is None:
        return {'error': 'Prediction failed'}
    behavior, confidence, top3, recs = out
    return {'behavior': behavior, 'confidence': confidence, 'top3': top3, 'recommendations': recs}

# Interactive CLI for testing

def interactive_mode():
    print("\n" + "="*60)
    print("Enhanced Behavior Prediction System (Interactive)")
    print("="*60)
    while True:
        print("\nOptions:")
        print("1. Predict from CSV file")
        print("2. Predict from API-like JSON")
        print("3. Test a sample file per behavior (if available)")
        print("4. Quit")
        ch = input("Choice (1/2/3/4): ").strip()
        if ch == '1':
            path = input("CSV file path: ").strip()
            if os.path.exists(path):
                predict_behavior(path)
            else:
                print("File not found:", path)
        elif ch == '2':
            print("Paste array of rows JSON (list of dicts). Example: [{'day':'2023-01-01', 'salary':50000, ...}, ...]")
            js = input("JSON: ").strip()
            try:
                api_data = json.loads(js)
                res = predict_from_api_data(api_data)
                print(json.dumps(res, indent=2))
            except Exception as e:
                print("Invalid JSON or prediction error:", e)
        elif ch == '3':
            # Use DATASET folder from training (config expected models/config created)
            # try to find one sample file per behavior in 'datasets/<behavior>/'
            for behavior in BEHAVIOR_TYPES:
                pattern = os.path.join('datasets', behavior, '*.csv')
                files = glob.glob(pattern)
                if files:
                    print("\n" + "-"*40)
                    print("Sample test for behavior:", behavior)
                    predict_behavior(files[0])
                else:
                    print(f"No sample files found for behavior: {behavior} (looked at {pattern})")
        elif ch == '4':
            print("Goodbye!")
            break
        else:
            print("Invalid choice.")

if __name__ == '__main__':
    interactive_mode()
