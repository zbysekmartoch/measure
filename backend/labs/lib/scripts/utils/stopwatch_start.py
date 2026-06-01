from datetime import datetime
from measure.env import runtimeContext, saveRuntimeContext


now = datetime.now()

workflow_ctx = runtimeContext.setdefault("workflow", {})

workflow_ctx["started"] = now.isoformat(timespec="seconds")

# Při novém startu smažeme staré údaje z předchozího běhu
workflow_ctx.pop("finished", None)
workflow_ctx.pop("duration_s", None)
workflow_ctx.pop("duration_hms", None)

saveRuntimeContext()

print(f"Workflow started: {workflow_ctx['started']}")