create table if not exists public.credit_requests (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  type text not null default 'add' check (type in ('add','reduce')),
  amount numeric not null check (amount > 0),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by text references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists credit_requests_user_idx on public.credit_requests(user_id);
create index if not exists credit_requests_status_idx on public.credit_requests(status);
