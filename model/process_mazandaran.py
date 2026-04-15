"""
GlucoSense — Mazandaran PPG Dataset Processor
===============================================
Processes the Mazandaran University PPG dataset (Mendeley Data DOI: 10.17632/37pm7jk7jn.1)
and converts it into the BSM_dataset.csv format for model training.

Dataset structure expected:
  mazandaran_data/
    signal_XX_XXXX.mat   (67 raw PPG signal files)
  mazandaran_labels/
    Label_XX_XXXX.mat    (68 label files with glucose, age, gender, etc.)

If label files are not found, the script will tell you how to get them.
"""

import os
import sys
import pandas as pd
import numpy as np
from scipy.io import loadmat
from collections import defaultdict

# ─── Configuration ───────────────────────────────────────────
SIGNAL_FOLDER = os.path.join(os.path.dirname(__file__), 'mazandaran_data')
LABEL_FOLDER  = os.path.join(os.path.dirname(__file__), 'mazandaran_labels')
OUTPUT_CSV    = os.path.join(os.path.dirname(__file__), 'Mazandaran_Processed.csv')
SAMPLING_FREQ = 2175  # Hz (from the dataset documentation)

# The Arduino uses 200 samples at 100 Hz (2 seconds of data).
# We'll process the longer signals in windows to replicate this.
ARDUINO_WINDOW = 200
ARDUINO_RATE   = 100


# ─── Feature Extraction (replicates Arduino processAndPredict()) ──
def extract_features_from_ppg(signal):
    """
    Extract ratio and variability from a single-channel PPG signal,
    replicating the Arduino's processAndPredict() math.

    The Arduino computes:
      - redDC, irDC  = mean of red/IR buffers
      - redAC, irAC  = max - min of red/IR buffers
      - ratio        = (redAC/redDC) / (irAC/irDC)
      - variability  = irAC

    Since the Mazandaran dataset has only ONE channel (green LED PPG),
    we simulate dual-channel features by splitting the signal into
    frequency bands or using signal properties. The most robust
    approach is to use overlapping windows and compute statistics.
    """
    sig = signal.astype(np.float64)

    if len(sig) < ARDUINO_WINDOW:
        return None

    # Process in windows (like the Arduino's 200-sample buffers)
    # and average the features across all windows.
    ratios = []
    variabilities = []
    slopes = []

    # Downsample factor: dataset is 2175 Hz, Arduino is 100 Hz
    downsample = max(1, int(SAMPLING_FREQ / ARDUINO_RATE))

    # Downsample the signal to match Arduino's effective rate
    sig_ds = sig[::downsample]

    n_windows = max(1, len(sig_ds) // ARDUINO_WINDOW)

    for w in range(n_windows):
        start = w * ARDUINO_WINDOW
        end = start + ARDUINO_WINDOW
        if end > len(sig_ds):
            break

        window = sig_ds[start:end]

        dc = np.mean(window)
        ac = np.max(window) - np.min(window)

        if dc < 1:
            dc = 1
        if ac < 1:
            ac = 1

        # For single-channel PPG, we approximate the ratio by using
        # two different aspects of the same signal:
        #   - "red-like": low-frequency component (DC trend)
        #   - "IR-like":  high-frequency component (pulsatile AC)
        # This mimics how ratio = (redAC/redDC) / (irAC/irDC)

        # Split into two halves to simulate dual-channel
        half = ARDUINO_WINDOW // 2
        first_half = window[:half]
        second_half = window[half:]

        dc1, ac1 = np.mean(first_half), np.ptp(first_half)
        dc2, ac2 = np.mean(second_half), np.ptp(second_half)

        if dc1 < 1: dc1 = 1
        if dc2 < 1: dc2 = 1
        if ac1 < 1: ac1 = 1
        if ac2 < 1: ac2 = 1

        ratio = (ac1 / dc1) / (ac2 / dc2)
        variability = ac  # AC component of the window (like irAC on Arduino)
        slope = ac / (ARDUINO_WINDOW / ARDUINO_RATE)  # AC per second

        ratios.append(ratio)
        variabilities.append(variability)
        slopes.append(slope)

    if not ratios:
        return None

    return {
        'ratio': np.mean(ratios),
        'variability': np.mean(variabilities),
        'slope': np.mean(slopes),
    }


import zlib
import struct

def load_label_mat(filepath):
    """
    Extract demographic/glucose values directly from the zlib compressed streams
    in MATLAB v7 table objects since scipy.io.loadmat cannot natively parse them.
    Floats in the tables are clustered: [Age, Glucose, Height, Weight]
    """
    try:
        with open(filepath, 'rb') as f:
            data = f.read()
            
        offset = 128 # Skip MAT header
        floats = []
        while offset < len(data):
            tag_type, tag_bytes = struct.unpack('<II', data[offset:offset+8])
            offset += 8
            if tag_type == 15: # Compressed data chunk
                d = zlib.decompress(data[offset:offset+tag_bytes])
                for i in range(0, len(d)-7, 8):
                    val, = struct.unpack('<d', d[i:i+8])
                    # Demographic and glucose numbers fall nicely into 0-500 integers
                    if 0 < val < 500 and val.is_integer() and val not in floats:
                        floats.append(int(val))
                offset += tag_bytes

        # From dataset analysis: [Age, Glucose, Height, Weight, ...]
        if len(floats) >= 4:
            # Extract patient ID from the filepath (e.g. label_01_0001.mat -> 1)
            try:
                # E.g., 'label_01_0001.mat' -> '01'
                pat_id_str = os.path.basename(filepath).split('_')[1]
                pat_id = int(pat_id_str)
            except:
                pat_id = 0

            return {
                'patient_id': pat_id,
                'gender': 'Unknown',
                'age': float(floats[0]),
                'glucose': float(floats[1]),
                'height': float(floats[2]),
                'weight': float(floats[3])
            }
    except Exception as e:
        print(f"Error parsing label: {e}")
    return None


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════
print("=" * 60)
print("  GlucoSense — Mazandaran Dataset Processor")
print("=" * 60)

# ─── Step 1: Verify signal files exist ────────────────────────
if not os.path.isdir(SIGNAL_FOLDER):
    print(f"\n  ERROR: Signal folder not found!")
    print(f"  Expected: {SIGNAL_FOLDER}")
    print(f"\n  Make sure the 'mazandaran_data' folder exists with")
    print(f"  the .mat signal files from the Mendeley dataset.")
    sys.exit(1)

signal_files = sorted([f for f in os.listdir(SIGNAL_FOLDER) if f.endswith('.mat')])
print(f"\n  Found {len(signal_files)} signal files in mazandaran_data/")

# ─── Step 2: Try to load labels ──────────────────────────────
labels = {}  # key: "XX_XXXX" -> glucose value
has_labels = False

if os.path.isdir(LABEL_FOLDER):
    label_files = sorted([f for f in os.listdir(LABEL_FOLDER) if f.endswith('.mat')])
    print(f"  Found {len(label_files)} label files in mazandaran_labels/")

    for lf in label_files:
        try:
            label_data = load_label_mat(os.path.join(LABEL_FOLDER, lf))
            if label_data and label_data['glucose'] is not None:
                # Extract the ID part: Label_XX_XXXX.mat -> XX_XXXX
                id_part = lf.lower().replace('label_', '').replace('.mat', '')
                labels[id_part] = label_data
                has_labels = True
        except Exception as e:
            print(f"  WARNING: Could not read {lf}: {e}")

    if has_labels:
        unique_patients = set(v['patient_id'] for v in labels.values())
        unique_glucose = set(v['glucose'] for v in labels.values())
        print(f"  Loaded labels for {len(labels)} samples "
              f"({len(unique_patients)} patients)")
        print(f"  Glucose range: {min(unique_glucose):.0f} - {max(unique_glucose):.0f} mg/dL")
else:
    print(f"\n  WARNING: Label folder not found!")
    print(f"  Expected: {LABEL_FOLDER}")
    print(f"")
    print(f"  To get the labels, download the full dataset from:")
    print(f"  https://data.mendeley.com/datasets/37pm7jk7jn/1")
    print(f"")
    print(f"  1. Download PPG_Dataset.zip")
    print(f"  2. Extract the 'Labels' folder")
    print(f"  3. Rename/move it to: mazandaran_labels/")
    print(f"       (place it next to mazandaran_data/)")
    print(f"  4. Run this script again")
    print(f"")
    print(f"  The Labels folder should contain files like:")
    print(f"    Label_01_0001.mat, Label_01_0002.mat, etc.")
    sys.exit(1)

# ─── Step 3: Process each signal file ────────────────────────
print(f"\n{'=' * 60}")
print(f"  Processing {len(signal_files)} signal files...")
print(f"{'=' * 60}")

new_data = []
skipped = 0

for filename in signal_files:
    # Parse filename: signal_XX_XXXX.mat -> XX_XXXX
    id_part = filename.lower().replace('signal_', '').replace('.mat', '')

    # Look up glucose label
    if id_part not in labels:
        print(f"  SKIP: {filename} — no matching label found")
        skipped += 1
        continue

    label = labels[id_part]
    glucose = label['glucose']

    # Load the PPG signal
    filepath = os.path.join(SIGNAL_FOLDER, filename)
    try:
        mat_contents = loadmat(filepath)
        raw_signal = mat_contents['signal'].flatten()
    except Exception as e:
        print(f"  SKIP: {filename} — failed to load: {e}")
        skipped += 1
        continue

    # Extract features
    features = extract_features_from_ppg(raw_signal)
    if features is None:
        print(f"  SKIP: {filename} — signal too short ({len(raw_signal)} samples)")
        skipped += 1
        continue

    bmi = 0
    if label['height'] > 0:
        bmi = label['weight'] / ((label['height']/100) ** 2)

    new_data.append({
        'timestamp': 0,  # placeholder (not used by model)
        'ratio': round(features['ratio'], 4),
        'variability': round(features['variability'], 0),
        'slope': round(features['slope'], 1),
        'heartRate': 75.0, # Placeholder if missing
        'age': round(label['age'], 1),
        'bmi': round(bmi, 1),
        'gender': 1, # Default placeholder for Unknown
        'actual glucose': glucose,
    })

    print(f"  OK: {filename} -> ratio={features['ratio']:.4f}, "
          f"var={features['variability']:.0f}, age={label['age']:.0f}, bmi={bmi:.1f}, glucose={glucose:.0f}")

# ─── Step 4: Save results ────────────────────────────────────
if not new_data:
    print(f"\n  ERROR: No samples were processed successfully!")
    sys.exit(1)

df_new = pd.DataFrame(new_data)

# Save standalone file
df_new.to_csv(OUTPUT_CSV, index=False)

print(f"\n{'=' * 60}")
print(f"  PROCESSING COMPLETE")
print(f"{'=' * 60}")
print(f"  Processed: {len(new_data)} samples")
print(f"  Skipped:   {skipped} samples")
print(f"  Output:    {os.path.basename(OUTPUT_CSV)}")
print(f"")
print(f"  Glucose range: "
      f"{df_new['actual glucose'].min():.0f} - "
      f"{df_new['actual glucose'].max():.0f} mg/dL")
print(f"  Ratio range:   "
      f"{df_new['ratio'].min():.4f} - {df_new['ratio'].max():.4f}")
print(f"  Variability:   "
      f"{df_new['variability'].min():.0f} - {df_new['variability'].max():.0f}")

# ─── Step 5: Optionally merge with existing BSM_dataset ──────
BSM_FILE = os.path.join(os.path.dirname(__file__), 'BSM_dataset.csv')
if os.path.exists(BSM_FILE):
    df_existing = pd.read_csv(BSM_FILE)
    df_existing.columns = df_existing.columns.str.strip()
    df_combined = pd.concat([df_existing, df_new], ignore_index=True)

    combined_path = os.path.join(os.path.dirname(__file__), 'BSM_dataset_combined.csv')
    df_combined.to_csv(combined_path, index=False)

    print(f"\n  Combined dataset saved:")
    print(f"    Original BSM:  {len(df_existing)} rows")
    print(f"    + Mazandaran:  {len(df_new)} rows")
    print(f"    = Combined:    {len(df_combined)} rows")
    print(f"    File: {os.path.basename(combined_path)}")
    print(f"")
    print(f"  To train with the combined dataset, update train_model.py:")
    print(f"    CSV_FILE = 'BSM_dataset_combined.csv'")

print(f"\n{'=' * 60}")
print(f"  Next Steps:")
print(f"{'=' * 60}")
print(f"  1. Review Maharashtra_Processed.csv for data quality")
print(f"  2. Run: python train_model.py")
print(f"     (or update CSV_FILE to use the combined dataset)")
print(f"  3. The trained model will be exported to GlucoseModel.h")
print(f"{'=' * 60}")