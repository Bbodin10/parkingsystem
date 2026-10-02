-- Admin controls, slot-level devices, parking maps and maintenance workflow
create table if not exists public.parking_maps (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  floor int not null,
  image_url text not null,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('parking-maps', 'parking-maps', true)
on conflict (id) do update set public = true;

create index if not exists devices_linked_slot_idx on public.devices(linked_slot);
create index if not exists maintenance_status_idx on public.maintenance_logs(status);
