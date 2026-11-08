"""Public interface of the expenses module."""

from app.modules.expenses.service import Expense, ExpenseService

__all__ = ["Expense", "ExpenseService"]
