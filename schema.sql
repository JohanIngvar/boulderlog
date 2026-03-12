-- =============================================
-- BoulderLog — Supabase Schema Setup
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================

-- 1. Create the climbs table
create table public.climbs (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null default '',
  grade       text not null default 'V5',
  status      text not null default 'project'
                check (status in ('project', 'attempted', 'sent')),
  notes       text default '',
  photo_url   text,
  drawing_url text,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null
);

-- 2. Enable Row Level Security (users can only see their own climbs)
alter table public.climbs enable row level security;

create policy "Users can manage their own climbs"
  on public.climbs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. Create storage buckets for photos and drawings
insert into storage.buckets (id, name, public)
  values ('climb-photos', 'climb-photos', true)
  on conflict do nothing;

insert into storage.buckets (id, name, public)
  values ('climb-drawings', 'climb-drawings', true)
  on conflict do nothing;

-- 4. Storage policies — users can upload to their own folder, anyone can view
create policy "Users can upload their own files"
  on storage.objects for insert
  with check (
    bucket_id in ('climb-photos', 'climb-drawings')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Anyone can view climb files"
  on storage.objects for select
  using (bucket_id in ('climb-photos', 'climb-drawings'));

create policy "Users can update their own files"
  on storage.objects for update
  using (
    bucket_id in ('climb-photos', 'climb-drawings')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own files"
  on storage.objects for delete
  using (
    bucket_id in ('climb-photos', 'climb-drawings')
    and auth.uid()::text = (storage.foldername(name))[1]
  );
