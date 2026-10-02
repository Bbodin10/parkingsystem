// =====================================================================
// Smart Parking System — ESP32 Master Controller (แม่)
// =====================================================================
// รวม 2 หน้าที่:
//   1. อ่าน sensor + ควบคุม servo ของช่อง LOCAL (A1-A3)
//   2. รับค่า sensor จาก ESP32 ลูก ผ่าน ESP-NOW
// ส่ง batch telemetry ทั้งหมดไปที่ Supabase RPC
// และส่ง barrier commands กลับให้ลูกผ่าน ESP-NOW
// =====================================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <esp_now.h>
#include <esp_wifi.h>

// =====================================================================
// ⚙️ CONFIG — เปลี่ยนค่าตรงนี้ให้ตรงกับของคุณ
// =====================================================================

// --- WiFi ---
const char* WIFI_SSID      = "YOUR_WIFI";
const char* WIFI_PASSWORD   = "YOUR_PASSWORD";

// --- Supabase ---
const char* SUPABASE_URL      = "https://mzhxptqrizbhjrssiurk.supabase.co";
const char* SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";  // <<<< anon key เท่านั้น

// --- Controller ID ---
const char* CONTROLLER_DEVICE_ID = "parking-controller-01";

// =====================================================================
// ⚙️ LOCAL HARDWARE CONFIG (ช่องที่ Master ดูแลเอง)
// =====================================================================

const int NUM_LOCAL_SLOTS = 3;
const float OCCUPIED_DISTANCE_CM = 15.0;
const uint8_t CONFIRM_READS = 3;
const int GATE_OPEN_ANGLE   = 90;
const int GATE_CLOSED_ANGLE = 0;

struct SlotState {
  const char* slotId;
  int trigPin;
  int echoPin;
  int servoPin;
  float distanceCm;
  bool confirmedOccupied;
  bool candidateOccupied;
  uint8_t candidateCount;
  bool gateOpen;
  bool isLocal;  // true = อ่านจาก pin, false = รับจาก ESP-NOW
};

// Master ดูแล A1-A3 ด้วย local pins
SlotState localSlots[NUM_LOCAL_SLOTS] = {
  { "A1",  5, 18, 13,  -1, false, false, 0, false, true },
  { "A2", 17, 16, 14,  -1, false, false, 0, false, true },
  { "A3", 25, 26, 27,  -1, false, false, 0, false, true }
};

Servo gateServos[NUM_LOCAL_SLOTS];

// =====================================================================
// 📡 ESP-NOW: Remote Slot Data (จาก ESP32 ลูก)
// =====================================================================

const int MAX_REMOTE_SLOTS = 12;  // รองรับ remote slots สูงสุด

struct RemoteSlot {
  char slotId[8];
  float distanceCm;
  bool occupied;
  uint8_t nodeId;            // มาจาก node ไหน
  unsigned long lastUpdate;  // millis() ที่อัปเดตล่าสุด
  bool active;               // มีข้อมูลแล้วหรือยัง
};

RemoteSlot remoteSlots[MAX_REMOTE_SLOTS];
int remoteSlotCount = 0;

// --- ESP-NOW Packet Structures (ต้องตรงกับ Sensor Node) ---

struct SlotReport {
  char slotId[8];
  float distanceCm;
  bool occupied;
};

struct SensorPacket {
  uint8_t nodeId;
  uint8_t slotCount;
  SlotReport slots[4];
};

struct BarrierCommand {
  char slotId[8];
  bool gateOpen;
};

struct BarrierPacket {
  uint8_t targetNodeId;
  uint8_t count;
  BarrierCommand commands[4];
};

// --- เก็บ MAC address ของแต่ละ node ---
const int MAX_NODES = 8;
struct NodeInfo {
  uint8_t nodeId;
  uint8_t mac[6];
  bool registered;
};
NodeInfo knownNodes[MAX_NODES];

// =====================================================================
// ⏱️ Timing
// =====================================================================

const unsigned long SENSE_INTERVAL_MS     = 1000;
const unsigned long HEARTBEAT_INTERVAL_MS = 15000;
const unsigned long REMOTE_TIMEOUT_MS     = 30000;  // ถ้าไม่ได้รับข้อมูลจากลูก > 30 วินาที ถือว่า offline

unsigned long lastSenseAt    = 0;
unsigned long lastTransmitAt = 0;

// =====================================================================
// 📏 HC-SR04 Distance Reading
// =====================================================================

float readDistanceCm(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long durationUs = pulseIn(echoPin, HIGH, 30000);
  return durationUs == 0 ? -1 : durationUs * 0.0343f / 2.0f;
}

// =====================================================================
// 🚧 Local Barrier Gate Control
// =====================================================================

void updateLocalBarrier(int index, bool gateOpen) {
  if (index < 0 || index >= NUM_LOCAL_SLOTS) return;
  if (localSlots[index].gateOpen == gateOpen) return;
  gateServos[index].write(gateOpen ? GATE_OPEN_ANGLE : GATE_CLOSED_ANGLE);
  localSlots[index].gateOpen = gateOpen;
  Serial.printf("[GATE-LOCAL] %s -> %s\n", localSlots[index].slotId, gateOpen ? "OPEN" : "CLOSED");
}

// =====================================================================
// 📡 ESP-NOW: รับข้อมูล Sensor จากลูก
// =====================================================================

int findOrCreateRemoteSlot(const char* slotId, uint8_t nodeId) {
  // หาที่มีอยู่แล้ว
  for (int i = 0; i < remoteSlotCount; i++) {
    if (strcmp(remoteSlots[i].slotId, slotId) == 0) return i;
  }
  // สร้างใหม่
  if (remoteSlotCount >= MAX_REMOTE_SLOTS) return -1;
  int idx = remoteSlotCount++;
  strncpy(remoteSlots[idx].slotId, slotId, sizeof(remoteSlots[idx].slotId) - 1);
  remoteSlots[idx].slotId[sizeof(remoteSlots[idx].slotId) - 1] = '\0';
  remoteSlots[idx].nodeId = nodeId;
  remoteSlots[idx].active = true;
  return idx;
}

void registerNode(uint8_t nodeId, const uint8_t* mac) {
  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].registered && knownNodes[i].nodeId == nodeId) {
      memcpy(knownNodes[i].mac, mac, 6);
      return;
    }
  }
  for (int i = 0; i < MAX_NODES; i++) {
    if (!knownNodes[i].registered) {
      knownNodes[i].nodeId = nodeId;
      memcpy(knownNodes[i].mac, mac, 6);
      knownNodes[i].registered = true;

      // เพิ่มเป็น ESP-NOW peer
      esp_now_peer_info_t peer;
      memset(&peer, 0, sizeof(peer));
      memcpy(peer.peer_addr, mac, 6);
      peer.channel = 0;
      peer.encrypt = false;
      esp_now_add_peer(&peer);

      Serial.printf("[ESP-NOW] Registered node %d — MAC: %02X:%02X:%02X:%02X:%02X:%02X\n",
                    nodeId, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
      return;
    }
  }
}

// ESP-NOW receive callback
void onEspNowRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len != sizeof(SensorPacket)) return;

  SensorPacket pkt;
  memcpy(&pkt, data, sizeof(pkt));

  // ลงทะเบียน node (จำ MAC address สำหรับส่งคำสั่งกลับ)
  registerNode(pkt.nodeId, info->src_addr);

  Serial.printf("[ESP-NOW] Received %d slots from node %d\n", pkt.slotCount, pkt.nodeId);

  for (int s = 0; s < pkt.slotCount && s < 4; s++) {
    int idx = findOrCreateRemoteSlot(pkt.slots[s].slotId, pkt.nodeId);
    if (idx < 0) continue;

    remoteSlots[idx].distanceCm  = pkt.slots[s].distanceCm;
    remoteSlots[idx].occupied    = pkt.slots[s].occupied;
    remoteSlots[idx].nodeId      = pkt.nodeId;
    remoteSlots[idx].lastUpdate  = millis();
    remoteSlots[idx].active      = true;

    Serial.printf("  -> %s: %.1f cm, %s\n",
                  pkt.slots[s].slotId,
                  pkt.slots[s].distanceCm,
                  pkt.slots[s].occupied ? "OCCUPIED" : "EMPTY");
  }
}

void onEspNowSent(const uint8_t* mac, esp_now_send_status_t status) {
  // ไม่ต้องทำอะไรพิเศษ
}

// =====================================================================
// 📤 ส่ง Barrier Commands กลับไปยัง ESP32 ลูก
// =====================================================================

void sendBarrierToNode(uint8_t nodeId, BarrierCommand* commands, int count) {
  // หา MAC address ของ node
  uint8_t* targetMac = nullptr;
  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].registered && knownNodes[i].nodeId == nodeId) {
      targetMac = knownNodes[i].mac;
      break;
    }
  }
  if (!targetMac) {
    Serial.printf("[ESP-NOW] Node %d not registered, cannot send barrier commands\n", nodeId);
    return;
  }

  BarrierPacket pkt;
  pkt.targetNodeId = nodeId;
  pkt.count = min(count, 4);
  for (int i = 0; i < pkt.count; i++) {
    pkt.commands[i] = commands[i];
  }

  esp_err_t result = esp_now_send(targetMac, (uint8_t*)&pkt, sizeof(pkt));
  Serial.printf("[ESP-NOW] Sent %d barrier commands to node %d: %s\n",
                pkt.count, nodeId, result == ESP_OK ? "OK" : "FAIL");
}

// =====================================================================
// 📡 Batch Telemetry → Supabase RPC
// =====================================================================

bool transmitBatchTelemetry(const char* reason) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[COMM] Skipped: WiFi disconnected");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/handle_sensor_telemetry";
  http.begin(client, url);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);

  // --- สร้าง JSON: รวม local + remote slots ---
  JsonDocument outDoc;
  outDoc["device_id"] = CONTROLLER_DEVICE_ID;
  JsonArray slotsArray = outDoc["slots"].to<JsonArray>();

  // Local slots (A1-A3)
  for (int i = 0; i < NUM_LOCAL_SLOTS; i++) {
    JsonObject obj = slotsArray.add<JsonObject>();
    obj["slot_id"]     = localSlots[i].slotId;
    obj["distance_cm"] = localSlots[i].distanceCm;
    obj["occupied"]    = localSlots[i].confirmedOccupied;
    obj["status"]      = localSlots[i].confirmedOccupied ? "unavailable" : "available";
  }

  // Remote slots (จาก ESP32 ลูก)
  for (int i = 0; i < remoteSlotCount; i++) {
    if (!remoteSlots[i].active) continue;
    // ตรวจสอบ timeout: ถ้าไม่ได้รับข้อมูลนานเกินไป ไม่ส่ง
    if (millis() - remoteSlots[i].lastUpdate > REMOTE_TIMEOUT_MS) {
      Serial.printf("[WARN] Remote slot %s (node %d) timed out — skipping\n",
                    remoteSlots[i].slotId, remoteSlots[i].nodeId);
      continue;
    }
    JsonObject obj = slotsArray.add<JsonObject>();
    obj["slot_id"]     = remoteSlots[i].slotId;
    obj["distance_cm"] = remoteSlots[i].distanceCm;
    obj["occupied"]    = remoteSlots[i].occupied;
    obj["status"]      = remoteSlots[i].occupied ? "unavailable" : "available";
  }

  String payload;
  serializeJson(outDoc, payload);
  Serial.printf("\n[COMM] Transmit (%s) — %d local + %d remote slots:\n",
                reason, NUM_LOCAL_SLOTS, remoteSlotCount);
  Serial.println(payload);

  int httpCode = http.POST(payload);
  bool success = false;

  if (httpCode >= 200 && httpCode < 300) {
    String resp = http.getString();
    Serial.printf("[COMM] HTTP %d OK:\n", httpCode);
    Serial.println(resp);

    // --- แยก barrier commands ---
    JsonDocument inDoc;
    DeserializationError err = deserializeJson(inDoc, resp);

    if (!err && inDoc["barriers"].is<JsonArray>()) {
      // รวบรวม commands ตาม nodeId เพื่อส่งกลับ
      // node 0 = คำสั่งสำหรับ local slots ของ Master
      BarrierCommand nodeCommands[MAX_NODES][4];
      int nodeCmdCount[MAX_NODES] = {0};

      for (JsonObject b : inDoc["barriers"].as<JsonArray>()) {
        const char* slotId = b["slot_id"];
        bool gateOpen = b["gate_open"] | false;
        if (!slotId) continue;

        // ตรวจสอบว่าเป็น local slot ไหม
        bool isLocal = false;
        for (int i = 0; i < NUM_LOCAL_SLOTS; i++) {
          if (strcmp(localSlots[i].slotId, slotId) == 0) {
            updateLocalBarrier(i, gateOpen);
            isLocal = true;
            break;
          }
        }

        // ถ้าไม่ใช่ local → หา nodeId แล้วเก็บคำสั่ง
        if (!isLocal) {
          for (int r = 0; r < remoteSlotCount; r++) {
            if (strcmp(remoteSlots[r].slotId, slotId) == 0) {
              uint8_t nid = remoteSlots[r].nodeId;
              // หา index ใน knownNodes
              for (int n = 0; n < MAX_NODES; n++) {
                if (knownNodes[n].registered && knownNodes[n].nodeId == nid) {
                  int c = nodeCmdCount[n];
                  if (c < 4) {
                    strncpy(nodeCommands[n][c].slotId, slotId, sizeof(nodeCommands[n][c].slotId) - 1);
                    nodeCommands[n][c].slotId[sizeof(nodeCommands[n][c].slotId) - 1] = '\0';
                    nodeCommands[n][c].gateOpen = gateOpen;
                    nodeCmdCount[n]++;
                  }
                  break;
                }
              }
              break;
            }
          }
        }
      }

      // ส่ง barrier commands กลับไปแต่ละ node
      for (int n = 0; n < MAX_NODES; n++) {
        if (knownNodes[n].registered && nodeCmdCount[n] > 0) {
          sendBarrierToNode(knownNodes[n].nodeId, nodeCommands[n], nodeCmdCount[n]);
        }
      }

      success = true;
    } else {
      Serial.printf("[COMM] JSON parse error: %s\n", err.c_str());
    }
  } else {
    Serial.printf("[COMM] HTTP %d FAIL: %s\n", httpCode, http.getString().c_str());
  }

  http.end();
  return success;
}

// =====================================================================
// 📶 WiFi + ESP-NOW (ใช้ร่วมกันได้!)
// =====================================================================

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WiFi] Connecting");
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(300);
    Serial.print('.');
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());

    // สำคัญ: ล็อก ESP-NOW channel ให้ตรงกับ WiFi channel
    uint8_t primaryChan = 0;
    wifi_second_chan_t secondChan;
    esp_wifi_get_channel(&primaryChan, &secondChan);
    Serial.printf("[WiFi] Channel: %d\n", primaryChan);
  } else {
    Serial.println("\n[WiFi] Failed — will retry");
  }
}

// =====================================================================
// 🚀 SETUP
// =====================================================================

void setup() {
  Serial.begin(115200);
  Serial.println("\n========================================");
  Serial.println("  Master Controller + ESP-NOW Hub");
  Serial.println("========================================");

  // Local sensor & servo
  for (int i = 0; i < NUM_LOCAL_SLOTS; i++) {
    pinMode(localSlots[i].trigPin, OUTPUT);
    pinMode(localSlots[i].echoPin, INPUT);
    gateServos[i].attach(localSlots[i].servoPin);
    gateServos[i].write(GATE_CLOSED_ANGLE);
    Serial.printf("[INIT] Local %s — Trig:%d Echo:%d Servo:%d\n",
                  localSlots[i].slotId, localSlots[i].trigPin,
                  localSlots[i].echoPin, localSlots[i].servoPin);
  }

  // Init remote slots + nodes
  memset(remoteSlots, 0, sizeof(remoteSlots));
  memset(knownNodes, 0, sizeof(knownNodes));

  // WiFi (ต้องเชื่อมก่อน ESP-NOW เพื่อล็อก channel)
  connectWiFi();

  // ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Init FAILED!");
  } else {
    esp_now_register_recv_cb(onEspNowRecv);
    esp_now_register_send_cb(onEspNowSent);
    Serial.println("[ESP-NOW] Ready — waiting for sensor nodes...");
  }

  // แสดง MAC address (ลูกต้องใช้ค่านี้)
  Serial.printf("[ESP-NOW] Master MAC: %s  <<<< ใส่ค่านี้ใน MASTER_MAC ของ Sensor Node\n",
                WiFi.macAddress().c_str());

  // ส่ง telemetry ครั้งแรก
  transmitBatchTelemetry("boot");
  Serial.println("[INIT] Setup complete.\n");
}

// =====================================================================
// 🔁 MAIN LOOP
// =====================================================================

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  if (millis() - lastSenseAt < SENSE_INTERVAL_MS) {
    delay(20);
    return;
  }
  lastSenseAt = millis();

  // --- วัด Local Sensors + Debounce ---
  bool changed = false;
  for (int i = 0; i < NUM_LOCAL_SLOTS; i++) {
    localSlots[i].distanceCm = readDistanceCm(localSlots[i].trigPin, localSlots[i].echoPin);
    bool occupied = (localSlots[i].distanceCm > 0 && localSlots[i].distanceCm < OCCUPIED_DISTANCE_CM);

    if (occupied != localSlots[i].candidateOccupied) {
      localSlots[i].candidateOccupied = occupied;
      localSlots[i].candidateCount = 1;
    } else if (localSlots[i].candidateCount < CONFIRM_READS) {
      localSlots[i].candidateCount++;
    }

    if (localSlots[i].candidateCount >= CONFIRM_READS && localSlots[i].confirmedOccupied != occupied) {
      Serial.printf("[SENSOR] %s: %s -> %s (%.1f cm)\n",
                    localSlots[i].slotId,
                    localSlots[i].confirmedOccupied ? "OCCUPIED" : "EMPTY",
                    occupied ? "OCCUPIED" : "EMPTY",
                    localSlots[i].distanceCm);
      localSlots[i].confirmedOccupied = occupied;
      changed = true;
    }
  }

  // --- ส่ง Telemetry (local + remote รวม) ---
  if (changed || millis() - lastTransmitAt >= HEARTBEAT_INTERVAL_MS) {
    if (transmitBatchTelemetry(changed ? "state-change" : "heartbeat")) {
      lastTransmitAt = millis();
    }
  }
}
