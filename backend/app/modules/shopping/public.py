"""Public interface of the shopping module."""

from app.modules.shopping.models import Product, ProductStatus
from app.modules.shopping.providers import PriceSource
from app.modules.shopping.service import EVENT_PRICE_ALERT, ShoppingService

__all__ = ["EVENT_PRICE_ALERT", "PriceSource", "Product", "ProductStatus", "ShoppingService"]
