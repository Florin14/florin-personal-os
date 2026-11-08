from app.core.module import Module
from app.modules.discord.provider import DISCORD_PROVIDER
from app.modules.discord.router import router

module = Module(
    name="discord",
    title="Discord",
    description="Private Discord bot: signed interactions, status, approvals, notifications.",
    routers=(router,),
    integrations=(DISCORD_PROVIDER,),
)
