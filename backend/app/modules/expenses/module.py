from app.core.module import Module
from app.modules.expenses.router import router

module = Module(
    name="expenses",
    title="Expenses",
    description="Basic expense tracking linked to documents, with monthly summaries.",
    routers=(router,),
)
