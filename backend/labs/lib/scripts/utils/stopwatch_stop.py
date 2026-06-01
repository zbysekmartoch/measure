from datetime import datetime
from measure.env import runtimeContext, saveRuntimeContext


def seconds_to_hms(seconds: int) -> str:
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60

    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


workflow_ctx = runtimeContext.setdefault("workflow", {})

started_raw = workflow_ctx.get("started")

if not started_raw:
    raise RuntimeError('V runtimeContext["workflow"]["started"] není uložený čas startu.')

started = datetime.fromisoformat(started_raw)
finished = datetime.now()

duration_s = int(round((finished - started).total_seconds()))

workflow_ctx["finished"] = finished.isoformat(timespec="seconds")
workflow_ctx["duration_s"] = duration_s
workflow_ctx["duration_hms"] = seconds_to_hms(duration_s)

saveRuntimeContext()

print(f"Workflow finished: {workflow_ctx['finished']}")
print(f"Duration: {workflow_ctx['duration_hms']} ({workflow_ctx['duration_s']} s)")