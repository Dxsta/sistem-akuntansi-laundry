-- Laundry Accounting System (LAS)
-- Jalankan seluruh SQL ini di Supabase Dashboard > SQL Editor.
-- Autentikasi Supabase diperlukan. Jangan gunakan service_role key di frontend.

create extension if not exists pgcrypto;

drop view if exists public.v_ringkasan_pesanan;
drop function if exists public.buat_pesanan_laundry(uuid, date, varchar, varchar, jsonb);
drop function if exists public.buat_pesanan_laundry(uuid, date, varchar, jsonb);
drop function if exists public.buat_pesanan_laundry(uuid, date, date, varchar, jsonb);

create table if not exists public.pelanggan (
  id_pelanggan uuid primary key default gen_random_uuid(),
  nama_pelanggan varchar(100) not null,
  no_telepon varchar(30),
  alamat text,
  created_at timestamptz not null default now()
);

create table if not exists public.pesanan_laundry (
  id_pesanan uuid primary key default gen_random_uuid(),
  id_pelanggan uuid not null references public.pelanggan(id_pelanggan) on delete restrict,
  tanggal_pesanan date not null default current_date,
  id_transaksi uuid not null default gen_random_uuid(),
  jenis_layanan varchar(50) not null,
  satuan varchar(10) not null default 'kg',
  berat_kg numeric(8,2) not null check (berat_kg > 0),
  harga_per_kg numeric(12,2) not null check (harga_per_kg > 0),
  total_tagihan numeric(14,2) generated always as (round(berat_kg * harga_per_kg, 2)) stored,
  selesai boolean not null default false,
  diambil boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.pesanan_laundry
  add column if not exists selesai boolean not null default false;

alter table public.pesanan_laundry
  add column if not exists diambil boolean not null default false;

-- Add unit support to existing installations; existing orders remain in kg.
alter table public.pesanan_laundry
  add column if not exists satuan varchar(10) not null default 'kg';

alter table public.pesanan_laundry
  add column if not exists id_transaksi uuid not null default gen_random_uuid();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pesanan_laundry_satuan_check'
      and conrelid = 'public.pesanan_laundry'::regclass
  ) then
    alter table public.pesanan_laundry
      add constraint pesanan_laundry_satuan_check check (satuan in ('kg', 'item'));
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pesanan_laundry_item_quantity_check'
      and conrelid = 'public.pesanan_laundry'::regclass
  ) then
    alter table public.pesanan_laundry
      add constraint pesanan_laundry_item_quantity_check
      check (satuan <> 'item' or berat_kg = trunc(berat_kg));
  end if;
end $$;

create table if not exists public.pembayaran (
  id_pembayaran uuid primary key default gen_random_uuid(),
  id_pesanan uuid not null references public.pesanan_laundry(id_pesanan) on delete restrict,
  tanggal_pembayaran date not null default current_date,
  jumlah_bayar numeric(14,2) not null check (jumlah_bayar > 0),
  metode_pembayaran varchar(20) not null default 'Tunai'
    check (metode_pembayaran in ('Tunai','Transfer','QRIS')),
  created_at timestamptz not null default now()
);

create table if not exists public.app_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role varchar(20) not null check (role in ('owner','cashier')),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_app_user_roles_single_cashier
  on public.app_user_roles(role) where role = 'cashier';

create index if not exists idx_pesanan_pelanggan on public.pesanan_laundry(id_pelanggan);
create index if not exists idx_pesanan_tanggal on public.pesanan_laundry(tanggal_pesanan);
create index if not exists idx_pesanan_transaksi on public.pesanan_laundry(id_transaksi);
create index if not exists idx_pembayaran_pesanan on public.pembayaran(id_pesanan);
create index if not exists idx_pembayaran_tanggal on public.pembayaran(tanggal_pembayaran);

-- Role dibaca dari tabel privat, bukan user_metadata yang dapat diubah pengguna.
create or replace function public.is_bagaskara_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_user_roles
    where user_id = (select auth.uid()) and role = 'owner'
  );
$$;

create or replace function public.is_bagaskara_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_user_roles
    where user_id = (select auth.uid()) and role in ('owner','cashier')
  );
$$;

revoke all on function public.is_bagaskara_owner() from public, anon;
revoke all on function public.is_bagaskara_user() from public, anon;
grant execute on function public.is_bagaskara_owner() to authenticated;
grant execute on function public.is_bagaskara_user() to authenticated;

-- Aktifkan Row Level Security dan cabut akses tanpa login.
alter table public.pelanggan enable row level security;
alter table public.pesanan_laundry enable row level security;
alter table public.pembayaran enable row level security;
alter table public.app_user_roles enable row level security;

revoke all on public.pelanggan, public.pesanan_laundry, public.pembayaran, public.app_user_roles from anon, authenticated;
grant select, insert on public.pelanggan to authenticated;
grant delete on public.pelanggan to authenticated;
grant select, insert on public.pesanan_laundry to authenticated;
grant update (selesai, diambil) on public.pesanan_laundry to authenticated;
grant select, insert on public.pembayaran to authenticated;
grant select on public.app_user_roles to authenticated;

drop policy if exists "demo anon pelanggan" on public.pelanggan;
drop policy if exists "demo anon pesanan" on public.pesanan_laundry;
drop policy if exists "demo anon pembayaran" on public.pembayaran;
drop policy if exists "authenticated customer read and create" on public.pelanggan;
drop policy if exists "owner manage customers" on public.pelanggan;
create policy "authenticated customer read and create" on public.pelanggan
  for select to authenticated using (public.is_bagaskara_user());
create policy "authenticated customer create" on public.pelanggan
  for insert to authenticated with check (public.is_bagaskara_user());
create policy "owner manage customers" on public.pelanggan
  for delete to authenticated using (public.is_bagaskara_owner());

drop policy if exists "authenticated order read and create" on public.pesanan_laundry;
drop policy if exists "authenticated order read" on public.pesanan_laundry;
drop policy if exists "authenticated order create" on public.pesanan_laundry;
drop policy if exists "authenticated order status update" on public.pesanan_laundry;
drop policy if exists "owner manage orders" on public.pesanan_laundry;
create policy "authenticated order read" on public.pesanan_laundry
  for select to authenticated using (public.is_bagaskara_user());
create policy "authenticated order create" on public.pesanan_laundry
  for insert to authenticated with check (public.is_bagaskara_user());
create policy "authenticated order status update" on public.pesanan_laundry
  for update to authenticated using (public.is_bagaskara_user())
  with check (public.is_bagaskara_user());

drop policy if exists "authenticated payment read and create" on public.pembayaran;
drop policy if exists "authenticated payment read" on public.pembayaran;
drop policy if exists "authenticated payment create" on public.pembayaran;
drop policy if exists "authenticated payment create" on public.pembayaran;
create policy "authenticated payment read" on public.pembayaran
  for select to authenticated using (public.is_bagaskara_user());
create policy "authenticated payment create" on public.pembayaran
  for insert to authenticated with check (public.is_bagaskara_user());

drop policy if exists "user read own role or owner read all roles" on public.app_user_roles;
drop policy if exists "owner manage user roles" on public.app_user_roles;
create policy "user read own role or owner read all roles" on public.app_user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_bagaskara_owner());
create policy "owner manage user roles" on public.app_user_roles
  for all to authenticated
  using (public.is_bagaskara_owner())
  with check (public.is_bagaskara_owner());

-- Buat semua baris layanan dalam satu pesanan dan satu pembayaran secara atomik.
create or replace function public.buat_pesanan_laundry(
  p_customer_id uuid,
  p_date date,
  p_payment_date date,
  p_payment_method varchar,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transaction_id uuid := gen_random_uuid();
  v_first_order_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_total numeric(14,2);
  v_total numeric(14,2) := 0;
begin
  if not public.is_bagaskara_user() then
    raise exception 'Pengguna tidak memiliki akses untuk membuat pesanan.';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Pesanan harus memiliki minimal satu layanan.';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Pesanan harus memiliki minimal satu layanan.';
  end if;
  if p_payment_method not in ('Tunai', 'QRIS') then
    raise exception 'Metode pembayaran tidak valid.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Detail layanan tidak valid.';
    end if;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;

    if v_item->>'unit' is null or v_item->>'unit' not in ('kg', 'item')
       or v_quantity is null or v_quantity <= 0 or v_quantity > 999999.99
       or v_unit_price is null or v_unit_price <= 0 or v_unit_price > 9999999999.99 then
      raise exception 'Detail layanan tidak valid.';
    end if;
    if v_item->>'unit' = 'item' and v_quantity <> trunc(v_quantity) then
      raise exception 'Jumlah layanan satuan harus berupa bilangan bulat.';
    end if;

    insert into public.pesanan_laundry (
      id_pelanggan, tanggal_pesanan, id_transaksi, jenis_layanan,
      satuan, berat_kg, harga_per_kg
    ) values (
      p_customer_id, p_date, v_transaction_id, v_item->>'name',
      v_item->>'unit', v_quantity, v_unit_price
    )
    returning id_pesanan, total_tagihan into v_order_id, v_line_total;

    if v_first_order_id is null then
      v_first_order_id := v_order_id;
    end if;
    v_total := v_total + v_line_total;
  end loop;

  insert into public.pembayaran (
    id_pesanan, tanggal_pembayaran, jumlah_bayar, metode_pembayaran
  ) values (
    v_first_order_id, p_payment_date, v_total, p_payment_method
  );

  return v_transaction_id;
end;
$$;

revoke all on function public.buat_pesanan_laundry(uuid, date, date, varchar, jsonb) from public, anon;
grant execute on function public.buat_pesanan_laundry(uuid, date, date, varchar, jsonb) to authenticated;

-- View untuk ringkasan pesanan dan pembayaran per pesanan.
create view public.v_ringkasan_pesanan as
select
  pl.id_pesanan,
  pl.tanggal_pesanan,
  pl.id_pelanggan,
  pg.nama_pelanggan,
  pl.jenis_layanan,
  pl.berat_kg,
  pl.harga_per_kg,
  pl.total_tagihan,
  pl.satuan
from public.pesanan_laundry pl
join public.pelanggan pg on pg.id_pelanggan = pl.id_pelanggan;

revoke all on public.v_ringkasan_pesanan from anon, authenticated;
