from app.core.module import Module
from app.modules.invoicing.actions import INVOICING_ACTIONS
from app.modules.invoicing.router import router

module = Module(
    name="invoicing",
    title="Business & Accounting",
    description="Invoice profiles, approval-gated monthly invoices (Oblio) and SPV submission.",
    routers=(router,),
    actions=INVOICING_ACTIONS,
)
