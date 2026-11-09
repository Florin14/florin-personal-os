from app.core.module import Module
from app.modules.ai.router import router

module = Module(
    name="ai",
    title="AI (optional)",
    description=(
        "Replaceable, budgeted AI provider interface (disabled by default, local Ollama "
        "optional) with per-workspace feature consent, redaction and usage tracking."
    ),
    routers=(router,),
)
