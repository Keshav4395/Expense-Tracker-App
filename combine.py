import argparse
import json
import pickle
import shutil
import tarfile
import zipfile
from pathlib import Path
from typing import Dict, List, Any
import h5py
import numpy as np

def find_model_files(models_dir: Path) -> Dict[str, List[Path]]:
    """Organize model files by type and extract user IDs."""
    file_types = {
        'keras_models': [],
        'weight_files': [], 
        'feat_scalers': [],
        'targ_scalers': [],
        'metadata_files': [],
        'other_files': []
    }
    
    for file_path in models_dir.iterdir():
        if file_path.is_file():
            name = file_path.name.lower()
            if name.endswith('.keras'):
                file_types['keras_models'].append(file_path)
            elif name.endswith('.weights.h5'):
                file_types['weight_files'].append(file_path)
            elif name.startswith('feat_scaler_') and name.endswith('.pkl'):
                file_types['feat_scalers'].append(file_path)
            elif name.startswith('targ_scaler_') and name.endswith('.pkl'):
                file_types['targ_scalers'].append(file_path)
            elif name.startswith('metadata_') and name.endswith('.json'):
                file_types['metadata_files'].append(file_path)
            else:
                file_types['other_files'].append(file_path)
    
    return file_types

def extract_user_id(file_path: Path, file_type: str) -> str:
    """Extract user ID from filename based on expected patterns."""
    name = file_path.stem
    
    if file_type == 'keras_models':
        # model_<uid>_best.keras
        if name.startswith('model_') and name.endswith('_best'):
            return name[6:-5]  # Remove 'model_' prefix and '_best' suffix
    elif file_type == 'weight_files':
        # model_<uid>_best.weights.h5 or model_<uid>_interrupted.weights.h5
        if name.startswith('model_'):
            if name.endswith('_best.weights'):
                return name[6:-13]  # Remove 'model_' and '_best.weights'
            elif name.endswith('_interrupted.weights'):
                return name[6:-19]  # Remove 'model_' and '_interrupted.weights'
    elif file_type in ['feat_scalers', 'targ_scalers']:
        # feat_scaler_<uid>.pkl or targ_scaler_<uid>.pkl
        prefix = 'feat_scaler_' if file_type == 'feat_scalers' else 'targ_scaler_'
        if name.startswith(prefix):
            return name[len(prefix):]
    elif file_type == 'metadata_files':
        # metadata_<uid>.json
        if name.startswith('metadata_'):
            return name[9:]  # Remove 'metadata_' prefix
    
    return name  # Fallback to full stem

def consolidate_metadata(metadata_files: List[Path], output_path: Path) -> Dict[str, Any]:
    """Combine all metadata JSON files into a single master file."""
    master_metadata = {
        'consolidated_at': str(Path().absolute()),
        'total_users': 0,
        'users': {}
    }
    
    print(f"Consolidating {len(metadata_files)} metadata files...")
    
    for meta_file in metadata_files:
        try:
            with open(meta_file, 'r', encoding='utf-8') as f:
                user_meta = json.load(f)
            
            user_id = extract_user_id(meta_file, 'metadata_files')
            master_metadata['users'][user_id] = user_meta
            
        except Exception as e:
            print(f"  Warning: Failed to process {meta_file.name}: {e}")
    
    master_metadata['total_users'] = len(master_metadata['users'])
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(master_metadata, f, indent=2)
    
    print(f"  Saved consolidated metadata: {output_path}")
    return master_metadata

def consolidate_scalers(scaler_files: List[Path], scaler_type: str, output_path: Path) -> Dict[str, Any]:
    """Combine all scaler pickle files into a single dictionary file."""
    consolidated_scalers = {}
    
    print(f"Consolidating {len(scaler_files)} {scaler_type} files...")
    
    for scaler_file in scaler_files:
        try:
            with open(scaler_file, 'rb') as f:
                scaler = pickle.load(f)
            
            user_id = extract_user_id(scaler_file, scaler_type)
            consolidated_scalers[user_id] = scaler
            
        except Exception as e:
            print(f"  Warning: Failed to process {scaler_file.name}: {e}")
    
    with open(output_path, 'wb') as f:
        pickle.dump(consolidated_scalers, f)
    
    print(f"  Saved consolidated {scaler_type}: {output_path}")
    return consolidated_scalers

def create_model_archive(model_files: List[Path], archive_path: Path, compress: bool = True):
    """Create an archive of model files (keras or weights)."""
    print(f"Creating archive for {len(model_files)} model files...")
    
    if compress:
        # Use tar.gz for better compression
        archive_path = archive_path.with_suffix('.tar.gz')
        with tarfile.open(archive_path, 'w:gz') as tar:
            for model_file in model_files:
                tar.add(model_file, arcname=model_file.name)
    else:
        # Use zip for faster access
        archive_path = archive_path.with_suffix('.zip')
        with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED) as zf:
            for model_file in model_files:
                zf.write(model_file, model_file.name)
    
    print(f"  Saved model archive: {archive_path}")
    return archive_path

def consolidate_h5_weights(weight_files: List[Path], output_path: Path) -> Dict[str, str]:
    """Combine all HDF5 weight files into a single HDF5 file with groups."""
    print(f"Consolidating {len(weight_files)} weight files into single HDF5...")
    
    user_mapping = {}
    
    with h5py.File(output_path, 'w') as master_h5:
        for weight_file in weight_files:
            try:
                user_id = extract_user_id(weight_file, 'weight_files')
                group_name = f"user_{user_id}"
                user_mapping[user_id] = group_name
                
                # Create a group for this user
                user_group = master_h5.create_group(group_name)
                
                # Copy weights from individual file to group
                with h5py.File(weight_file, 'r') as src_h5:
                    def copy_dataset(name, obj):
                        if isinstance(obj, h5py.Dataset):
                            user_group.create_dataset(name, data=obj[...])
                        elif isinstance(obj, h5py.Group):
                            subgroup = user_group.create_group(name)
                            obj.visititems(lambda n, o: copy_dataset(f"{name}/{n}", o) if isinstance(o, h5py.Dataset) else None)
                    
                    src_h5.visititems(copy_dataset)
                
            except Exception as e:
                print(f"  Warning: Failed to process {weight_file.name}: {e}")
    
    print(f"  Saved consolidated weights: {output_path}")
    
    # Save user mapping
    mapping_path = output_path.with_suffix('.mapping.json')
    with open(mapping_path, 'w') as f:
        json.dump(user_mapping, f, indent=2)
    
    return user_mapping

def create_model_registry(master_metadata: Dict, output_dir: Path):
    """Create a unified registry for easy model loading."""
    registry = {
        'version': '1.0',
        'total_users': master_metadata['total_users'],
        'files': {
            'metadata': 'master_metadata.json',
            'feat_scalers': 'consolidated_feat_scalers.pkl',
            'targ_scalers': 'consolidated_targ_scalers.pkl',
            'keras_models': 'keras_models_archive',
            'weight_files': 'consolidated_weights.h5',
            'weight_mapping': 'consolidated_weights.mapping.json'
        },
        'users': list(master_metadata['users'].keys())
    }
    
    registry_path = output_dir / 'model_registry.json'
    with open(registry_path, 'w', encoding='utf-8') as f:
        json.dump(registry, f, indent=2)
    
    print(f"Created model registry: {registry_path}")

def create_loader_utility(output_dir: Path):
    """Create a utility class for loading consolidated models."""
    loader_code = '''#!/usr/bin/env python3
"""
model_loader.py

Utility class for loading models from consolidated format.
Generated automatically by consolidate_models.py
"""

import json
import pickle
import tarfile
import zipfile
import tempfile
import h5py
from pathlib import Path
from typing import Optional, Dict, Any

import tensorflow as tf
from sklearn.preprocessing import MinMaxScaler

class ConsolidatedModelLoader:
    """Load individual user models from consolidated format."""
    
    def __init__(self, consolidated_dir: str):
        self.consolidated_dir = Path(consolidated_dir)
        self.registry = self._load_registry()
        self.metadata = self._load_metadata()
        self.feat_scalers = self._load_scalers('feat_scalers')
        self.targ_scalers = self._load_scalers('targ_scalers')
        
    def _load_registry(self) -> Dict:
        registry_path = self.consolidated_dir / 'model_registry.json'
        with open(registry_path, 'r') as f:
            return json.load(f)
    
    def _load_metadata(self) -> Dict:
        metadata_path = self.consolidated_dir / self.registry['files']['metadata']
        with open(metadata_path, 'r') as f:
            return json.load(f)
    
    def _load_scalers(self, scaler_type: str) -> Dict:
        scaler_path = self.consolidated_dir / self.registry['files'][scaler_type]
        with open(scaler_path, 'rb') as f:
            return pickle.load(f)
    
    def get_available_users(self) -> list:
        """Get list of all available user IDs."""
        return self.registry['users']
    
    def get_user_metadata(self, user_id: str) -> Optional[Dict]:
        """Get metadata for a specific user."""
        return self.metadata['users'].get(user_id)
    
    def load_keras_model(self, user_id: str) -> Optional[tf.keras.Model]:
        """Load Keras model for a specific user."""
        # Extract from archive to temporary location
        keras_archive = self.consolidated_dir / f"{self.registry['files']['keras_models']}"
        
        # Try both .tar.gz and .zip
        for suffix in ['.tar.gz', '.zip']:
            archive_path = keras_archive.with_suffix(suffix)
            if archive_path.exists():
                return self._extract_and_load_keras(archive_path, user_id, suffix)
        
        print(f"No Keras archive found for format")
        return None
    
    def _extract_and_load_keras(self, archive_path: Path, user_id: str, suffix: str) -> Optional[tf.keras.Model]:
        model_filename = f"model_{user_id}_best.keras"
        
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            try:
                if suffix == '.tar.gz':
                    with tarfile.open(archive_path, 'r:gz') as tar:
                        tar.extract(model_filename, temp_dir)
                else:  # .zip
                    with zipfile.ZipFile(archive_path, 'r') as zf:
                        zf.extract(model_filename, temp_dir)
                
                model_path = temp_path / model_filename
                return tf.keras.models.load_model(str(model_path))
                
            except Exception as e:
                print(f"Failed to load Keras model for user {user_id}: {e}")
                return None
    
    def load_weights_for_model(self, user_id: str, model: tf.keras.Model) -> bool:
        """Load weights for a user into an existing model."""
        weights_path = self.consolidated_dir / self.registry['files']['weight_files']
        mapping_path = self.consolidated_dir / self.registry['files']['weight_mapping']
        
        try:
            # Load mapping
            with open(mapping_path, 'r') as f:
                mapping = json.load(f)
            
            if user_id not in mapping:
                print(f"No weights found for user {user_id}")
                return False
            
            group_name = mapping[user_id]
            
            # Load weights from HDF5
            with h5py.File(weights_path, 'r') as h5f:
                user_group = h5f[group_name]
                weights = []
                
                def collect_weights(name, obj):
                    if isinstance(obj, h5py.Dataset):
                        weights.append(obj[...])
                
                user_group.visititems(collect_weights)
                model.set_weights(weights)
                
            return True
            
        except Exception as e:
            print(f"Failed to load weights for user {user_id}: {e}")
            return False
    
    def get_scalers(self, user_id: str) -> tuple[Optional[MinMaxScaler], Optional[MinMaxScaler]]:
        """Get feature and target scalers for a user."""
        feat_scaler = self.feat_scalers.get(user_id)
        targ_scaler = self.targ_scalers.get(user_id)
        return feat_scaler, targ_scaler
    
    def load_complete_model(self, user_id: str) -> Optional[Dict]:
        """Load complete model package for a user."""
        if user_id not in self.get_available_users():
            print(f"User {user_id} not found")
            return None
        
        # Try Keras model first
        model = self.load_keras_model(user_id)
        if model is None:
            print(f"Could not load Keras model for {user_id}")
            return None
        
        # Get scalers
        feat_scaler, targ_scaler = self.get_scalers(user_id)
        
        # Get metadata
        metadata = self.get_user_metadata(user_id)
        
        return {
            'model': model,
            'feat_scaler': feat_scaler,
            'targ_scaler': targ_scaler,
            'metadata': metadata,
            'user_id': user_id
        }

# Example usage
if __name__ == "__main__":
    loader = ConsolidatedModelLoader("consolidated_models")
    
    print(f"Available users: {len(loader.get_available_users())}")
    
    # Load a specific user's complete model
    user_id = loader.get_available_users()[0] if loader.get_available_users() else None
    if user_id:
        user_model = loader.load_complete_model(user_id)
        if user_model:
            print(f"Successfully loaded model for user {user_id}")
            print(f"Model input shape: {user_model['model'].input_shape}")
'''
    
    loader_path = output_dir / 'model_loader.py'
    with open(loader_path, 'w', encoding='utf-8') as f:
        f.write(loader_code)
    
    print(f"Created model loader utility: {loader_path}")

def main():
    parser = argparse.ArgumentParser(description="Consolidate individual LSTM model files into organized format")
    parser.add_argument("--models-dir", type=str, default="models_out", help="Directory containing individual model files")
    parser.add_argument("--output-dir", type=str, default="consolidated_models", help="Output directory for consolidated files")
    parser.add_argument("--compress", action="store_true", help="Use compression for archives (slower but smaller)")
    parser.add_argument("--keep-originals", action="store_true", help="Keep original files after consolidation")
    args = parser.parse_args()
    
    models_dir = Path(args.models_dir)
    output_dir = Path(args.output_dir)
    
    if not models_dir.exists():
        print(f"Error: Models directory {models_dir} does not exist")
        return
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Consolidating models from {models_dir} to {output_dir}")
    
    # Find and organize files
    file_types = find_model_files(models_dir)
    
    print("\nFound files:")
    for file_type, files in file_types.items():
        print(f"  {file_type}: {len(files)} files")
    
    # Consolidate metadata
    if file_types['metadata_files']:
        master_metadata = consolidate_metadata(
            file_types['metadata_files'],
            output_dir / 'master_metadata.json'
        )
    else:
        master_metadata = {'users': {}, 'total_users': 0}
    
    # Consolidate scalers
    if file_types['feat_scalers']:
        consolidate_scalers(
            file_types['feat_scalers'],
            'feat_scalers',
            output_dir / 'consolidated_feat_scalers.pkl'
        )
    
    if file_types['targ_scalers']:
        consolidate_scalers(
            file_types['targ_scalers'],
            'targ_scalers',
            output_dir / 'consolidated_targ_scalers.pkl'
        )
    
    # Archive Keras models
    if file_types['keras_models']:
        create_model_archive(
            file_types['keras_models'],
            output_dir / 'keras_models_archive',
            compress=args.compress
        )
    
    # Consolidate HDF5 weights
    if file_types['weight_files']:
        consolidate_h5_weights(
            file_types['weight_files'],
            output_dir / 'consolidated_weights.h5'
        )
    
    # Create registry and loader
    create_model_registry(master_metadata, output_dir)
    create_loader_utility(output_dir)
    
    # Summary
    print(f"\n✅ Consolidation complete!")
    print(f"   Original files: {sum(len(files) for files in file_types.values())}")
    print(f"   Consolidated into: {len(list(output_dir.iterdir()))} files")
    print(f"   Total users: {master_metadata['total_users']}")
    
    if not args.keep_originals:
        response = input("\nDelete original files? (y/N): ").strip().lower()
        if response == 'y':
            for file_type, files in file_types.items():
                for file_path in files:
                    file_path.unlink()
            print("Original files deleted.")

if __name__ == "__main__":
    main()
