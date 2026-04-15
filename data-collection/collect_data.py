"""
=============================================================================
  GlucoSense — PPG Data Collection & Calibration Tool
=============================================================================
  Run this on your PC while the ESP32 streams raw sensor data over serial.
  For each scan, you enter the REAL glucose reading from a standard
  glucometer, and the script logs the paired (features → glucose) row
  into a growing CSV that you then feed to the training script.

  Usage:
    1. Flash "data_collection_firmware.ino" to ESP32
    2. Connect ESP32 via USB
    3. Run:  python collect_data.py --port COM3        (Windows)
             python collect_data.py --port /dev/ttyUSB0 (Linux)
    4. Follow on-screen prompts

  Requirements:
    pip install pyserial numpy pandas
=============================================================================
"""

import serial
import numpy as np
import pandas as pd
import argparse
import os
import time
from datetime import datetime

# ─── Configuration ──────────────────────────────────────────
BAUD_RATE      = 115200
NUM_SAMPLES    = 200          # Must match firmware
SAMPLE_RATE    = 100          # Hz — must match firmware
CSV_FILE       = "BSM_dataset.csv"

def extract_features(red_samples, ir_samples):
    """
    Extract PPG features from raw sensor buffers.
    Must EXACTLY match the firmware feature extraction logic.
    """
    red = np.array(red_samples, dtype=np.float64)
    ir  = np.array(ir_samples, dtype=np.float64)

    red_dc = np.mean(red)
    ir_dc  = np.mean(ir)

    red_ac = np.max(red) - np.min(red)
    ir_ac  = np.max(ir)  - np.min(ir)

    # Guard against division by zero
    if red_dc < 1: red_dc = 1
    if ir_dc  < 1: ir_dc  = 1
    if ir_ac  < 1: ir_ac  = 1

    ratio       = (red_ac / red_dc) / (ir_ac / ir_dc)
    variability = ir_ac
    slope       = ir_ac / (NUM_SAMPLES / SAMPLE_RATE)

    # Additional features for improved models
    red_std = np.std(red)
    ir_std  = np.std(ir)

    # Perfusion Index (PI) — clinically meaningful
    red_pi = (red_ac / red_dc) * 100
    ir_pi  = (ir_ac  / ir_dc)  * 100

    # Signal-to-Noise Ratio proxy
    ir_snr = ir_ac / ir_std if ir_std > 0 else 0

    # Peak counting for heart rate
    threshold = np.mean(ir)
    above = ir > threshold
    crossings = np.diff(above.astype(int))
    peaks = np.sum(crossings == 1)
    duration_sec = NUM_SAMPLES / SAMPLE_RATE
    heart_rate = (peaks / duration_sec) * 60

    return {
        "ratio":       round(ratio, 6),
        "variability": round(variability, 2),
        "slope":       round(slope, 4),
        "red_ac":      round(red_ac, 2),
        "ir_ac":       round(ir_ac, 2),
        "red_dc":      round(red_dc, 2),
        "ir_dc":       round(ir_dc, 2),
        "red_pi":      round(red_pi, 4),
        "ir_pi":       round(ir_pi, 4),
        "ir_snr":      round(ir_snr, 4),
        "heart_rate":  round(heart_rate, 1),
    }


def collect_samples(ser):
    """
    Read NUM_SAMPLES pairs of (red, ir) values from serial.
    The ESP32 firmware prints: "DATA:<red>,<ir>" for each sample.
    """
    red_buf = []
    ir_buf  = []

    print(f"\n  Collecting {NUM_SAMPLES} samples...")
    while len(red_buf) < NUM_SAMPLES:
        line = ser.readline().decode("utf-8", errors="ignore").strip()

        if line.startswith("DATA:"):
            parts = line[5:].split(",")
            if len(parts) == 2:
                try:
                    red_buf.append(int(parts[0]))
                    ir_buf.append(int(parts[1]))
                except ValueError:
                    continue

        elif line.startswith("["):
            # Status messages from firmware
            print(f"  {line}")

    return red_buf, ir_buf


def main():
    parser = argparse.ArgumentParser(description="GlucoSense Data Collector")
    parser.add_argument("--port", required=True, help="Serial port (e.g., COM3, /dev/ttyUSB0)")
    parser.add_argument("--baud", type=int, default=BAUD_RATE, help="Baud rate")
    parser.add_argument("--output", default=CSV_FILE, help="Output CSV file")
    parser.add_argument("--scans", type=int, default=3, help="Readings per glucose value (default: 3)")
    args = parser.parse_args()

    print("=" * 60)
    print("  GlucoSense — PPG Calibration Data Collector")
    print("=" * 60)

    # Load existing data if present
    if os.path.exists(args.output):
        df = pd.read_csv(args.output)
        print(f"\n  Loaded existing dataset: {len(df)} rows from {args.output}")
    else:
        df = pd.DataFrame()
        print(f"\n  Starting new dataset: {args.output}")

    # Open serial connection
    print(f"\n  Connecting to {args.port} @ {args.baud}...")
    try:
        ser = serial.Serial(args.port, args.baud, timeout=5)
        time.sleep(2)  # Wait for ESP32 to boot
        ser.flushInput()
        print("  Connected!\n")
    except serial.SerialException as e:
        print(f"  ERROR: {e}")
        return

    session_count = 0

    try:
        while True:
            print("─" * 60)
            glucose_input = input("  Enter REAL glucometer reading (mg/dL), or 'q' to quit: ").strip()

            if glucose_input.lower() == 'q':
                break

            try:
                actual_glucose = float(glucose_input)
            except ValueError:
                print("  Invalid number. Try again.")
                continue

            if actual_glucose < 20 or actual_glucose > 600:
                print("  Warning: Value outside typical range (20-600 mg/dL). Continue? (y/n)")
                if input("  ").strip().lower() != 'y':
                    continue

            # Take multiple scans for this glucose reading
            for scan in range(args.scans):
                print(f"\n  === Scan {scan + 1}/{args.scans} ===")
                print("  Place finger on sensor and keep PERFECTLY STILL...")
                input("  Press Enter when ready...")

                # Signal the ESP32 to start scanning
                ser.write(b"SCAN\n")
                ser.flush()

                red_buf, ir_buf = collect_samples(ser)
                features = extract_features(red_buf, ir_buf)

                # Add metadata
                row = {
                    "timestamp":      datetime.now().isoformat(),
                    "actual_glucose": actual_glucose,
                    **features,
                }

                # Append to DataFrame
                new_row = pd.DataFrame([row])
                df = pd.concat([df, new_row], ignore_index=True)
                session_count += 1

                print(f"\n  ✓ Recorded! Ratio={features['ratio']:.4f}  "
                      f"Var={features['variability']:.0f}  "
                      f"HR≈{features['heart_rate']:.0f} bpm")
                print(f"  Total rows: {len(df)}")

                # Save after every scan (crash-safe)
                df.to_csv(args.output, index=False)

                if scan < args.scans - 1:
                    print("  Lift finger, wait 3 seconds, then place again...")
                    time.sleep(3)

    except KeyboardInterrupt:
        print("\n\n  Interrupted.")

    finally:
        ser.close()
        df.to_csv(args.output, index=False)
        print(f"\n{'=' * 60}")
        print(f"  Session complete!")
        print(f"  New rows this session: {session_count}")
        print(f"  Total rows in dataset: {len(df)}")
        print(f"  Saved to: {args.output}")

        if len(df) > 0:
            print(f"\n  Dataset summary:")
            print(f"    Glucose range: {df['actual_glucose'].min():.0f} - {df['actual_glucose'].max():.0f} mg/dL")
            print(f"    Unique glucose values: {df['actual_glucose'].nunique()}")
            print(f"    Ratio range: {df['ratio'].min():.4f} - {df['ratio'].max():.4f}")

        print(f"\n  Next: Run the training script:")
        print(f"    python train_model.py --data {args.output}")
        print(f"{'=' * 60}")


if __name__ == "__main__":
    main()