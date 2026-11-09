from app.core.module import Module
from app.modules.shopping.actions import SHOPPING_ACTIONS
from app.modules.shopping.router import router

module = Module(
    name="shopping",
    title="Shopping & Price Tracking",
    description=(
        "Products with canonical identity, merchant listings, manually recorded prices, history, "
        "price alerts and approval-gated purchase decisions (no scraping, no checkout)."
    ),
    routers=(router,),
    actions=SHOPPING_ACTIONS,
)
