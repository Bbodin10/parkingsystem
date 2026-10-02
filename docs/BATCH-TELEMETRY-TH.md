# การเชื่อมต่อ Batch Telemetry กับ ESP32

ระบบหลักยังคงเป็น React + Express + Supabase ตามโครงสร้างเดิม และเพิ่มการรองรับ
บอร์ด ESP32 ที่ดูแลเซ็นเซอร์และไม้กั้นหลายช่องพร้อมกัน

## 1. ติดตั้งฐานข้อมูล

รัน migrations `001` ถึง `005` ตามลำดับใน Supabase SQL Editor โดยไฟล์ `005`
จะเพิ่ม:

- ตาราง `sensor_telemetry` สำหรับประวัติค่าระยะและสถานะรถ
- Sensor/Barrier ของ A1–A3 ที่ระบบ Admin ควบคุมได้
- RPC `handle_sensor_telemetry`

## 2. Request

ส่ง `POST` ได้สองทางด้วย body เดียวกัน:

1. จาก ESP32 ไป Supabase โดยตรง:
   `https://YOUR_PROJECT.supabase.co/rest/v1/rpc/handle_sensor_telemetry`
2. ผ่าน backend หลัก:
   `https://YOUR_BACKEND/api/iot/telemetry`

```json
{
  "device_id": "parking-controller-01",
  "slots": [
    {"slot_id": "A1", "distance_cm": 30.2, "occupied": false, "status": "available"},
    {"slot_id": "A2", "distance_cm": 8.4, "occupied": true, "status": "unavailable"},
    {"slot_id": "A3", "distance_cm": 27.9, "occupied": false, "status": "available"}
  ]
}
```

เมื่อเรียก Supabase โดยตรงต้องส่ง headers `apikey`, `Authorization: Bearer ...`
และ `Content-Type: application/json`

## 3. Response

หลังติดตั้งครั้งแรกจะได้:

```json
{
  "barriers": [
    {"slot_id": "A1", "gate_open": false},
    {"slot_id": "A2", "gate_open": true},
    {"slot_id": "A3", "gate_open": false}
  ]
}
```

ค่าเหล่านี้ไม่ถูก hard-code ตลอดเวลา: migration กำหนดค่าเริ่มต้นตามด้านบน
จากนั้น RPC จะอ่าน `devices.state` ล่าสุด ทำให้การเปิด/ปิดจากหน้า Admin ส่งถึง
ESP32 ในรอบ telemetry ถัดไป

## 4. ผลต่อระบบเดิม

- บันทึกทุก batch ลง `sensor_telemetry`
- อัปเดต `devices.presence` เพื่อให้ lifecycle เดิมตรวจ entry, no-show และ exit ได้
- ไม่เขียนทับช่องที่เป็น `booked`
- ไม่ปลดช่องที่มี maintenance สถานะ `open`
- ไฟล์ sensor และ barrier แบบแยกบอร์ดยังใช้งานได้เหมือนเดิม

## 5. เฟิร์มแวร์

เปิด `hardware/esp32-batch-controller/esp32-batch-controller.ino` แล้วแก้:

- `WIFI_SSID`
- `WIFI_PASSWORD`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- หมายเลขขา TRIG, ECHO และ Servo ให้ตรงกับวงจรจริง

ต้องติดตั้ง ArduinoJson และ ESP32Servo ก่อน compile และควรเปลี่ยนจาก
`client.setInsecure()` เป็นการตรวจสอบ CA certificate ก่อนใช้งานจริง