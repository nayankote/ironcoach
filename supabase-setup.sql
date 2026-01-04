-- Run this in Supabase SQL Editor (Database → SQL Editor → New Query)

-- Workouts table
create table workouts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  filename text,
  sport text,
  date date,
  duration_minutes int,
  distance_km decimal,
  tss int,
  analysis jsonb,
  efficiency jsonb,
  intervals jsonb,
  coaching_insights text[],
  prescription jsonb,
  created_at timestamp with time zone default now()
);

-- Enable RLS (Row Level Security)
alter table workouts enable row level security;

-- Users can only see their own workouts
create policy "Users see own workouts" on workouts
  for select using (auth.uid() = user_id);

create policy "Users insert own workouts" on workouts
  for insert with check (auth.uid() = user_id);

create policy "Users delete own workouts" on workouts
  for delete using (auth.uid() = user_id);

-- Index for fast queries
create index workouts_user_date on workouts(user_id, date desc);
