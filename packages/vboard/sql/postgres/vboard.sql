-- vboard's tables, which live next to A2's. schema.sql holds both: apply that.

create table if not exists vboard_positions (
  consumer text primary key,
  log_index bigint not null
);
--> statement-breakpoint
create table if not exists vboard_messages (
  id bigint primary key,
  event_id text not null unique,
  channel text not null,
  re bigint,
  by_actor text not null,
  by_principal text not null,
  by_profile text,
  from_key text,
  no_sync boolean not null,
  text_lower text not null,
  deleted boolean not null,
  created_at bigint not null,
  replies integer not null default 0,
  at bigint,
  data text not null
);
--> statement-breakpoint
create index if not exists vboard_messages_channel on vboard_messages (channel, id);
--> statement-breakpoint
create index if not exists vboard_messages_re on vboard_messages (re, id);
--> statement-breakpoint
create index if not exists vboard_messages_by_actor on vboard_messages (by_actor, id);
--> statement-breakpoint
create index if not exists vboard_messages_by_principal on vboard_messages (by_principal, id);
--> statement-breakpoint
create index if not exists vboard_threads_at on vboard_messages (at) where re is null;
--> statement-breakpoint
create index if not exists vboard_threads_channel on vboard_messages (channel, at) where re is null;
--> statement-breakpoint
create table if not exists vboard_versions (
  log_index bigint primary key,
  message_id bigint not null,
  data text not null
);
--> statement-breakpoint
create index if not exists vboard_versions_message on vboard_versions (message_id, log_index);
--> statement-breakpoint
create table if not exists vboard_terms (
  message_id bigint not null,
  term text not null,
  value text not null,
  primary key (message_id, term, value)
);
--> statement-breakpoint
create index if not exists vboard_terms_term on vboard_terms (term, value, message_id);
