from pydantic import BaseModel, Field


class AgentBootstrapRequest(BaseModel):
    provider: str = Field(..., min_length=1, max_length=32)
    provider_account_id: str = Field(..., min_length=1, max_length=128)
    external_user_id: str = Field(..., min_length=1, max_length=256)
