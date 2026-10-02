# Smart Parking System — React / Express / Supabase / ESP32

โครงสร้างใหม่แยก Software และ Hardware โดยคงฟังก์ชันหลักเดิม: สมัคร/เข้าสู่ระบบ, จอง, ยกเลิก, เครดิต, จบการจอด, No-show 15 นาที, ค่าจอดเกินเวลา, LINE, Admin และ ESP32 sensor/barrier

## โครงสร้าง

- `frontend/` React + Vite + Tailwind CSS
- `backend/` Node.js + Express.js + Supabase service layer + LINE webhook + lifecycle worker
- `database/` SQL migrations สำหรับ Supabase
- `hardware/` โค้ด C++ สำหรับ ESP32 sensor, barrier และ batch controller

## เริ่มต้น

### Database
รันไฟล์ใน `database/migrations/` ตามลำดับใน Supabase SQL Editor

### Backend
```bash
cd backend
copy .env.example .env  # Windows; macOS/Linux: cp .env.example .env
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

กำหนด `VITE_API_URL=http://localhost:3000/api` ใน `frontend/.env`

### LINE
ตั้ง `LINE_CHANNEL_ACCESS_TOKEN` และ `LINE_CHANNEL_SECRET` ใน backend แล้วตั้ง Webhook เป็น:
`https://YOUR-BACKEND-DOMAIN/api/line/webhook`

### ESP32
แก้ค่าการเชื่อมต่อในแต่ละไฟล์ใต้ `hardware/` แล้วอัปโหลดด้วย Arduino IDE

- `esp32-sensor/` และ `esp32-barrier/` เป็นโหมดแยกอุปกรณ์เดิม
- `esp32-batch-controller/` เป็นโหมดรวมเซ็นเซอร์และไม้กั้น A1–A3
- โหมด batch ต้องรัน `database/migrations/005_batch_telemetry.sql`
- อ่านรายละเอียดที่ `docs/BATCH-TELEMETRY-TH.md`

> ก่อนใช้งานจริงควรใช้ HTTPS, เก็บ secrets เฉพาะใน backend, เปิด RLS แบบจำกัดสิทธิ์ และเพิ่ม debounce ให้เซ็นเซอร์

## Credit request workflow

1. Existing projects: run `database/migrations/003_credit_requests.sql`.
2. Users submit top-up requests from **ประวัติของฉัน**.
3. Admin reviews requests under **จัดการผู้ใช้**, or directly adds/deducts user credit.
4. Approved/rejected requests notify linked LINE accounts.

## Admin controls and parking maps

For an existing database, run `database/migrations/004_admin_controls_and_maps.sql`.
The update adds slot-level access control, user role/status management, LINE connection indicators, device/slot renaming, slot-order swapping, parking-map uploads to Supabase Storage, manual slot status, and maintenance workflow.
Each controllable slot needs a `devices` row with `type='barrier'` and `linked_slot` equal to the slot ID.

## Batch telemetry integration

Run `database/migrations/005_batch_telemetry.sql` after migration 004. The
integrated controller may call Supabase RPC `handle_sensor_telemetry` directly,
while other clients can send the same body to `POST /api/iot/telemetry`.

The initial slot-level barrier states return A1 closed, A2 open and A3 closed.
After installation, Admin barrier changes stored in `devices.state` are returned
to the controller on its next telemetry request.

## Admin credit history
The admin user-management page shows all credit additions and deductions from `credit_history`, including Thai-local time, user, amount, reason and source.

## Booking and maintenance history update
- Admin dashboard shows complete booking history: slot, user, date, time, duration, amount, status and created time.
- Users may cancel only before the Thai booking start time.
- Bookings remain pending until the slot sensor reports occupied. After 15 minutes without a car they become `no_show`, retain the prepaid charge, and release the slot.
- User slot grids are sorted by `slot_order`, so status changes only change color and never position.
- Admin layout shows full maintenance history with opened and resolved timestamps.

## Industrial parking UI
The frontend now uses a dark industrial control-room theme with compact system header, role/LINE/backend indicators, fixed sidebar, dashboard cards, floor tabs, stable parking-grid positions, sensor LEDs, status legend and a reservation modal. The responsive layout supports desktop, tablet and mobile without changing backend behavior.
