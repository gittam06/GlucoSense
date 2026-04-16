/*
 * ============================================================
 *  GlucoSense v5.0 — Personalized Calibration + SVR Model
 * ============================================================
 *  Features:
 *    - SVR Glucose Model (GlucoseModel.h)
 *    - User profile & personal bias calibration
 *    - Robustness filters (HR smoothing, feature range checks)
 *    - 2.8" TFT UI (Home, History, Settings)
 *    - WiFi + WebSocket dashboard (handles setContext)
 *    - Heart rate + SpO2 estimation
 *
 *  MEDICAL DISCLAIMER: NOT a medical device.
 *
 *  Serial Commands (115200 baud):
 *    - set age <value>        : set user age
 *    - set bmi <value>        : set user BMI
 *    - set gender <0/1>       : 0 = female, 1 = male
 *    - calibrate <ref_value>  : calibrate with reference glucose
 *    - status                 : show current settings
 *    - model basic/demo       : switch between basic and demographic model
 * ============================================================
 */

#include <Wire.h>
#include <SPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include "MAX30105.h"
#include <TFT_eSPI.h>
#include "GlucoseModel.h"

// ─── WiFi ──────────────────────────────────────────
const char* WIFI_SSID     = "Choti-Advance";
const char* WIFI_PASSWORD = "luCifer@78381";
const char* AP_SSID       = "GlucoSense-ESP32";
const char* AP_PASSWORD   = "glucose123";

// ─── Objects ───────────────────────────────────────
MAX30105 particleSensor;
TFT_eSPI tft = TFT_eSPI();
WebServer httpServer(80);
WebSocketsServer wsServer(81);

// ─── Touch Calibration ─────────────────────────────
uint16_t touchCalData[5] = { 275, 3620, 264, 3532, 1 };

// ─── Sensor Config ─────────────────────────────────
const int NUM_SAMPLES = 200;
const int SAMPLE_RATE = 100;

uint32_t irBuffer[NUM_SAMPLES];
uint32_t redBuffer[NUM_SAMPLES];

// ─── Display Constants (Landscape 320x240) ─────────
#define SCR_W 320
#define SCR_H 240

// Colors (RGB565) - Cyber Midnight Theme
#define BG_COLOR       0x0000
#define CARD_COLOR     0x0825
#define CARD_BORDER    0x18C6
#define TEXT_PRIMARY   0xFFFF
#define TEXT_SECONDARY 0x8410
#define CYAN           0x07FF
#define GREEN          0x07E0
#define ORANGE         0xFD20
#define RED            0xF800
#define PURPLE         0xB01F
#define YELLOW         0xFFE0
#define BLUE           0x03FF

// ─── State ─────────────────────────────────────────
struct Reading {
  float glucose;
  float ratio;
  float variability;
  float heartRate;
  float spO2;
  bool  fingerDetected;
  unsigned long timestamp;
};

Reading latestReading = {0};
Reading history[10];
int histCount = 0;
int histIdx = 0;
bool isScanning = false;
String deviceID;
String ipAddress = "Not connected";

enum Page { PAGE_HOME, PAGE_HISTORY, PAGE_SETTINGS };
Page currentPage = PAGE_HOME;
bool needsRedraw = true;
unsigned long lastTouchTime = 0;

// ─── User Profile & Calibration ────────────────────
float userAge      = 30.0;
float userBMI      = 24.0;
float userGender   = 1.0;
bool  isCalibrated = false;
float personalBias = 0.0;

enum ModelType { MODEL_BASIC, MODEL_DEMOGRAPHIC };
ModelType currentModel = MODEL_BASIC;

// Heart rate smoothing
float smoothedHR = 0;
#define HR_ALPHA 0.3

// ─── Forward Declarations ──────────────────────────
void collectSamples();
void processAndPredict();
void broadcastReading();
void broadcastEvent(const char* evt, const char* msg);
float estimateHeartRate();
float estimateSpO2(float ratio);
bool isFingerPresent();
void drawHomePage();
void drawHistoryPage();
void drawSettingsPage();
void drawNavBar();
void drawGauge(int cx, int cy, int r, float value);
void handleTouch();
void handleSerialCommands();
void calibrateWithReference(float refGlucose);

// ════════════════════════════════════════════════════
//  DISPLAY DRAWING FUNCTIONS
// ════════════════════════════════════════════════════

uint16_t glucoseColor(float g) {
  if (g < 70)  return YELLOW;
  if (g <= 140) return GREEN;
  if (g <= 200) return ORANGE;
  return RED;
}

void drawRoundRect(int x, int y, int w, int h, uint16_t color, uint16_t border) {
  tft.fillRoundRect(x, y, w, h, 6, color);
  tft.drawRoundRect(x, y, w, h, 6, border);
}

void drawNavBar() {
  int navY = SCR_H - 36;
  tft.fillRect(0, navY, SCR_W, 36, CARD_COLOR);
  tft.drawFastHLine(0, navY, SCR_W, CARD_BORDER);

  const char* labels[] = {"Home", "History", "Settings"};
  const Page pages[] = {PAGE_HOME, PAGE_HISTORY, PAGE_SETTINGS};

  for (int i = 0; i < 3; i++) {
    int bx = i * (SCR_W / 3);
    int bw = SCR_W / 3;
    uint16_t col = (currentPage == pages[i]) ? CYAN : TEXT_SECONDARY;
    tft.setTextColor(col, CARD_COLOR);
    tft.setTextDatum(MC_DATUM);
    tft.setTextFont(2);
    tft.drawString(labels[i], bx + bw / 2, navY + 18);
  }
}

void drawGauge(int cx, int cy, int radius, float value) {
  for (int a = -120; a <= 120; a += 2) {
    float rad = a * PI / 180.0;
    int x = cx + (radius) * cos(rad);
    int y = cy + (radius) * sin(rad);
    tft.drawPixel(x, y, CARD_BORDER);
    tft.drawPixel(cx + (radius - 1) * cos(rad), cy + (radius - 1) * sin(rad), CARD_BORDER);
  }

  for (int a = -120; a <= 120; a++) {
    float rad = a * PI / 180.0;
    uint16_t col;
    if (a < -51) col = YELLOW;
    else if (a < 72) col = GREEN;
    else if (a < 96) col = ORANGE;
    else col = RED;

    int x1 = cx + (radius - 2) * cos(rad);
    int y1 = cy + (radius - 2) * sin(rad);
    int x2 = cx + (radius - 5) * cos(rad);
    int y2 = cy + (radius - 5) * sin(rad);
    tft.drawLine(x1, y1, x2, y2, col);
  }

  if (value > 0) {
    float clamped = constrain(value, 40, 300);
    float angle = ((clamped - 40.0) / 260.0) * 240.0 - 120.0;
    float rad = angle * PI / 180.0;
    uint16_t nColor = glucoseColor(value);
    int nx = cx + (radius - 12) * cos(rad);
    int ny = cy + (radius - 12) * sin(rad);
    tft.drawLine(cx, cy, nx, ny, nColor);
    tft.drawLine(cx + 1, cy, nx + 1, ny, nColor);
    tft.fillCircle(cx, cy, 3, nColor);
  }

  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(4);
  if (value > 0) {
    tft.setTextColor(glucoseColor(value), BG_COLOR);
    tft.drawString(String((int)value), cx, cy + 22);
  } else {
    tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
    tft.drawString("---", cx, cy + 22);
  }

  tft.setTextFont(1);
  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  tft.drawString("mg/dL", cx, cy + 40);
}

void drawHomePage() {
  tft.fillScreen(BG_COLOR);

  tft.setTextFont(2);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(CYAN, BG_COLOR);
  tft.drawString("GlucoSense", 8, 4);

  uint16_t stCol = (WiFi.status() == WL_CONNECTED) ? GREEN : RED;
  tft.fillCircle(SCR_W - 12, 10, 4, stCol);

  drawGauge(100, 100, 55, latestReading.glucose);

  if (latestReading.glucose > 0) {
    const char* zoneText;
    uint16_t zoneCol;
    if (latestReading.glucose < 70) { zoneText = "LOW"; zoneCol = YELLOW; }
    else if (latestReading.glucose <= 140) { zoneText = "NORMAL"; zoneCol = GREEN; }
    else if (latestReading.glucose <= 200) { zoneText = "ELEVATED"; zoneCol = ORANGE; }
    else { zoneText = "HIGH"; zoneCol = RED; }

    tft.setTextDatum(MC_DATUM);
    tft.setTextFont(1);
    tft.setTextColor(zoneCol, BG_COLOR);
    tft.drawString(zoneText, 100, 150);
  }

  int rx = 170, ry = 28, rw = 142, rh = 44;

  drawRoundRect(rx, ry, rw, rh, CARD_COLOR, CARD_BORDER);
  tft.setTextFont(1);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TEXT_SECONDARY, CARD_COLOR);
  tft.drawString("HEART RATE", rx + 8, ry + 4);
  tft.setTextFont(4);
  tft.setTextColor(0xF810, CARD_COLOR);
  if (latestReading.heartRate > 0) {
    tft.drawString(String((int)latestReading.heartRate), rx + 8, ry + 16);
    tft.setTextFont(1);
    tft.setTextColor(TEXT_SECONDARY, CARD_COLOR);
    tft.drawString("bpm", rx + 80, ry + 26);
  } else {
    tft.drawString("---", rx + 8, ry + 16);
  }

  ry += rh + 6;
  drawRoundRect(rx, ry, rw, rh, CARD_COLOR, CARD_BORDER);
  tft.setTextFont(1);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TEXT_SECONDARY, CARD_COLOR);
  tft.drawString("SPO2", rx + 8, ry + 4);
  tft.setTextFont(4);
  tft.setTextColor(BLUE, CARD_COLOR);
  if (latestReading.spO2 > 0) {
    tft.drawString(String(latestReading.spO2, 1), rx + 8, ry + 16);
    tft.setTextFont(1);
    tft.setTextColor(TEXT_SECONDARY, CARD_COLOR);
    tft.drawString("%", rx + 100, ry + 26);
  } else {
    tft.drawString("---", rx + 8, ry + 16);
  }

  ry += rh + 6;
  drawRoundRect(rx, ry, rw, rh, CARD_COLOR, CARD_BORDER);
  tft.setTextFont(1);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TEXT_SECONDARY, CARD_COLOR);
  tft.drawString("R RATIO", rx + 8, ry + 4);
  tft.setTextFont(4);
  tft.setTextColor(PURPLE, CARD_COLOR);
  if (latestReading.ratio > 0) {
    tft.drawString(String(latestReading.ratio, 3), rx + 8, ry + 16);
  } else {
    tft.drawString("---", rx + 8, ry + 16);
  }

  if (isCalibrated) {
    tft.setTextDatum(TL_DATUM);
    tft.setTextFont(1);
    tft.setTextColor(GREEN, BG_COLOR);
    tft.drawString("CAL", 5, SCR_H - 52);
  }

  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(2);
  if (isScanning) {
    tft.setTextColor(CYAN, BG_COLOR);
    tft.drawString("Scanning...", SCR_W / 2, SCR_H - 52);
  } else if (!latestReading.fingerDetected) {
    tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
    tft.drawString("Place finger on sensor", SCR_W / 2, SCR_H - 52);
  } else {
    tft.setTextColor(GREEN, BG_COLOR);
    tft.drawString("Scan complete", SCR_W / 2, SCR_H - 52);
  }

  drawNavBar();
}

void drawHistoryPage() {
  tft.fillScreen(BG_COLOR);

  tft.setTextFont(2);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(CYAN, BG_COLOR);
  tft.drawString("History", 8, 4);

  tft.setTextFont(1);
  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  tft.drawString("Last 10 readings", 8, 22);

  if (histCount == 0) {
    tft.setTextDatum(MC_DATUM);
    tft.setTextFont(2);
    tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
    tft.drawString("No readings yet", SCR_W / 2, 100);
    drawNavBar();
    return;
  }

  int chartX = 20, chartY = 40, chartW = SCR_W - 40, chartH = 100;
  tft.drawRect(chartX, chartY, chartW, chartH, CARD_BORDER);

  int y70  = chartY + chartH - (int)(((70.0 - 40) / 260.0) * chartH);
  int y140 = chartY + chartH - (int)(((140.0 - 40) / 260.0) * chartH);
  tft.drawFastHLine(chartX, y70, chartW, 0x0320);
  tft.drawFastHLine(chartX, y140, chartW, 0x0320);

  tft.setTextFont(1);
  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  tft.setTextDatum(MR_DATUM);
  tft.drawString("70", chartX - 2, y70);
  tft.drawString("140", chartX - 2, y140);

  int n = min(histCount, 10);
  int barW = max(4, (chartW - 20) / n - 2);

  for (int i = 0; i < n; i++) {
    int idx = (histIdx - n + i + 10) % 10;
    float g = history[idx].glucose;
    if (g <= 0) continue;

    int barH = (int)(((g - 40) / 260.0) * chartH);
    barH = constrain(barH, 2, chartH - 2);
    int bx = chartX + 10 + i * (barW + 2);
    int by = chartY + chartH - barH;

    tft.fillRect(bx, by, barW, barH, glucoseColor(g));
  }

  int listY = chartY + chartH + 10;
  tft.setTextFont(1);

  for (int i = 0; i < min(n, 5); i++) {
    int idx = (histIdx - 1 - i + 10) % 10;
    Reading& r = history[idx];
    if (r.glucose <= 0) continue;

    int ly = listY + i * 16;
    uint16_t gc = glucoseColor(r.glucose);
    tft.fillRect(8, ly, 3, 12, gc);

    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(gc, BG_COLOR);
    tft.setTextFont(2);
    tft.drawString(String((int)r.glucose), 16, ly - 2);

    tft.setTextFont(1);
    tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
    tft.drawString("mg/dL", 55, ly + 2);

    if (r.heartRate > 0) {
      tft.drawString(String((int)r.heartRate) + "bpm", 110, ly + 2);
    }
    if (r.spO2 > 0) {
      tft.drawString("SpO2:" + String(r.spO2, 1), 180, ly + 2);
    }

    unsigned long secsAgo = (millis() - r.timestamp) / 1000;
    String timeStr;
    if (secsAgo < 60) timeStr = String(secsAgo) + "s ago";
    else if (secsAgo < 3600) timeStr = String(secsAgo / 60) + "m ago";
    else timeStr = String(secsAgo / 3600) + "h ago";
    tft.drawString(timeStr, 260, ly + 2);
  }

  drawNavBar();
}

void drawSettingsPage() {
  tft.fillScreen(BG_COLOR);

  tft.setTextFont(2);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(CYAN, BG_COLOR);
  tft.drawString("Settings", 8, 4);

  int y = 30;
  tft.setTextFont(1);

  drawRoundRect(8, y, SCR_W - 16, 50, CARD_COLOR, CARD_BORDER);
  tft.setTextColor(TEXT_SECONDARY, CARD_COLOR);
  tft.drawString("WIFI STATUS", 16, y + 4);
  tft.setTextFont(2);
  if (WiFi.status() == WL_CONNECTED) {
    tft.setTextColor(GREEN, CARD_COLOR);
    tft.drawString("Connected", 16, y + 16);
    tft.setTextFont(1);
    tft.setTextColor(CYAN, CARD_COLOR);
    tft.drawString("IP: " + ipAddress, 16, y + 34);
  } else {
    tft.setTextColor(RED, CARD_COLOR);
    tft.drawString("Disconnected", 16, y + 16);
    tft.setTextFont(1);
    tft.setTextColor(TEXT_SECONDARY, CARD_COLOR);
    tft.drawString("SSID: " + String(WIFI_SSID), 16, y + 34);
  }

  y += 58;
  drawRoundRect(8, y, SCR_W - 16, 55, CARD_COLOR, CARD_BORDER);
  tft.setTextFont(1);
  tft.setTextColor(TEXT_SECONDARY, CARD_COLOR);
  tft.drawString("CALIBRATION", 16, y + 4);
  tft.setTextColor(TEXT_PRIMARY, CARD_COLOR);
  tft.drawString("Status: " + String(isCalibrated ? "Calibrated" : "Not calibrated"), 16, y + 16);
  if (isCalibrated) {
    tft.drawString("Bias: " + String(personalBias, 1) + " mg/dL", 16, y + 28);
  } else {
    tft.drawString("Send 'calibrate <ref>' via Serial", 16, y + 28);
  }
  tft.drawString("Age: " + String(userAge,0) + "  BMI: " + String(userBMI,1) + "  Sex: " + (userGender>0.5?"M":"F"), 16, y + 40);

  y += 63;
  drawRoundRect(8, y, SCR_W - 16, 55, CARD_COLOR, CARD_BORDER);
  tft.setTextFont(1);
  tft.setTextColor(TEXT_SECONDARY, CARD_COLOR);
  tft.drawString("DEVICE INFO", 16, y + 4);
  tft.setTextColor(TEXT_PRIMARY, CARD_COLOR);
  tft.drawString("Sensor: MAX30105", 16, y + 16);
  tft.drawString("Model: SVR (poly kernel)", 16, y + 28);
  tft.drawString("ID: " + deviceID, 16, y + 40);

  y += 63;
  drawRoundRect(8, y, SCR_W - 16, 40, CARD_COLOR, CARD_BORDER);
  tft.setTextFont(1);
  tft.setTextColor(TEXT_SECONDARY, CARD_COLOR);
  tft.drawString("DASHBOARD", 16, y + 4);
  tft.setTextColor(CYAN, CARD_COLOR);
  if (WiFi.status() == WL_CONNECTED) {
    tft.drawString("http://" + ipAddress, 16, y + 16);
    tft.drawString("ws://" + ipAddress + ":81", 16, y + 26);
  } else {
    tft.drawString("Connect WiFi first", 16, y + 16);
  }

  y += 48;
  tft.setTextColor(YELLOW, BG_COLOR);
  tft.setTextFont(1);
  tft.drawString("! Experimental - not medical", 16, y);
  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  tft.drawString("Never use for clinical decisions", 16, y + 12);

  drawNavBar();
}

void handleTouch() {
  uint16_t x = 0, y = 0;
  if (!tft.getTouch(&x, &y)) return;

  if (millis() - lastTouchTime < 300) return;
  lastTouchTime = millis();

  int tx = map(x, touchCalData[0], touchCalData[1], 0, SCR_W);
  int ty = map(y, touchCalData[2], touchCalData[3], 0, SCR_H);

  if (ty > SCR_H - 36) {
    Page newPage;
    if (tx < SCR_W / 3) newPage = PAGE_HOME;
    else if (tx < 2 * SCR_W / 3) newPage = PAGE_HISTORY;
    else newPage = PAGE_SETTINGS;

    if (newPage != currentPage) {
      currentPage = newPage;
      needsRedraw = true;
    }
  }
}

// ════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  Serial.println("\n========================================");
  Serial.println("  GlucoSense v5.0 — Personalized SVR");
  Serial.println("========================================\n");

  // Display
  tft.init();
  tft.invertDisplay(true);
  tft.setRotation(1);
  tft.setTouch(touchCalData);
  tft.fillScreen(BG_COLOR);
  tft.setTextColor(CYAN, BG_COLOR);
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(4);
  tft.drawString("GlucoSense", SCR_W / 2, 60);
  tft.setTextFont(2);
  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  tft.drawString("Initializing...", SCR_W / 2, 100);

  // Device ID
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  deviceID = String("GS-") + String(macStr).substring(8);

  // MAX30105
  Serial.print("[SENSOR] Initializing... ");
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("FAILED!");
    tft.setTextColor(RED, BG_COLOR);
    tft.drawString("Sensor FAILED!", SCR_W / 2, 160);
    while (1) delay(1000);
  }
  Serial.println("OK");
  particleSensor.setup(60, 4, 2, SAMPLE_RATE, 411, 4096);
  particleSensor.setPulseAmplitudeRed(0x3C);
  particleSensor.setPulseAmplitudeIR(0x3C);

  // WiFi
  Serial.printf("[WIFI] Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    ipAddress = WiFi.localIP().toString();
    Serial.println(" Connected!");
    Serial.printf("[WIFI] IP: %s\n", ipAddress.c_str());
    tft.setTextColor(GREEN, BG_COLOR);
    tft.fillRect(0, 120, SCR_W, 30, BG_COLOR);
    tft.drawString("WiFi Connected!", SCR_W / 2, 130);
    tft.setTextFont(1);
    tft.setTextColor(CYAN, BG_COLOR);
    tft.drawString(ipAddress, SCR_W / 2, 150);
  } else {
    Serial.println("\n[WIFI] Failed — starting AP");
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    ipAddress = WiFi.softAPIP().toString();
    tft.setTextColor(ORANGE, BG_COLOR);
    tft.fillRect(0, 120, SCR_W, 30, BG_COLOR);
    tft.drawString("AP: GlucoSense-ESP32", SCR_W / 2, 130);
  }

  // HTTP + WebSocket
  httpServer.on("/", HTTP_GET, []() {
    httpServer.send(200, "text/plain", "GlucoSense v5.0 API\n  GET /api/status\n  GET /api/reading\n  WS ws://" + ipAddress + ":81\n");
  });
  httpServer.on("/api/status", HTTP_GET, []() {
    JsonDocument doc;
    doc["device"] = deviceID;
    doc["sensor"] = "MAX30105";
    doc["model"] = (currentModel == MODEL_BASIC) ? "Basic SVR" : "Demographic SVR";
    doc["calibrated"] = isCalibrated;
    doc["bias"] = personalBias;
    doc["uptime"] = millis() / 1000;
    doc["ip"] = ipAddress;
    String json; serializeJson(doc, json);
    httpServer.sendHeader("Access-Control-Allow-Origin", "*");
    httpServer.send(200, "application/json", json);
  });
  httpServer.on("/api/reading", HTTP_GET, []() {
    JsonDocument doc;
    doc["glucose"] = latestReading.glucose;
    doc["heartRate"] = latestReading.heartRate;
    doc["spO2"] = latestReading.spO2;
    doc["ratio"] = latestReading.ratio;
    doc["finger"] = latestReading.fingerDetected;
    doc["timestamp"] = latestReading.timestamp;
    String json; serializeJson(doc, json);
    httpServer.sendHeader("Access-Control-Allow-Origin", "*");
    httpServer.send(200, "application/json", json);
  });
  httpServer.begin();
  wsServer.begin();
  wsServer.onEvent([](uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
    if (type == WStype_CONNECTED) Serial.printf("[WS] Client #%u connected\n", num);
    else if (type == WStype_DISCONNECTED) Serial.printf("[WS] Client #%u disconnected\n", num);
    else if (type == WStype_TEXT) {
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, payload);
      if (!err) {
        const char* msgType = doc["type"];
        if (strcmp(msgType, "setContext") == 0) {
          if (doc.containsKey("age")) userAge = doc["age"];
          if (doc.containsKey("gender")) userGender = doc["gender"];
          if (doc.containsKey("bmi")) userBMI = doc["bmi"];
          Serial.printf("[WS] Received context: Age=%.0f, Gender=%.0f, BMI=%.1f\n", userAge, userGender, userBMI);
          currentModel = MODEL_DEMOGRAPHIC;
          needsRedraw = true;
        }
      }
    }
  });
  Serial.println("[HTTP] Server on port 80");
  Serial.println("[WS]   Server on port 81");

  Serial.println("\n>> System ready. Touch screen to navigate.");
  Serial.println(">> Serial commands: set age/bmi/gender, calibrate <ref>, status, model basic/demo\n");
  delay(1500);
  needsRedraw = true;
}

// ════════════════════════════════════════════════════
//  MAIN LOOP
// ════════════════════════════════════════════════════
void loop() {
  httpServer.handleClient();
  wsServer.loop();
  handleTouch();
  handleSerialCommands();

  if (needsRedraw) {
    needsRedraw = false;
    switch (currentPage) {
      case PAGE_HOME:     drawHomePage(); break;
      case PAGE_HISTORY:  drawHistoryPage(); break;
      case PAGE_SETTINGS: drawSettingsPage(); break;
    }
  }

  if (isFingerPresent()) {
    if (!isScanning) {
      isScanning = true;
      latestReading.fingerDetected = true;
      Serial.println("[SCAN] Finger detected. Collecting PPG...");
      broadcastEvent("scanning", "Collecting PPG data...");

      if (currentPage == PAGE_HOME) {
        tft.setTextDatum(MC_DATUM);
        tft.setTextFont(2);
        tft.fillRect(0, SCR_H - 56, SCR_W, 18, BG_COLOR);
        tft.setTextColor(CYAN, BG_COLOR);
        tft.drawString("Scanning...", SCR_W / 2, SCR_H - 52);
      }

      collectSamples();
      processAndPredict();

      if (latestReading.fingerDetected) {
        broadcastReading();
        history[histIdx] = latestReading;
        histIdx = (histIdx + 1) % 10;
        if (histCount < 10) histCount++;

        Serial.println("─────────────────────────────────────");
        Serial.printf("  Glucose: %.1f mg/dL\n", latestReading.glucose);
        Serial.printf("  HR: %.0f bpm | SpO2: %.1f%%\n", latestReading.heartRate, latestReading.spO2);
        Serial.printf("  Ratio: %.3f | Variability: %.1f\n", latestReading.ratio, latestReading.variability);
        if (isCalibrated) Serial.printf("  (Calibrated, bias = %.1f)\n", personalBias);
        Serial.println("─────────────────────────────────────");
      } else {
        if (currentPage == PAGE_HOME) {
          tft.setTextDatum(MC_DATUM);
          tft.setTextFont(2);
          tft.fillRect(0, SCR_H - 56, SCR_W, 18, BG_COLOR);
          tft.setTextColor(ORANGE, BG_COLOR);
          tft.drawString("Unstable – retry", SCR_W / 2, SCR_H - 52);
        }
        delay(2000);
      }

      isScanning = false;
      needsRedraw = true;
      delay(3000);
    }
  } else {
    if (isScanning) {
      isScanning = false;
      latestReading.fingerDetected = false;
      if (currentPage == PAGE_HOME) {
        tft.setTextDatum(MC_DATUM);
        tft.setTextFont(2);
        tft.fillRect(0, SCR_H - 56, SCR_W, 18, BG_COLOR);
        tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
        tft.drawString("Place finger on sensor", SCR_W / 2, SCR_H - 52);
      }
    }
    delay(100);
  }
}

// ════════════════════════════════════════════════════
//  SENSOR FUNCTIONS
// ════════════════════════════════════════════════════
void collectSamples() {
  particleSensor.clearFIFO();
  delay(50);
  for (int i = 0; i < NUM_SAMPLES; i++) {
    while (!particleSensor.available()) particleSensor.check();
    redBuffer[i] = particleSensor.getRed();
    irBuffer[i]  = particleSensor.getIR();
    particleSensor.nextSample();
  }
}

void processAndPredict() {
  float redDC = 0, irDC = 0;
  float redMax = 0, redMin = 4294967295.0;
  float irMax = 0, irMin = 4294967295.0;

  for (int i = 0; i < NUM_SAMPLES; i++) {
    redDC += redBuffer[i];
    irDC += irBuffer[i];
    if (redBuffer[i] > redMax) redMax = redBuffer[i];
    if (redBuffer[i] < redMin) redMin = redBuffer[i];
    if (irBuffer[i] > irMax) irMax = irBuffer[i];
    if (irBuffer[i] < irMin) irMin = irBuffer[i];
  }

  redDC /= NUM_SAMPLES;
  irDC /= NUM_SAMPLES;
  float redAC = redMax - redMin;
  float irAC = irMax - irMin;
  if (redDC < 1) redDC = 1;
  if (irDC < 1) irDC = 1;
  if (irAC < 1) irAC = 1;

  float ratio = (redAC / redDC) / (irAC / irDC);
  float variability = irAC;
  float hr = estimateHeartRate();

  // Feature validation
  bool featuresValid = true;
  if (ratio < 0.3 || ratio > 2.5) {
    Serial.printf("WARN: Ratio out of range (%.3f) – discarding\n", ratio);
    featuresValid = false;
  }
  if (variability < 2000 || variability > 200000) {
    Serial.printf("WARN: Variability out of range (%.0f) – discarding\n", variability);
    featuresValid = false;
  }

  if (!featuresValid) {
    latestReading.fingerDetected = false;
    return;
  }

  float rawGlucose;
  #ifdef DEMOGRAPHIC_MODEL_AVAILABLE
  if (currentModel == MODEL_DEMOGRAPHIC) {
    rawGlucose = predictGlucoseSVR(ratio, variability, hr, userAge, userBMI, userGender);
  } else {
    rawGlucose = predictGlucoseSVR(ratio, variability);
  }
  #else
  rawGlucose = predictGlucoseSVR(ratio, variability);
  #endif

  if (isCalibrated) {
    latestReading.glucose = rawGlucose + personalBias;
  } else {
    latestReading.glucose = rawGlucose;
  }

  // Clamp to plausible prototype range
  if (latestReading.glucose < 50.0) latestReading.glucose = 50.0;
  if (latestReading.glucose > 300.0) latestReading.glucose = 300.0;

  latestReading.ratio = ratio;
  latestReading.variability = variability;
  latestReading.heartRate = hr;
  latestReading.spO2 = estimateSpO2(ratio);
  latestReading.fingerDetected = true;
  latestReading.timestamp = millis();
}

void broadcastReading() {
  JsonDocument doc;
  doc["type"] = "reading";
  doc["glucose"] = latestReading.glucose;
  doc["heartRate"] = latestReading.heartRate;
  doc["spO2"] = latestReading.spO2;
  doc["ratio"] = latestReading.ratio;
  doc["variability"] = latestReading.variability;
  doc["timestamp"] = latestReading.timestamp;
  String json; serializeJson(doc, json);
  wsServer.broadcastTXT(json);
}

void broadcastEvent(const char* evt, const char* msg) {
  JsonDocument doc;
  doc["type"] = "event";
  doc["event"] = evt;
  doc["message"] = msg;
  String json; serializeJson(doc, json);
  wsServer.broadcastTXT(json);
}

bool isFingerPresent() {
  return particleSensor.getIR() > 50000;
}

float estimateHeartRate() {
  int peaks = 0;
  float threshold = 0;
  for (int i = 0; i < NUM_SAMPLES; i++) threshold += irBuffer[i];
  threshold /= NUM_SAMPLES;

  bool above = false;
  for (int i = 1; i < NUM_SAMPLES; i++) {
    if (irBuffer[i] > threshold && !above) {
      peaks++;
      above = true;
    }
    if (irBuffer[i] < threshold) above = false;
  }

  float rawHR = (peaks / (NUM_SAMPLES / (float)SAMPLE_RATE)) * 60.0;

  if (rawHR < 40) rawHR = 40;
  if (rawHR > 180) rawHR = 180;

  if (smoothedHR == 0) {
    smoothedHR = rawHR;
  } else {
    smoothedHR = HR_ALPHA * rawHR + (1 - HR_ALPHA) * smoothedHR;
  }

  return smoothedHR;
}

float estimateSpO2(float ratio) {
  float spo2 = 110.0 - 25.0 * ratio;
  if (spo2 > 100) spo2 = 100;
  if (spo2 < 70) spo2 = 70;
  return spo2;
}

void handleSerialCommands() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() == 0) return;

    if (cmd.startsWith("set age ")) {
      userAge = cmd.substring(8).toFloat();
      Serial.printf("User age set to %.0f\n", userAge);
      needsRedraw = true;
    }
    else if (cmd.startsWith("set bmi ")) {
      userBMI = cmd.substring(8).toFloat();
      Serial.printf("User BMI set to %.1f\n", userBMI);
      needsRedraw = true;
    }
    else if (cmd.startsWith("set gender ")) {
      userGender = cmd.substring(11).toFloat();
      Serial.printf("User gender set to %s\n", (userGender > 0.5) ? "Male" : "Female");
      needsRedraw = true;
    }
    else if (cmd.startsWith("calibrate ")) {
      float ref = cmd.substring(10).toFloat();
      calibrateWithReference(ref);
    }
    else if (cmd == "status") {
      Serial.println("--- GlucoSense Status ---");
      Serial.printf("Model: %s\n", (currentModel == MODEL_BASIC) ? "Basic" : "Demographic");
      Serial.printf("Age: %.0f  BMI: %.1f  Gender: %s\n", userAge, userBMI, (userGender>0.5?"M":"F"));
      Serial.printf("Calibrated: %s\n", isCalibrated ? "Yes" : "No");
      if (isCalibrated) Serial.printf("Bias: %.1f mg/dL\n", personalBias);
      Serial.printf("Last Glucose: %.1f mg/dL\n", latestReading.glucose);
      Serial.printf("WiFi IP: %s\n", ipAddress.c_str());
    }
    else if (cmd == "model basic") {
      currentModel = MODEL_BASIC;
      Serial.println("Switched to basic model (ratio + variability)");
    }
    else if (cmd == "model demo") {
      currentModel = MODEL_DEMOGRAPHIC;
      Serial.println("Switched to demographic model (requires 6-parameter predict function)");
    }
    else {
      Serial.println("Unknown command. Available: set age/bmi/gender, calibrate <ref>, status, model basic/demo");
    }
  }
}

void calibrateWithReference(float refGlucose) {
  if (latestReading.glucose > 0) {
    personalBias = refGlucose - latestReading.glucose;
    isCalibrated = true;
    Serial.printf("Calibration complete. Bias = %.1f mg/dL\n", personalBias);
    needsRedraw = true;
  } else {
    Serial.println("No recent reading to calibrate against. Please take a reading first.");
  }
}