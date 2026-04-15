"""
GlucoSense — Simple Polynomial SVR Model Trainer
=================================================
Uses only ratio & variability (basic features) with polynomial kernel.
Generates GlucoseModel.h for Arduino.
"""

import pandas as pd
import numpy as np
from sklearn.svm import SVR
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import LeaveOneOut
from sklearn.metrics import mean_absolute_error
import sys
import os

CSV_FILE = 'BSM_dataset_combined.csv'

if not os.path.exists(CSV_FILE):
    print(f"ERROR: '{CSV_FILE}' not found!")
    sys.exit(1)

# -------------------------------------------------------------------------
# 1. Load & Clean Data
# -------------------------------------------------------------------------
df = pd.read_csv(CSV_FILE)
df.columns = df.columns.str.strip()

glucose_col = 'actual glucose'   # from your CSV
if glucose_col not in df.columns:
    for col in df.columns:
        if 'glucose' in col.lower():
            glucose_col = col
            break

y = df[glucose_col].values
feat_cols = ['ratio', 'variability']
X = df[feat_cols].values

# Drop rows with missing features or glucose
mask = np.isfinite(X).all(axis=1) & np.isfinite(y)
X_clean = X[mask]
y_clean = y[mask]

print(f"Using {len(y_clean)} complete samples")
print(f"Features: {feat_cols}")
print(f"Glucose range: {y_clean.min():.0f} – {y_clean.max():.0f} mg/dL")

# -------------------------------------------------------------------------
# 2. Hyperparameter Search (Polynomial Kernel)
# -------------------------------------------------------------------------
print("\nSearching best polynomial SVR parameters...")

best_mae = float('inf')
best_params = {}
best_preds = None

C_vals = [1, 5, 10, 50, 100]
gamma_vals = [0.1, 0.3, 0.5, 1.0, 'scale']
eps_vals = [0.01, 0.05, 0.1, 0.2]
degree_vals = [2, 3]

for C in C_vals:
    for gamma in gamma_vals:
        for eps in eps_vals:
            for deg in degree_vals:
                preds = np.zeros(len(y_clean))
                loo = LeaveOneOut()
                for train_idx, test_idx in loo.split(X_clean):
                    scaler = StandardScaler().fit(X_clean[train_idx])
                    X_train = scaler.transform(X_clean[train_idx])
                    X_test  = scaler.transform(X_clean[test_idx])
                    model = SVR(kernel='poly', degree=deg, C=C, gamma=gamma, epsilon=eps)
                    model.fit(X_train, y_clean[train_idx])
                    preds[test_idx] = model.predict(X_test)
                mae = mean_absolute_error(y_clean, preds)
                if mae < best_mae:
                    best_mae = mae
                    best_params = {'C': C, 'gamma': gamma, 'epsilon': eps, 'degree': deg}
                    best_preds = preds.copy()

acc = (1 - best_mae / y_clean.mean()) * 100
print(f"Best MAE: {best_mae:.2f} mg/dL")
print(f"Accuracy: {acc:.2f}%")
print(f"Best params: {best_params}")

# -------------------------------------------------------------------------
# 3. Train Final Model on All Data
# -------------------------------------------------------------------------
print("\nTraining final model...")
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X_clean)
final_model = SVR(kernel='poly', **best_params)
final_model.fit(X_scaled, y_clean)

# -------------------------------------------------------------------------
# 4. Generate GlucoseModel.h
# -------------------------------------------------------------------------
sv = final_model.support_vectors_
dc = final_model.dual_coef_[0]
intercept = final_model.intercept_[0]
gamma_val = final_model._gamma
degree_val = best_params['degree']
means = scaler.mean_
stds = scaler.scale_

lines = [
    "// GlucoseModel.h — Polynomial SVR (ratio + variability)",
    f"// Trained on {len(y_clean)} samples | MAE = {best_mae:.2f} mg/dL | Acc = {acc:.1f}%",
    f"// Glucose range: {y_clean.min():.0f}-{y_clean.max():.0f} mg/dL",
    f"// Kernel: poly, degree={degree_val}, C={best_params['C']}, gamma={best_params['gamma']}, eps={best_params['epsilon']}",
    "// DISCLAIMER: Experimental only. Not for medical use.",
    "",
    "#ifndef GLUCOSE_MODEL_H",
    "#define GLUCOSE_MODEL_H",
    "",
    "#include <math.h>",
    "",
    f"static const int N_FEATURES = 2;",
    f"static const int N_SUPPORT = {len(sv)};",
    "",
    f"static const double FEAT_MEAN[2] = {{{means[0]:.10f}, {means[1]:.10f}}};",
    f"static const double FEAT_STD[2]  = {{{stds[0]:.10f}, {stds[1]:.10f}}};",
    "",
    f"static const double GAMMA = {gamma_val:.10f};",
    f"static const double COEF0 = 0.0;",
    f"static const int DEGREE = {degree_val};",
    f"static const double INTERCEPT = {intercept:.10f};",
    "",
    f"static const double SUPPORT_VECTORS[{len(sv)}][2] = {{"
]

for i, s in enumerate(sv):
    comma = ',' if i < len(sv)-1 else ''
    lines.append(f"    {{{s[0]:.10f}, {s[1]:.10f}}}{comma}")
lines.append("};")
lines.append("")
lines.append(f"static const double DUAL_COEFS[{len(dc)}] = {{")
for i, d in enumerate(dc):
    comma = ',' if i < len(dc)-1 else ''
    lines.append(f"    {d:.10f}{comma}")
lines.append("};")
lines.append("")
lines.append("double predictGlucoseSVR(double ratio, double variability) {")
lines.append("    double input[2] = {ratio, variability};")
lines.append("    double scaled[2];")
lines.append("    for (int j = 0; j < 2; j++) {")
lines.append("        scaled[j] = (input[j] - FEAT_MEAN[j]) / FEAT_STD[j];")
lines.append("    }")
lines.append("    double result = INTERCEPT;")
lines.append("    for (int i = 0; i < N_SUPPORT; i++) {")
lines.append("        double dot = scaled[0]*SUPPORT_VECTORS[i][0] + scaled[1]*SUPPORT_VECTORS[i][1];")
lines.append("        double kernel_val = GAMMA * dot + COEF0;")
lines.append("        double poly_val = 1.0;")
lines.append(f"        for (int d = 0; d < DEGREE; d++) poly_val *= kernel_val;")
lines.append("        result += DUAL_COEFS[i] * poly_val;")
lines.append("    }")
lines.append("    if (result < 40.0) result = 40.0;")
lines.append("    if (result > 400.0) result = 400.0;")
lines.append("    return result;")
lines.append("}")
lines.append("")
lines.append("#endif")

with open('GlucoseModel.h', 'w') as f:
    f.write('\n'.join(lines))

print("\nGlucoseModel.h generated successfully.")
print("Copy it to your Arduino sketch folder.")
print("\nArduino usage:")
print("  float glucose = predictGlucoseSVR(ratio, variability);")