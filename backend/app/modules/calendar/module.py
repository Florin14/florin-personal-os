from app.core.module import Module
from app.modules.calendar.router import CALENDAR_ACTIONS, router

module = Module(
    name="calendar",
    title="Calendar & Tasks",
    description="Google Calendar events, reminders, free slots and task scheduling.",
    routers=(router,),
    actions=CALENDAR_ACTIONS,
)
