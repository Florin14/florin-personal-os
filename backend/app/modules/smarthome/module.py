from app.core.module import Module
from app.core.tasks import PeriodicTask
from app.modules.smarthome.actions import SMARTHOME_ACTIONS
from app.modules.smarthome.provider import HOME_ASSISTANT_PROVIDER
from app.modules.smarthome.router import router
from app.modules.smarthome.service import poll_devices

module = Module(
    name="smarthome",
    title="Smart Home",
    description="Local Home Assistant discovery, state events and opt-in, guarded device controls.",
    routers=(router,),
    integrations=(HOME_ASSISTANT_PROVIDER,),
    actions=SMARTHOME_ACTIONS,
    periodic_tasks=(PeriodicTask("smarthome.poll_devices", 60, poll_devices),),
)
