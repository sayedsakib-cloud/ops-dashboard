-- supabase/notice_schema.sql
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  tags text[] not null default '{}',
  attachments jsonb not null default '[]', -- [{type: "image"|"link", url: string, label?: string}]
  author_name text not null,
  author_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists notice_likes (
  notice_id uuid not null references notices(id) on delete cascade,
  user_email text not null,
  user_name text not null,
  created_at timestamptz not null default now(),
  primary key (notice_id, user_email)
);

create index if not exists notices_created_at_idx on notices (created_at desc, id desc);
create index if not exists notices_tags_idx on notices using gin (tags);

-- Run once manually in the Supabase dashboard (Storage tab), not via SQL:
--   Create a public bucket named "notice-attachments" for uploaded images.
