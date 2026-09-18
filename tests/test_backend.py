import pytest
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def create_user_and_token(openid="wx_001", password="Pass1234", nickname="喝水达人"):
    resp = client.post("/api/v1/auth/wechat-login", json={"openid": openid})
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["code"] == 0
    assert payload["data"]["need_register"] is True

    register_resp = client.post(
        "/api/v1/auth/register",
        json={
            "register_token": payload["data"]["register_token"],
            "password": password,
            "nickname": nickname,
        },
    )
    assert register_resp.status_code == 200, register_resp.text
    body = register_resp.json()
    token = body["data"]["token"]
    user_id = body["data"]["user"]["user_id"]
    return user_id, token


def test_register_and_login_flow():
    user_id, token = create_user_and_token("wx_1001", "Pass1234", "Alice")
    assert user_id.startswith("usr_")

    login_resp = client.post(
        "/api/v1/auth/password-login",
        json={"user_id": user_id, "password": "Pass1234"},
    )
    assert login_resp.status_code == 200
    assert login_resp.json()["code"] == 0

    wrong_openid_login = client.post(
        "/api/v1/auth/wechat-login",
        json={"openid": "wx_1001", "password": "wrongpass"},
    )
    assert wrong_openid_login.status_code == 401

    missing_password_login = client.post(
        "/api/v1/auth/wechat-login",
        json={"openid": "wx_1001"},
    )
    assert missing_password_login.status_code == 401

    me_resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["data"]["user_id"] == user_id

    invalid_me_resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert invalid_me_resp.status_code == 401


def test_water_record_crud_and_list_range():
    user_id, token = create_user_and_token("wx_2001", "Pass1234", "Bob")
    headers = {"Authorization": f"Bearer {token}"}

    create_resp = client.post(
        "/api/v1/water-records",
        json={"user_id": user_id, "amount_ml": 250, "drank_at": "2026-09-18T08:30:00+08:00"},
        headers=headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    record = create_resp.json()["data"]
    assert record["amount_ml"] == 250
    record_id = record["id"]

    all_resp = client.get(f"/api/v1/water-records?user_id={user_id}", headers=headers)
    assert all_resp.status_code == 200
    assert all_resp.json()["data"]["total"] >= 1

    range_resp = client.get(
        "/api/v1/water-records/range",
        params={"user_id": user_id, "start_time": "2026-09-17T00:00:00+08:00", "end_time": "2026-09-19T00:00:00+08:00"},
        headers=headers,
    )
    assert range_resp.status_code == 200
    assert len(range_resp.json()["data"]["records"]) >= 1

    update_resp = client.put(
        f"/api/v1/water-records/{record_id}",
        json={"amount_ml": 300},
        headers=headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["data"]["amount_ml"] == 300

    delete_resp = client.delete(f"/api/v1/water-records/{record_id}", headers=headers)
    assert delete_resp.status_code == 200
    assert delete_resp.json()["code"] == 0


def test_goal_set_get_update():
    user_id, token = create_user_and_token("wx_3001", "Pass1234", "Charlie")
    headers = {"Authorization": f"Bearer {token}"}

    set_resp = client.post(
        "/api/v1/water-goals",
        json={"user_id": user_id, "target_ml": 2000},
        headers=headers,
    )
    assert set_resp.status_code == 200
    assert set_resp.json()["data"]["target_ml"] == 2000

    get_resp = client.get(f"/api/v1/water-goals?user_id={user_id}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["data"]["target_ml"] == 2000

    update_resp = client.put(
        "/api/v1/water-goals",
        json={"user_id": user_id, "target_ml": 2500},
        headers=headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["data"]["target_ml"] == 2500


def test_api_key_flow_for_agent_access():
    user_id, token = create_user_and_token("wx_4001", "Pass1234", "Dana")
    headers = {"Authorization": f"Bearer {token}"}

    key_resp = client.post(
        "/api/v1/api-keys",
        json={"name": "Agent Key", "user_id": user_id},
        headers=headers,
    )
    assert key_resp.status_code == 200, key_resp.text
    key_value = key_resp.json()["data"]["api_key"]

    agent_headers = {"Authorization": f"Bearer {key_value}"}
    record_resp = client.post(
        "/api/v1/water-records",
        json={"amount_ml": 500, "drank_at": "2026-09-18T09:00:00+08:00"},
        headers=agent_headers,
    )
    assert record_resp.status_code == 200
    assert record_resp.json()["data"]["user_id"] == user_id

    list_resp = client.get("/api/v1/api-keys", headers=headers)
    assert list_resp.status_code == 200
    assert list_resp.json()["data"][0]["id"] == key_resp.json()["data"]["id"]

    delete_resp = client.delete(
        f"/api/v1/api-keys/{key_resp.json()['data']['id']}",
        headers=headers,
    )
    assert delete_resp.status_code == 200

    deleted_key_record_resp = client.post(
        "/api/v1/water-records",
        json={"amount_ml": 600, "drank_at": "2026-09-18T10:00:00+08:00"},
        headers=agent_headers,
    )
    assert deleted_key_record_resp.status_code == 401

    expired_key_resp = client.post(
        "/api/v1/api-keys",
        json={"name": "Expired Key", "expires_at": "2020-01-01T00:00:00+00:00"},
        headers=headers,
    )
    assert expired_key_resp.status_code == 200
    expired_headers = {"Authorization": f"Bearer {expired_key_resp.json()['data']['api_key']}"}
    expired_record_resp = client.post(
        "/api/v1/water-records",
        json={"amount_ml": 700, "drank_at": "2026-09-18T11:00:00+08:00"},
        headers=expired_headers,
    )
    assert expired_record_resp.status_code == 401


def test_agent_key_can_use_all_user_data_apis():
    user_id, token = create_user_and_token("wx_agent_all", "Pass1234", "Agent User")
    user_headers = {"Authorization": f"Bearer {token}"}
    key_resp = client.post(
        "/api/v1/api-keys",
        json={"name": "Full Agent Access"},
        headers=user_headers,
    )
    assert key_resp.status_code == 200, key_resp.text
    agent_headers = {"Authorization": f"Bearer {key_resp.json()['data']['api_key']}"}

    me_resp = client.get("/api/v1/auth/me", headers=agent_headers)
    assert me_resp.status_code == 200
    assert me_resp.json()["data"]["user_id"] == user_id

    create_resp = client.post(
        "/api/v1/water-records",
        json={"amount_ml": 350, "drank_at": "2026-09-18T12:00:00+08:00"},
        headers=agent_headers,
    )
    assert create_resp.status_code == 200
    record_id = create_resp.json()["data"]["id"]

    list_resp = client.get("/api/v1/water-records", headers=agent_headers)
    assert list_resp.status_code == 200
    assert any(record["id"] == record_id for record in list_resp.json()["data"]["records"])

    range_resp = client.get(
        "/api/v1/water-records/range",
        params={
            "start_time": "2026-09-18T00:00:00+08:00",
            "end_time": "2026-09-18T23:59:59+08:00",
        },
        headers=agent_headers,
    )
    assert range_resp.status_code == 200
    assert any(record["id"] == record_id for record in range_resp.json()["data"]["records"])

    update_resp = client.put(
        f"/api/v1/water-records/{record_id}",
        json={"amount_ml": 450},
        headers=agent_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["data"]["amount_ml"] == 450

    set_goal_resp = client.post(
        "/api/v1/water-goals",
        json={"target_ml": 1800},
        headers=agent_headers,
    )
    assert set_goal_resp.status_code == 200

    get_goal_resp = client.get("/api/v1/water-goals", headers=agent_headers)
    assert get_goal_resp.status_code == 200
    assert get_goal_resp.json()["data"]["target_ml"] == 1800

    update_goal_resp = client.put(
        "/api/v1/water-goals",
        json={"target_ml": 2200},
        headers=agent_headers,
    )
    assert update_goal_resp.status_code == 200
    assert update_goal_resp.json()["data"]["target_ml"] == 2200

    delete_resp = client.delete(f"/api/v1/water-records/{record_id}", headers=agent_headers)
    assert delete_resp.status_code == 200

    other_user_id, other_token = create_user_and_token("wx_agent_other", "Pass1234", "Other User")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    other_record_resp = client.post(
        "/api/v1/water-records",
        json={"amount_ml": 275, "drank_at": "2026-09-18T13:00:00+08:00"},
        headers=other_headers,
    )
    assert other_record_resp.status_code == 200
    other_record_id = other_record_resp.json()["data"]["id"]

    forbidden_resp = client.post(
        "/api/v1/water-records",
        json={"user_id": other_user_id, "amount_ml": 200, "drank_at": "2026-09-18T13:00:00+08:00"},
        headers=agent_headers,
    )
    assert forbidden_resp.status_code == 403

    assert client.get(f"/api/v1/water-records?user_id={other_user_id}", headers=agent_headers).status_code == 403
    assert client.get(
        "/api/v1/water-records/range",
        params={
            "user_id": other_user_id,
            "start_time": "2026-09-18T00:00:00+08:00",
            "end_time": "2026-09-18T23:59:59+08:00",
        },
        headers=agent_headers,
    ).status_code == 403
    assert client.put(
        f"/api/v1/water-records/{other_record_id}",
        json={"amount_ml": 999},
        headers=agent_headers,
    ).status_code == 403
    assert client.delete(f"/api/v1/water-records/{other_record_id}", headers=agent_headers).status_code == 403

    assert client.get(f"/api/v1/water-goals?user_id={other_user_id}", headers=agent_headers).status_code == 403
    assert client.post(
        "/api/v1/water-goals",
        json={"user_id": other_user_id, "target_ml": 1900},
        headers=agent_headers,
    ).status_code == 403
    assert client.put(
        "/api/v1/water-goals",
        json={"user_id": other_user_id, "target_ml": 1900},
        headers=agent_headers,
    ).status_code == 403
    assert client.post(
        "/api/v1/api-keys",
        json={"user_id": other_user_id, "name": "Forged ownership"},
        headers=agent_headers,
    ).status_code == 403
