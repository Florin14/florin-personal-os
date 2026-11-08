from app.core.module import Module
from app.modules.documents.router import DOCUMENT_ACTIONS, router

module = Module(
    name="documents",
    title="Documents",
    description="Document storage, Gmail import and Drive archival.",
    routers=(router,),
    actions=DOCUMENT_ACTIONS,
)
