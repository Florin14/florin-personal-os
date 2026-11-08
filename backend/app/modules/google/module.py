from app.core.module import Module
from app.modules.google.router import router
from app.modules.google.service import GOOGLE_ACCOUNT_PROVIDER, GOOGLE_APP_PROVIDER

module = Module(
    name="google",
    title="Google",
    description="Google OAuth (PKCE) accounts per workspace; Calendar, Gmail and Drive adapters.",
    routers=(router,),
    integrations=(GOOGLE_APP_PROVIDER, GOOGLE_ACCOUNT_PROVIDER),
)
