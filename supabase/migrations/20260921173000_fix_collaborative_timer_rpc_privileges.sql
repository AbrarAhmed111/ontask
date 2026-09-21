-- Collaborative timer RPCs update task_collaborators internally. Keep direct
-- table writes locked down, but let the checked RPCs own those internal writes.

alter function public.start_workspace_task(uuid)
  security definer;

alter function public.pause_workspace_task(uuid)
  security definer;

alter function public.complete_workspace_task(uuid, boolean)
  security definer;

alter function public.reopen_workspace_task(uuid)
  security definer;
