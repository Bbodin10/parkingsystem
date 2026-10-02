// =====================================================================
// Smart Parking System — ESP32 Sensor Node (ลูก)
// =====================================================================
// ส่งค่า sensor + รับคำสั่ง servo ผ่าน ESP-NOW → ไปยัง Master Controller
// ไม่ต้องเชื่อมต่อ WiFi router / ไม่ต้องมี Supabase key
// =====================================================================

#include <WiFi.h>
#include <esp_now.h>
#include <ESP32Servo.h>

// =====================================================================
// ⚙️ CONFIG — เปลี่ยนค่าตรงนี้
// =====================================================================

// --- MAC Address ของ ESP32 แม่ (Master) ---
// ดูได้จาก Serial Monitor ของ Master ตอน boot
// ตัวอย่าง: {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF}
uint8_t MASTER_MAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};  // <<<< เปลี่ยนเป็น MAC จริงของ Master

// --- Node ID ---
// ใช้เลขไม่ซ้ำกันในแต่ละ node (1, 2, 3, ...)
const uint8_t NODE_ID = 1;

// --- จำนวน slot ที่ node นี้ดูแล ---
const int NUM_LOCAL_SLOTS = 3;

// --- Sensor Config ---
const float OCCUPIED_DISTANCE_CM = 15.0;
const uint8_t CONFIRM_READS      = 3;

// --- Servo Config ---
const int GATE_OPEN_ANGLE   = 90;
const int GATE_CLOSED_ANGLE = 0;

// --- Timing ---
const unsigned long SENSE_INTERVAL_MS = 1000;   // วัดทุก 1 วินาที
const unsigned long SEND_INTERVAL_MS  = 5000;   // ส่งอย่างน้อยทุก 5 วินาที (heartbeat)

// =====================================================================
// 📋 Data Structures — ตรงกับ Master
// =====================================================================

// ข้อมูล 1 slot ที่ส่งไป Master
struct SlotReport {
  char slotId[8];       // เช่น "B1"
  float distanceCm;
  bool occupied;
};

// Packet ที่ส่งไป Master
struct SensorPacket {
  uint8_t nodeId;
  uint8_t slotCount;
  SlotReport slots[4];  // รองรับสูงสุด 4 slot ต่อ node
};

// คำสั่ง barrier ที่รับจาก Master
struct BarrierCommand {
  char slotId[8];
  bool gateOpen;
};

struct BarrierPacket {
  uint8_t targetNodeId;
  uint8_t count;
  BarrierCommand commands[4];
};

// =====================================================================
// 📌 PIN MAPPING — ปรับตาม wiring ของ node นี้
// =====================================================================

struct LocalSlot {
  const char* slotId;
  int trigPin;
  int echoPin;
  int servoPin;
  float distanceCm;
  bool confirmedOccupied;
  bool candidateOccupied;
  uint8_t candidateCount;
  bool gateOpen;
};

// ตัวอย่าง: Node 1 ดูแล B1, B2, B3
LocalSlot localSlots[NUM_LOCAL_SLOTS] = {
  { "B1",  5, 18, 13,  -1, false, false, 0, false },
  { "B2", 17, 16, 14,  -1, false, false, 0, false },
  { "B3", 25, 26, 27,  -1, false, false, 0, false }
};

Servo localServos[NUM_LOCAL_SLOTS];
unsigned long lastSenseAt = 0;
unsigned long lastSendAt  = 0;

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
// 🚧 Servo Control
// =====================================================================

void updateGate(int index, bool gateOpen) {
  if (index < 0 || index >= NUM_LOCAL_SLOTS) return;
  if (localSlots[index].gateOpen == gateOpen) return;
  localServos[index].write(gateOpen ? GATE_OPEN_ANGLE : GATE_CLOSED_ANGLE);
  localSlots[index].gateOpen = gateOpen;
  Serial.printf("[GATE] %s -> %s\n", localSlots[index].slotId, gateOpen ? "OPEN" : "CLOSED");
}

// =====================================================================
// 📡 ESP-NOW Callbacks
// =====================================================================

// เมื่อส่งสำเร็จ/ไม่สำเร็จ
void onDataSent(const uint8_t* mac, esp_now_send_status_t status) {
  Serial.printf("[ESP-NOW] Send %s\n", status == ESP_NOW_SEND_SUCCESS ? "OK" : "FAIL");
}

// เมื่อรับคำสั่ง barrier จาก Master
void onDataRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len != sizeof(BarrierPacket)) return;

  BarrierPacket pkt;
  memcpy(&pkt, data, sizeof(pkt));

  // ตรวจสอบว่าคำสั่งส่งมาถึง node นี้
  if (pkt.targetNodeId != NODE_ID) return;

  Serial.printf("[ESP-NOW] Received %d barrier commands for node %d\n", pkt.count, pkt.targetNodeId);

  for (int c = 0; c < pkt.count && c < 4; c++) {
    for (int i = 0; i < NUM_LOCAL_SLOTS; i++) {
      if (strcmp(localSlots[i].slotId, pkt.commands[c].slotId) == 0) {
        updateGate(i, pkt.commands[c].gateOpen);
        break;
      }
    }
  }
}

// =====================================================================
// 📤 ส่ง Sensor Data ไป Master
// =====================================================================

void sendToMaster(bool changed) {
  SensorPacket pkt;
  pkt.nodeId = NODE_ID;
  pkt.slotCount = NUM_LOCAL_SLOTS;

  for (int i = 0; i < NUM_LOCAL_SLOTS && i < 4; i++) {
    strncpy(pkt.slots[i].slotId, localSlots[i].slotId, sizeof(pkt.slots[i].slotId) - 1);
    pkt.slots[i].slotId[sizeof(pkt.slots[i].slotId) - 1] = '\0';
    pkt.slots[i].distanceCm = localSlots[i].distanceCm;
    pkt.slots[i].occupied   = localSlots[i].confirmedOccupied;
  }

  esp_err_t result = esp_now_send(MASTER_MAC, (uint8_t*)&pkt, sizeof(pkt));
  Serial.printf("[ESP-NOW] Sending %d slots (%s): %s\n",
                pkt.slotCount,
                changed ? "state-change" : "heartbeat",
                result == ESP_OK ? "queued" : "error");
}

// =====================================================================
// 🚀 SETUP
// =====================================================================

void setup() {
  Serial.begin(115200);
  Serial.println("\n========================================");
  Serial.printf("  Sensor Node #%d — ESP-NOW\n", NODE_ID);
  Serial.println("========================================");

  // Sensor & Servo pins
  for (int i = 0; i < NUM_LOCAL_SLOTS; i++) {
    pinMode(localSlots[i].trigPin, OUTPUT);
    pinMode(localSlots[i].echoPin, INPUT);
    localServos[i].attach(localSlots[i].servoPin);
    localServos[i].write(GATE_CLOSED_ANGLE);
    Serial.printf("[INIT] %s — Trig:%d Echo:%d Servo:%d\n",
                  localSlots[i].slotId, localSlots[i].trigPin,
                  localSlots[i].echoPin, localSlots[i].servoPin);
  }

  // ESP-NOW ต้องการ WiFi ในโหมด STA
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();  // ไม่ต้องเชื่อม router

  // แสดง MAC address ของตัวเอง
  Serial.printf("[ESP-NOW] My MAC: %s\n", WiFi.macAddress().c_str());

  // เริ่ม ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Init FAILED!");
    return;
  }

  esp_now_register_send_cb(onDataSent);
  esp_now_register_recv_cb(onDataRecv);

  // ลงทะเบียน Master เป็น peer
  esp_now_peer_info_t peer;
  memset(&peer, 0, sizeof(peer));
  memcpy(peer.peer_addr, MASTER_MAC, 6);
  peer.channel = 0;
  peer.encrypt = false;

  if (esp_now_add_peer(&peer) != ESP_OK) {
    Serial.println("[ESP-NOW] Failed to add master peer!");
  } else {
    Serial.println("[ESP-NOW] Master peer registered");
  }

  // ส่งข้อมูลเริ่มต้น
  sendToMaster(true);
  Serial.println("[INIT] Setup complete.\n");
}

// =====================================================================
// 🔁 MAIN LOOP
// =====================================================================

void loop() {
  if (millis() - lastSenseAt < SENSE_INTERVAL_MS) {
    delay(20);
    return;
  }
  lastSenseAt = millis();

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

  if (changed || millis() - lastSendAt >= SEND_INTERVAL_MS) {
    sendToMaster(changed);
    lastSendAt = millis();
  }
}
