-- =====================================================================
-- Migration 006: Dynamic barrier response for multi-node ESP32
-- =====================================================================
-- แก้ไข RPC handle_sensor_telemetry ให้ return barrier commands
-- ของทุก slot ที่ส่งมาใน request (ไม่ hardcode เฉพาะ A1-A3 อีกต่อไป)
-- รัน SQL นี้ใน Supabase SQL Editor หลัง 005_batch_telemetry.sql
-- =====================================================================

-- เพิ่ม devices สำหรับ B1-B3 (ถ้ายังไม่มี)
insert into public.devices(id, name, type, floor, state, status, linked_slot) values
  ('barrier-B1', 'ไม้กั้นช่อง B1', 'barrier', 2, 'closed', 'offline', 'B1'),
  ('barrier-B2', 'ไม้กั้นช่อง B2', 'barrier', 2, 'closed', 'offline', 'B2'),
  ('barrier-B3', 'ไม้กั้นช่อง B3', 'barrier', 2, 'closed', 'offline', 'B3'),
  ('sensor-B1',  'เซ็นเซอร์ B1',  'sensor',  2, null,     'offline', 'B1'),
  ('sensor-B2',  'เซ็นเซอร์ B2',  'sensor',  2, null,     'offline', 'B2'),
  ('sensor-B3',  'เซ็นเซอร์ B3',  'sensor',  2, null,     'offline', 'B3')
on conflict(id) do nothing;

-- แก้ไข RPC function ให้ return barrier states แบบ dynamic
create or replace function public.handle_sensor_telemetry(
  device_id text,
  slots jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  slot_item jsonb;
  telemetry_slot text;
  telemetry_dist numeric;
  is_occupied boolean;
  telemetry_state text;
  response_payload jsonb;
begin
  if device_id is null or btrim(device_id) = '' then
    raise exception 'device_id is required';
  end if;
  if slots is null or jsonb_typeof(slots) <> 'array' then
    raise exception 'slots must be a JSON array';
  end if;

  -- === 1. บันทึก telemetry + อัปเดต devices/slots ===
  for slot_item in select value from jsonb_array_elements(slots)
  loop
    telemetry_slot := nullif(btrim(slot_item ->> 'slot_id'), '');
    if telemetry_slot is null
       or not exists (select 1 from public.slots s where s.id = telemetry_slot) then
      continue;
    end if;

    telemetry_dist := case
      when jsonb_typeof(slot_item -> 'distance_cm') = 'number'
        then (slot_item ->> 'distance_cm')::numeric
      else null
    end;
    is_occupied := coalesce((slot_item ->> 'occupied')::boolean, false);
    telemetry_state := case when is_occupied then 'unavailable' else 'available' end;

    -- บันทึก log
    insert into public.sensor_telemetry(
      controller_device_id, slot_id, distance_cm, occupied, reported_status
    ) values (
      device_id, telemetry_slot, telemetry_dist, is_occupied, telemetry_state
    );

    -- อัปเดต sensor device rows → ให้ lifecycle engine เห็น
    update public.devices d
       set presence = case when is_occupied then 'occupied' else 'empty' end,
           car_present = is_occupied,
           status = 'online',
           updated_at = now()
     where d.type = 'sensor' and d.linked_slot = telemetry_slot;

    -- อัปเดต slot status (ไม่ overwrite booked หรือ maintenance)
    update public.slots s
       set status = telemetry_state,
           updated_at = now()
     where s.id = telemetry_slot
       and s.status <> 'booked'
       and not exists (
         select 1 from public.maintenance_logs m
          where m.slot_id = telemetry_slot and m.status = 'open'
       );
  end loop;

  -- === 2. Mark controller online ===
  update public.devices d
     set status = 'online', updated_at = now()
   where d.id = device_id;

  -- === 3. Return barrier states แบบ dynamic ===
  -- ดึง barrier state ของทุก slot ที่ส่งมาใน request
  -- ถ้าไม่มี barrier device ผูก → default gate_open = false
  select jsonb_build_object(
    'barriers', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'slot_id', req.slot_id,
          'gate_open', coalesce(b_state.state = 'open', false)
        ) order by req.pos
      ),
      '[]'::jsonb
    )
  )
  into response_payload
  from (
    select
      row_number() over () as pos,
      nullif(btrim(elem ->> 'slot_id'), '') as slot_id
    from jsonb_array_elements(slots) as elem
  ) req
  left join lateral (
    select d.state
      from public.devices d
     where d.type = 'barrier' and d.linked_slot = req.slot_id
     order by d.updated_at desc
     limit 1
  ) b_state on true
  where req.slot_id is not null;

  return response_payload;
end;
$$;

revoke all on function public.handle_sensor_telemetry(text,jsonb) from public;
grant execute on function public.handle_sensor_telemetry(text,jsonb) to anon, authenticated, service_role;
comment on function public.handle_sensor_telemetry(text,jsonb) is
  'Stores batch sensor telemetry, updates the existing lifecycle state, and returns dynamic slot barrier commands for all requested slots.';
