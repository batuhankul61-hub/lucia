"""What a user is allowed to do.

There are no accounts yet, so everyone is on the free plan. When Stripe
subscriptions arrive, `current_plan` will look up the signed-in user's
subscription and the routers stay unchanged.
"""

from dataclasses import dataclass

from fastapi import Request


@dataclass(frozen=True)
class Plan:
    name: str
    max_session_minutes: int


FREE = Plan(name="free", max_session_minutes=10)


def current_plan(request: Request) -> Plan:
    return FREE
