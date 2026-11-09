from app.core.module import Module
from app.modules.banking.actions import BANKING_ACTIONS
from app.modules.banking.router import router

module = Module(
    name="banking",
    title="Banking & Reconciliation",
    description=(
        "Bank statement import (CSV, pluggable parsers), transactions and deterministic "
        "reconciliation with documents, expenses and invoices."
    ),
    routers=(router,),
    actions=BANKING_ACTIONS,
)
