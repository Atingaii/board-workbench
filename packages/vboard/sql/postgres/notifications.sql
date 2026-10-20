-- Notification triggers for experimental-a2/store-postgres, needed only with
-- `listenConnectionString`. Apply after schema.sql. They wake live streams
-- for every write to A2's event and presence tables, including writes from
-- stores without the option. Safe to re-run.

create or replace function a2_notify_events() returns trigger language plpgsql as $$
begin
  perform pg_notify('a2_events_' || md5(new.session_id), '');
  return null;
end $$;
create or replace function a2_notify_presence() returns trigger language plpgsql as $$
begin
  perform pg_notify('a2_presence_' || md5(case when TG_OP = 'DELETE' then old.ns else new.ns end),
    coalesce(current_setting('a2.presence_source', true), ''));
  return null;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'a2_notify_events' and tgrelid = 'a2_events'::regclass) then
    create trigger a2_notify_events after insert on a2_events for each row execute function a2_notify_events();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'a2_notify_presence' and tgrelid = 'a2_presence'::regclass) then
    create trigger a2_notify_presence after insert or update or delete on a2_presence for each row execute function a2_notify_presence();
  end if;
end $$;
