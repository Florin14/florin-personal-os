from app.core.module import Module
from app.modules.oblio.provider import OBLIO_PROVIDER

module = Module(
    name="oblio",
    title="Oblio",
    description="Oblio REST API adapter (invoices, SPV) with a mock mode.",
    integrations=(OBLIO_PROVIDER,),
)
