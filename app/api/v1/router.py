from fastapi import APIRouter

from app.api.v1.api_keys import router as api_keys_router
from app.api.v1.agent import router as agent_router
from app.api.v1.auth import router as auth_router
from app.api.v1.water_goals import router as water_goals_router
from app.api.v1.water_records import router as water_records_router

router = APIRouter(prefix="/api/v1")
router.include_router(auth_router)
router.include_router(water_records_router)
router.include_router(water_goals_router)
router.include_router(api_keys_router)

router.include_router(agent_router)
