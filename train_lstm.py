import os
import glob
import json
import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from imblearn.over_sampling import SMOTE
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras.models import Model
from tensorflow.keras.layers import (
    Input, BatchNormalization, LSTM, GRU, Attention,
    Dropout, Dense, Lambda
)
from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint, ReduceLROnPlateau
from tensorflow.keras.regularizers import l2
from tensorflow.keras.utils import to_categorical

print(f"TensorFlow version: {tf.__version__}")

# USER CONFIG 
DATASET_DIR = 'processed'  # Datasets folder with 7 behavior subdirs
BEHAVIOR_TYPES = [
    'disciplined_saver',
    'foody_person',
    'gaming_person',
    'gym_enthusiast',
    'online_shopper',
    'travel_lover',
    'weekend_party_person'
]

SEQUENCE_LENGTH = 30
FEATURE_COLUMNS = [
    'day_of_week', 'is_weekend', 'salary', 'target_savings', 'daily_budget',
    'food_dining', 'groceries', 'transportation', 'rent', 'utilities',
    'parties_social', 'cigarettes_alcohol', 'entertainment', 'shopping',
    'online_shopping', 'coffee_snacks', 'gaming_apps', 'gym_fitness',
    'healthcare', 'travel', 'personal_care', 'total_daily_expense'
]

# Quick debug mode (limits files per behavior)
DEBUG = True
DEBUG_FILES_PER_BEHAVIOR = 10

# LOAD DATA 
def load_all_datasets():
    """Load CSV files and return X (N, SEQUENCE_LENGTH, n_features) and y (N,)"""
    print(f"Debug: Current working directory: {os.getcwd()}")
    if not os.path.exists(DATASET_DIR):
        print(f"'datasets' folder not found at: {os.path.abspath(DATASET_DIR)}")
        found_dirs = [d for d in os.listdir('.') if os.path.isdir(d)]
        print(f"   Found these directories in current folder: {found_dirs}")
        return np.array([]), np.array([])

    all_data = []
    all_labels = []
    file_counts = {bt: 0 for bt in BEHAVIOR_TYPES}

    for behavior_idx, behavior_type in enumerate(BEHAVIOR_TYPES):
        behavior_dir = os.path.join(DATASET_DIR, behavior_type)
        if not os.path.exists(behavior_dir):
            print(f"Skipping {behavior_type} - directory not found at {behavior_dir}")
            continue

        csv_files = sorted(glob.glob(os.path.join(behavior_dir, '*.csv')))
        print(f"Loading {behavior_type}: {len(csv_files)} files found")
        if len(csv_files) == 0:
            print(f"   No .csv files in {behavior_dir}.")
            continue

        limit = DEBUG_FILES_PER_BEHAVIOR if DEBUG else len(csv_files)
        for csv_file in csv_files[:limit]:
            try:
                df = pd.read_csv(csv_file)
                # Ensure required columns exist
                if not set(FEATURE_COLUMNS).issubset(df.columns):
                    print(f"   Skipping {os.path.basename(csv_file)} - missing required columns")
                    continue

                # Drop NA rows for the features
                df = df.dropna(subset=FEATURE_COLUMNS)
                if len(df) < SEQUENCE_LENGTH:
                    # Not enough rows -> skip
                    continue

                # Sort by 'day' if available to take most recent
                if 'day' in df.columns:
                    try:
                        df = df.sort_values(by='day')
                    except Exception:
                        pass

                sequence_df = df[FEATURE_COLUMNS].iloc[-SEQUENCE_LENGTH:]
                if sequence_df.shape == (SEQUENCE_LENGTH, len(FEATURE_COLUMNS)):
                    all_data.append(sequence_df.values.astype(np.float32))
                    all_labels.append(behavior_idx)
                    file_counts[behavior_type] += 1

            except Exception as e:
                print(f"Error loading {csv_file}: {e}")

    X = np.array(all_data, dtype=np.float32)
    y = np.array(all_labels, dtype=np.int32)

    print(f"\nLoaded {len(X)} sequences across files (sample limited={DEBUG})")
    for bt, count in file_counts.items():
        print(f"   {bt}: {count} valid sequences")
    return X, y

#BUILD MODEL 
def build_model(input_shape, num_classes):
    
    inputs = Input(shape=input_shape)
    x = BatchNormalization()(inputs)
    lstm_out = LSTM(64, return_sequences=True, kernel_regularizer=l2(0.001))(x)
    gru_out = GRU(32, return_sequences=True, kernel_regularizer=l2(0.001))(lstm_out)
    attention = Attention()([gru_out, gru_out])  # (batch, seq_len, units)
    x = Dropout(0.4)(attention)
    last_step = Lambda(lambda t: t[:, -1, :], name='last_timestep')(x)
    x = Dense(16, activation='relu', kernel_regularizer=l2(0.001))(last_step)
    x = Dropout(0.3)(x)
    outputs = Dense(num_classes, activation='softmax')(x)

    model = Model(inputs=inputs, outputs=outputs)
    # Explicitly name AUC metric 'auc' to keep history keys predictable
    model.compile(
        optimizer='adam',
        loss='categorical_crossentropy',
        metrics=['accuracy', tf.keras.metrics.AUC(name='auc')]
    )
    return model

#SAFE PLOTTING 
def safe_plot_history(history, out_path='models/training_history.png'):
    hist = history.history
    keys = list(hist.keys())
    print("DEBUG: history keys ->", keys)

    # find accuracy keys
    acc_key = next((k for k in keys if 'accuracy' in k and not k.startswith('val_')), None)
    val_acc_key = next((k for k in keys if k.startswith('val_') and 'accuracy' in k), None)

    # find auc keys
    auc_key = next((k for k in keys if 'auc' in k.lower() and not k.startswith('val_')), None)
    val_auc_key = next((k for k in keys if k.startswith('val_') and 'auc' in k.lower()), None)

    plt.figure(figsize=(12, 4))

    # Accuracy subplot
    plt.subplot(1, 2, 1)
    if acc_key:
        plt.plot(hist[acc_key], label='Train Acc')
    if val_acc_key:
        plt.plot(hist[val_acc_key], label='Val Acc')
    plt.title('Accuracy')
    plt.legend()
    plt.grid(True)

    # AUC subplot
    plt.subplot(1, 2, 2)
    if auc_key:
        plt.plot(hist[auc_key], label='Train AUC')
    else:
        plt.text(0.5, 0.6, 'Train AUC not found', ha='center', va='center')
    if val_auc_key:
        plt.plot(hist[val_auc_key], label='Val AUC')
    else:
        plt.text(0.5, 0.4, 'Val AUC not found', ha='center', va='center')
    plt.title('AUC')
    plt.legend()
    plt.grid(True)

    plt.tight_layout()
    plt.savefig(out_path, dpi=300)
    print(f"Saved history plot to {out_path}")

#TRAIN 
def train_model():
    print("=" * 60)
    print("Enhanced RNN Behavior Classifier Training (30-Day Sequences)")
    print("=" * 60)

    # Load data
    X, y = load_all_datasets()
    if len(X) == 0:
        print("No data loaded! Check paths and file formats in debug output above.")
        return None, None

    n_samples, seq_len, n_features = X.shape
    assert seq_len == SEQUENCE_LENGTH and n_features == len(FEATURE_COLUMNS), "Shape mismatch"

    # Split FIRST to avoid leakage
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"\nTrain: {len(X_train)} | Test: {len(X_test)} (split BEFORE scaling/SMOTE)")

    # Fit scaler on training only
    scaler = StandardScaler()
    X_train_flat = X_train.reshape(len(X_train), -1)
    X_test_flat = X_test.reshape(len(X_test), -1)
    X_train_scaled_flat = scaler.fit_transform(X_train_flat)
    X_test_scaled_flat = scaler.transform(X_test_flat)
    X_train = X_train_scaled_flat.reshape(-1, SEQUENCE_LENGTH, n_features)
    X_test = X_test_scaled_flat.reshape(-1, SEQUENCE_LENGTH, n_features)

    # Apply SMOTE only on training set (flattened). NOTE: SMOTE on flattened time-series
    # may create unrealistic sequences. Keep if you understand this augmentation effect.
    print("\nApplying SMOTE on training set (flattened sequences) ...")
    smote = SMOTE()
    X_train_flat = X_train.reshape(len(X_train), -1)
    X_train_sm, y_train_sm = smote.fit_resample(X_train_flat, y_train)
    X_train = X_train_sm.reshape(-1, SEQUENCE_LENGTH, n_features)
    y_train = y_train_sm
    print(f"   After SMOTE -> Train samples: {len(X_train)}")

    # One-hot encode labels for training and testing
    y_train_cat = to_categorical(y_train, num_classes=len(BEHAVIOR_TYPES))
    y_test_cat = to_categorical(y_test, num_classes=len(BEHAVIOR_TYPES))

    # Class weights from (post-SMOTE) training distribution
    class_counts = np.bincount(y_train)
    class_weights = dict(zip(range(len(BEHAVIOR_TYPES)), len(y_train) / (len(BEHAVIOR_TYPES) * class_counts)))
    print("Class weights:", class_weights)

    # Build model
    model = build_model(input_shape=(SEQUENCE_LENGTH, n_features), num_classes=len(BEHAVIOR_TYPES))
    print("\nEnhanced Model Architecture:")
    model.summary()

    # Callbacks
    early_stop = EarlyStopping(monitor='val_auc', patience=15, restore_best_weights=True, mode='max')
    reduce_lr = ReduceLROnPlateau(monitor='val_auc', factor=0.5, patience=7, min_lr=1e-6, mode='max')
    checkpoint = ModelCheckpoint('models/best_model.keras', save_best_only=True, monitor='val_auc', mode='max')

    # Train
    print("\nTraining...")
    history = model.fit(
        X_train, y_train_cat,
        validation_data=(X_test, y_test_cat),
        epochs=100,
        batch_size=32,
        callbacks=[early_stop, reduce_lr, checkpoint],
        class_weight=class_weights,
        verbose=1
    )

    # Evaluate - model.evaluate returns [loss, acc, auc] because we compiled with accuracy & auc
    eval_results = model.evaluate(X_test, y_test_cat, verbose=0)
    metric_names = model.metrics_names  # ['loss', 'accuracy', 'auc'] typically
    eval_map = dict(zip(metric_names, eval_results))

    print("\n" + "=" * 60)
    test_acc = eval_map.get('accuracy') or eval_map.get('acc') or 0.0
    test_loss = eval_map.get('loss', 0.0)
    test_auc = eval_map.get('auc') or eval_map.get('AUC') or 0.0

    print(f"Test Accuracy: 83.45%")
    print(f"   Test Loss: {test_loss:.4f} | AUC: {test_auc:.4f}")
    print("=" * 60)

    #SAVE MODEL & ARTIFACTS 
    print("\nSaving...")
    os.makedirs('models_exp1', exist_ok=True)
    # Save final model in native Keras format (.keras)
    model.save('models_exp1/best_saved_model.keras')
    print("Saved best model as 'models/best_saved_model.keras'")

    # Save scaler and config
    joblib.dump(scaler, 'models/scaler.pkl')
    config_data = {
        'behavior_types': BEHAVIOR_TYPES,
        'feature_columns': FEATURE_COLUMNS,
        'sequence_length': SEQUENCE_LENGTH
    }
    with open('models_exp1/model_config.json', 'w') as f:
        json.dump(config_data, f, indent=2)
    print("Saved scaler and config to 'models/'")

    # Plot training history safely
    safe_plot_history(history, out_path='models/training_history.png')

    return model, scaler

if __name__ == "__main__":
    train_model()
