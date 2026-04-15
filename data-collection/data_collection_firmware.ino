/*
 * ============================================================
 *  GlucoSense — Data Collection Firmware
 * ============================================================
 *  Flash this to your ESP32 while collecting calibration data.
 *  Works with: collect_data.py on your PC.
 *
 *  Protocol:
 *    PC sends  → "SCAN\n"   (start a 2-second capture)
 *    ESP sends → "DATA:<red>,<ir>"  x 200 samples
 *    ESP sends → "[DONE]"   (scan complete)
 *
 *  Wiring: Same as main firmware (SDA→21, SCL→22, 3.3V, GND)
 * ============================================================
 */

#include <Wire.h>
#include "MAX30105.h"

MAX30105 particleSensor;

const int NUM_SAMPLES  = 200;
const int SAMPLE_RATE  = 100;
const int LED_PIN      = 2;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.println("[BOOT] GlucoSense Data Collection Mode");

  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("[ERROR] MAX30105 not found! Check wiring.");
    while (1) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      delay(200);
    }
  }

  // Same settings as production firmware
  particleSensor.setup(60, 4, 2, SAMPLE_RATE, 411, 4096);
  particleSensor.setPulseAmplitudeRed(0x3C);
  particleSensor.setPulseAmplitudeIR(0x3C);

  Serial.println("[READY] Waiting for SCAN command...");
  digitalWrite(LED_PIN, HIGH);
}

void loop() {
  // Wait for the SCAN command from the PC
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "SCAN") {
      performScan();
    }
  }

  // Also show if a finger is present (helpful for user)
  static unsigned long lastCheck = 0;
  if (millis() - lastCheck > 1000) {
    lastCheck = millis();
    uint32_t ir = particleSensor.getIR();
    if (ir < 50000) {
      Serial.println("[STATUS] No finger detected");
      digitalWrite(LED_PIN, HIGH);
    } else {
      Serial.println("[STATUS] Finger detected — ready to scan");
      digitalWrite(LED_PIN, LOW);
    }
  }
}

void performScan() {
  // Check finger presence
  if (particleSensor.getIR() < 50000) {
    Serial.println("[WARN] No finger detected! Place finger first.");
    return;
  }

  Serial.println("[SCAN] Starting data capture...");
  digitalWrite(LED_PIN, LOW);

  // Flush old FIFO data
  particleSensor.clearFIFO();
  delay(50);

  // Stabilization period — discard first 50 samples
  Serial.println("[SCAN] Stabilizing signal...");
  for (int i = 0; i < 50; i++) {
    while (!particleSensor.available())
      particleSensor.check();
    particleSensor.getRed();
    particleSensor.getIR();
    particleSensor.nextSample();
  }

  // Collect and transmit samples
  Serial.println("[SCAN] Collecting samples...");
  for (int i = 0; i < NUM_SAMPLES; i++) {
    while (!particleSensor.available())
      particleSensor.check();

    uint32_t red = particleSensor.getRed();
    uint32_t ir  = particleSensor.getIR();
    particleSensor.nextSample();

    // Output in the format expected by the Python script
    Serial.print("DATA:");
    Serial.print(red);
    Serial.print(",");
    Serial.println(ir);
  }

  Serial.println("[DONE] Scan complete.");
  digitalWrite(LED_PIN, HIGH);
}
