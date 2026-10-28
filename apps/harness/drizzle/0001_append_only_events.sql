-- Custom SQL migration file, put your code below! --
-- The application can INSERT and SELECT trajectory events, never UPDATE/DELETE them.
CREATE FUNCTION reject_agent_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER agent_events_append_only
BEFORE UPDATE OR DELETE ON agent_events
FOR EACH ROW EXECUTE FUNCTION reject_agent_event_mutation();
