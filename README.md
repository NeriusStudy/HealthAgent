# 饮水记录系统

一个基于 FastAPI、SQLAlchemy Async 和 SQLite 的饮水记录系统，包含：

- 微信号登录、首次注册、密码登录
- 饮水记录新增、查询、范围查询、修改、删除
- 每日饮水目标设置和查询
- API Key 管理
- 面向智能体的 Bearer API Key 访问方式
- `front/` 下的登录页、服务大厅和饮水记录页面

## 1. 项目结构

```text
health_agent/
├─ app/
│  ├─ api/v1/
│  │  ├─ auth.py
│  │  ├─ water_records.py
│  │  ├─ water_goals.py
│  │  ├─ api_keys.py
│  │  └─ router.py
│  ├─ core/security.py
│  ├─ models/
│  ├─ schemas/
│  ├─ services/
│  ├─ config.py
│  ├─ database.py
│  └─ main.py
├─ front/
│  ├─ index.html
│  ├─ hall.html
│  ├─ water.html
│  ├─ app.js
│  ├─ hall.js
│  ├─ water.js
│  └─ styles.css
├─ tests/
├─ requirements.txt
└─ README.md
```

## 2. 运行项目

### 2.1 安装依赖

建议使用 Python 3.11 或更高版本。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2.2 启动后端

在项目根目录执行：

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

后端地址：

```text
http://localhost:8000
```

健康检查：

```text
GET http://localhost:8000/health
```

### 2.3 启动前端

在项目根目录执行：

```powershell
python -m http.server 8080 --directory "D:\my_code\health_agent\front"
```

前端地址：

```text
http://localhost:8080/
```

前端默认请求的后端 API 地址为：

```text
http://localhost:8000/api/v1
```

如需修改前端 API 地址，可以在加载脚本前设置：

```html
<script>
  window.API_BASE = "http://localhost:8000/api/v1";
</script>
```

### 2.4 FastAPI 文档

后端启动后可以访问：

- Swagger UI：`http://localhost:8000/docs`
- ReDoc：`http://localhost:8000/redoc`
- OpenAPI JSON：`http://localhost:8000/openapi.json`

## 3. 数据库配置

默认数据库为项目根目录下的 SQLite 文件：

```text
sqlite+aiosqlite:///./water_tracker.db
```

可以通过环境变量 `DATABASE_URL` 覆盖：

```powershell
$env:DATABASE_URL = "sqlite+aiosqlite:///./water_tracker.db"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

生产环境建议使用 PostgreSQL，并将 `SECRET_KEY` 等敏感配置改为安全的环境变量配置。

## 4. 通用约定

### 4.1 API 前缀

除健康检查外，所有业务 API 都使用前缀：

```text
/api/v1
```

例如：

```text
POST http://localhost:8000/api/v1/auth/wechat-login
```

### 4.2 成功响应格式

业务接口成功时通常返回：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

`data` 的具体类型由接口决定，可能是对象、数组或 `null`。

### 4.3 错误响应格式

FastAPI 参数校验失败或业务异常通常返回：

```json
{
  "detail": "错误描述"
}
```

常见状态码：

| 状态码 | 含义 |
|---|---|
| `200` | 请求成功 |
| `401` | 未登录、Token/API Key 无效、密码错误、API Key 过期 |
| `403` | 已认证，但访问了不属于当前用户的数据 |
| `404` | 资源不存在 |
| `409` | 资源状态冲突，例如重复注册或重复设置目标 |
| `422` | 请求参数格式或字段校验失败 |

### 4.4 时间格式

所有 `datetime` 参数建议使用 ISO 8601 格式，并携带时区：

```text
2026-09-18T08:30:00+08:00
```

接口响应中的时间字段为 ISO 8601 字符串。

### 4.5 认证方式

所有受保护接口都使用：

```http
Authorization: Bearer <token>
```

`<token>` 可以是：

1. 用户登录得到的 JWT Access Token
2. API Key，供智能体调用

注意：API Key 只在创建时返回完整明文，服务端只保存其 SHA-256 哈希，调用方必须安全保存完整 API Key。

## 5. 健康检查接口

### `GET /health`

无需认证，用于确认后端是否正常运行。

#### 请求

无请求头要求，无请求体。

#### 成功响应

```json
{
  "status": "ok"
}
```

## 6. 认证接口

认证接口前缀：

```text
/api/v1/auth
```

### 6.1 微信号登录或注册探测

### `POST /api/v1/auth/wechat-login`

根据 `openid` 判断用户是否已经注册：

- 已注册：必须校验密码，正确后返回 Access Token
- 未注册：返回短时有效的注册 Token，前端随后调用注册接口；对应 `openid` 注册成功后不能再次注册

#### 请求体

```json
{
  "openid": "wx_123456",
  "password": "Pass1234"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `openid` | `string` | 是 | 长度至少 1 |
| `password` | `string` 或 `null` | 否 | 如果传入，长度至少 1；已注册用户必须传入 |

#### 已注册用户且密码正确：响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "need_register": false,
    "token": "<access-jwt>",
    "token_type": "Bearer",
    "expires_in": 7200,
    "user": {
      "user_id": "usr_xxxxxxxxxxxxxxxx",
      "nickname": "喝水达人",
      "created_at": "2026-09-19T00:00:00"
    }
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `need_register` | `boolean` | 已注册时为 `false` |
| `token` | `string` | JWT Access Token |
| `token_type` | `string` | 固定为 `Bearer` |
| `expires_in` | `integer` | 有效期秒数，当前为 `7200` |
| `user` | `object` | 当前用户信息 |

#### 未注册用户：响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "need_register": true,
    "register_token": "<register-jwt>",
    "expires_in": 600
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `need_register` | `boolean` | 未注册时为 `true` |
| `register_token` | `string` | 注册接口使用的短时有效注册 JWT |
| `expires_in` | `integer` | 注册 Token 有效期秒数，当前为 `600` |

#### 错误

- 已注册但未传密码：`401`
- 已注册但密码错误：`401`，`detail` 为 `invalid password`
- `openid` 为空：`422`

### 6.2 注册用户

### `POST /api/v1/auth/register`

使用 `wechat-login` 返回的 `register_token` 创建用户。

#### 请求体

```json
{
  "register_token": "<register-jwt>",
  "password": "Pass1234",
  "nickname": "喝水达人"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `register_token` | `string` | 是 | 长度至少 1，必须是有效注册 Token |
| `password` | `string` | 是 | 长度 6-32，必须同时包含字母和数字 |
| `nickname` | `string` 或 `null` | 否 | 最大长度 64 |

#### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "token": "<access-jwt>",
    "token_type": "Bearer",
    "expires_in": 7200,
    "user": {
      "user_id": "usr_xxxxxxxxxxxxxxxx",
      "nickname": "喝水达人",
      "created_at": "2026-09-19T00:00:00"
    }
  }
}
```

#### 错误

- 注册 Token 无效或过期：`401`
- Token 类型不是注册 Token：`401`
- 对应 `openid` 已经注册：`409`
- 密码不符合长度或字母数字要求：`422`

### 6.3 使用 user_id 和密码登录

### `POST /api/v1/auth/password-login`

#### 请求体

```json
{
  "user_id": "usr_xxxxxxxxxxxxxxxx",
  "password": "Pass1234"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `user_id` | `string` | 是 | 长度至少 1 |
| `password` | `string` | 是 | 长度至少 1 |

#### 成功响应

与微信号登录成功时的 `data` 结构相同，但不包含 `need_register`。

#### 错误

用户不存在或密码错误时返回 `401`，`detail` 为 `invalid credentials`。

### 6.4 获取当前用户

### `GET /api/v1/auth/me`

#### 请求头

```http
Authorization: Bearer <access-jwt-or-api-key>
```

#### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "user_id": "usr_xxxxxxxxxxxxxxxx",
    "nickname": "喝水达人",
    "created_at": "2026-09-19T00:00:00"
  }
}
```

## 7. 饮水记录接口

接口前缀：

```text
/api/v1/water-records
```

所有接口都需要 `Authorization` 请求头。

### 7.1 新增饮水记录

### `POST /api/v1/water-records`

#### 请求体

```json
{
  "user_id": "usr_xxxxxxxxxxxxxxxx",
  "amount_ml": 250,
  "drank_at": "2026-09-18T08:30:00+08:00"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `user_id` | `string` 或 `null` | 否 | 如果传入，必须等于认证用户 ID |
| `amount_ml` | `integer` | 是 | 大于 0 且小于等于 5000 |
| `drank_at` | `datetime` | 是 | ISO 8601 时间 |

智能体调用时推荐省略 `user_id`，服务端会自动使用 API Key 所属用户：

```json
{
  "amount_ml": 250,
  "drank_at": "2026-09-18T08:30:00+08:00"
}
```

#### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "user_id": "usr_xxxxxxxxxxxxxxxx",
    "amount_ml": 250,
    "drank_at": "2026-09-18T08:30:00",
    "created_at": "2026-09-19T00:00:00",
    "updated_at": "2026-09-19T00:00:00"
  }
}
```

### 7.2 查询饮水记录

### `GET /api/v1/water-records`

#### 查询参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---:|---:|---|
| `user_id` | `string` | 否 | 当前用户 | 只能查询认证用户自身 ID |
| `page` | `integer` | 否 | `1` | 小于 1 时按 1 处理 |
| `page_size` | `integer` | 否 | `50` | 小于 1 时按 50 处理，服务层最大按 200 处理 |

示例：

```text
GET /api/v1/water-records?page=1&page_size=50
```

#### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 50,
    "records": [
      {
        "id": 1,
        "user_id": "usr_xxxxxxxxxxxxxxxx",
        "amount_ml": 250,
        "drank_at": "2026-09-18T08:30:00",
        "created_at": "2026-09-19T00:00:00",
        "updated_at": "2026-09-19T00:00:00"
      }
    ]
  }
}
```

记录按照 `drank_at` 从晚到早排序。

### 7.3 按时间范围查询饮水记录

### `GET /api/v1/water-records/range`

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `user_id` | `string` | 否 | 默认当前用户，只能查询认证用户自身 ID |
| `start_time` | `datetime` | 是 | 查询开始时间 |
| `end_time` | `datetime` | 是 | 查询结束时间 |
| `page` | `integer` | 否 | 默认 `1` |
| `page_size` | `integer` | 否 | 默认 `50`，服务层最大按 200 处理 |

示例：

```text
GET /api/v1/water-records/range?start_time=2026-09-18T00:00:00%2B08:00&end_time=2026-09-18T23:59:59%2B08:00
```

时间范围是闭区间，包含 `start_time` 和 `end_time`。

响应结构与普通列表查询相同。

### 7.4 修改饮水记录

### `PUT /api/v1/water-records/{record_id}`

路径参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `record_id` | `integer` | 是 | 饮水记录 ID |

请求体字段全部可选；建议至少提供一个要修改的字段。传入空对象时，接口会保留原记录并返回当前记录。

```json
{
  "amount_ml": 300,
  "drank_at": "2026-09-18T09:00:00+08:00"
}
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `amount_ml` | `integer` 或 `null` | 大于 0 且小于等于 5000 |
| `drank_at` | `datetime` 或 `null` | ISO 8601 时间 |

只能修改当前认证用户自己的记录。其他用户的记录返回 `403`，不存在的记录返回 `404`。

### 7.5 删除饮水记录

### `DELETE /api/v1/water-records/{record_id}`

只能删除当前认证用户自己的记录。

成功响应：

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

## 8. 饮水目标接口

接口前缀：

```text
/api/v1/water-goals
```

### 8.1 新增每日饮水目标

### `POST /api/v1/water-goals`

#### 请求体

```json
{
  "user_id": "usr_xxxxxxxxxxxxxxxx",
  "target_ml": 2000
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `user_id` | `string` 或 `null` | 否 | 如果传入，必须等于认证用户 ID |
| `target_ml` | `integer` | 是 | 必须大于 0 |

用户已经有目标时再次 POST 返回 `409`，应使用 PUT 更新。

### 8.2 查询每日饮水目标

### `GET /api/v1/water-goals`

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `user_id` | `string` | 否 | 默认当前用户，只能查询认证用户自身 ID |

有目标时返回：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "user_id": "usr_xxxxxxxxxxxxxxxx",
    "target_ml": 2000,
    "created_at": "2026-09-19T00:00:00",
    "updated_at": "2026-09-19T00:00:00"
  }
}
```

没有目标时：

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

### 8.3 更新每日饮水目标

### `PUT /api/v1/water-goals`

请求体与 POST 相同：

```json
{
  "target_ml": 2500
}
```

如果目标不存在，PUT 会创建目标；如果目标已存在，PUT 会更新目标。

## 9. API Key 管理接口

API Key 用于给智能体访问用户数据。接口前缀：

```text
/api/v1/api-keys
```

建议使用用户 JWT 管理 API Key，不建议让智能体自行创建或删除 API Key。

### 9.1 创建 API Key

### `POST /api/v1/api-keys`

#### 请求体

```json
{
  "name": "My Agent",
  "expires_at": "2027-01-01T00:00:00+00:00"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `user_id` | `string` 或 `null` | 否 | 如果传入，必须等于认证用户 ID |
| `name` | `string` 或 `null` | 否 | 最大长度 64 |
| `expires_at` | `datetime` 或 `null` | 否 | 到期时间；为空表示不设置过期时间 |

成功响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "api_key": "wt_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "key_prefix": "wt_live_xxxxxxxx",
    "name": "My Agent",
    "expires_at": "2027-01-01T00:00:00+00:00",
    "created_at": "2026-09-19T00:00:00"
  }
}
```

`api_key` 只在创建响应中返回完整值，之后列表接口只返回 `key_prefix`。

### 9.2 查询当前用户的 API Key 列表

### `GET /api/v1/api-keys`

无请求体。需要 Bearer JWT 或 API Key。

成功响应的 `data` 是数组：

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "user_id": "usr_xxxxxxxxxxxxxxxx",
      "key_prefix": "wt_live_xxxxxxxx",
      "name": "My Agent",
      "is_active": true,
      "created_at": "2026-09-19T00:00:00",
      "expires_at": "2027-01-01T00:00:00"
    }
  ]
}
```

完整 API Key 不会在列表接口返回。

### 9.3 删除 API Key

### `DELETE /api/v1/api-keys/{key_id}`

只能删除当前认证用户自己的 API Key。

成功响应：

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

删除后继续使用该 API Key 会返回 `401`。

## 10. 智能体 API 使用方式

### 10.1 给智能体创建 API Key

使用用户 JWT 创建：

```bash
curl -X POST "http://localhost:8000/api/v1/api-keys" \
  -H "Authorization: Bearer <user-access-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name":"water-agent","expires_at":"2027-01-01T00:00:00+00:00"}'
```

保存响应中的完整 `data.api_key`。

### 10.2 智能体请求头

后续请求统一使用：

```http
Authorization: Bearer <api-key>
```

### 10.3 智能体新增饮水记录

```bash
curl -X POST "http://localhost:8000/api/v1/water-records" \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount_ml": 250,
    "drank_at": "2026-09-18T08:30:00+08:00"
  }'
```

建议不要在请求体中传 `user_id`，服务端会根据 API Key 自动确定用户。

### 10.4 智能体查询饮水记录

```bash
curl "http://localhost:8000/api/v1/water-records?page=1&page_size=50" \
  -H "Authorization: Bearer <api-key>"
```

### 10.5 智能体查询日期范围

```bash
curl "http://localhost:8000/api/v1/water-records/range?start_time=2026-09-18T00:00:00%2B08:00&end_time=2026-09-18T23:59:59%2B08:00" \
  -H "Authorization: Bearer <api-key>"
```

### 10.6 智能体修改和删除记录

```bash
curl -X PUT "http://localhost:8000/api/v1/water-records/1" \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"amount_ml":300}'
```

```bash
curl -X DELETE "http://localhost:8000/api/v1/water-records/1" \
  -H "Authorization: Bearer <api-key>"
```

### 10.7 智能体查询和更新饮水目标

```bash
curl "http://localhost:8000/api/v1/water-goals" \
  -H "Authorization: Bearer <api-key>"
```

```bash
curl -X PUT "http://localhost:8000/api/v1/water-goals" \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"target_ml":2000}'
```

## 11. 智能体数据隔离规则

系统不会信任智能体请求体中的用户 ID，而是以 Bearer Token/API Key 解析出的用户身份为准。

以下情况会被拒绝：

- API Key 查询其他用户的记录：`403`
- API Key 查询其他用户的目标：`403`
- API Key 新增指定给其他用户的记录：`403`
- API Key 修改或删除其他用户的记录：`403`
- API Key 新增或修改其他用户的目标：`403`
- API Key 创建归属于其他用户的 API Key：`403`
- 无效或过期 API Key：`401`
- 已删除 API Key：`401`

因此智能体只能访问创建该 API Key 的所属用户数据。

## 12. 测试

运行全部后端测试：

```powershell
python -m pytest -q
```

测试覆盖：

- 认证和密码校验
- 注册 Token
- 无效 Token
- 饮水记录 CRUD
- 饮水记录时间范围查询
- 饮水目标设置、查询、更新
- API Key 创建、列表、删除、过期
- 智能体调用所有数据接口
- 跨用户读取和修改隔离

## 13. 当前安全注意事项

1. `app/config.py` 中的 `secret_key` 默认值仅适合本地开发，生产环境必须替换。
2. API Key 创建响应中的完整 `api_key` 只应保存一次，不能写入日志或提交到代码仓库。
3. 建议生产环境使用 HTTPS，避免 Token 和 API Key 在网络中明文传输。
4. 当前系统使用 SQLite 进行本地开发，生产环境建议使用 PostgreSQL。
5. 当前 CORS 配置为允许所有来源，生产环境应限制为实际前端域名。
6. 本地联调可向 `wechat-login` 传测试 `openid`；真实微信环境必须传 `wx.login` 返回的临时 `code`，由后端换取可信身份。

## 14. 微信小程序

原生微信小程序位于 `miniprogram/`，当前已实现：

- 开发环境 OpenID 登录、首次注册和登录态管理
- 正式环境 `wx.login` code 登录
- 今日饮水量、目标进度和最近记录
- 快捷/自定义新增饮水记录
- 饮水记录列表、修改和删除
- 每日饮水目标查询和更新

### 14.1 本地联调

启动后端：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

然后在微信开发者工具中导入 `miniprogram/`。默认配置位于 `miniprogram/app.js`：

```js
apiBase: 'http://127.0.0.1:8000/api/v1',
authMode: 'dev'
```

开发者工具需要勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”。登录页可使用任意测试 OpenID，例如 `wx_dev_001`；首次登录会进入注册流程。

### 14.2 真机与上线

1. 将 `miniprogram/project.config.json` 中的 `appid` 换成真实小程序 AppID。
2. 复制 `.env.example` 为 `.env`，配置 `WECHAT_APPID`、`WECHAT_SECRET` 和安全的 `SECRET_KEY`。
3. 将 `miniprogram/app.js` 的 `authMode` 改为 `wechat`。
4. 将 `apiBase` 改为已备案、已配置微信 request 合法域名的 HTTPS 地址。
5. `WECHAT_SECRET` 只能保存在后端，不能写入小程序代码。

`POST /api/v1/auth/wechat-login` 现在兼容两种请求：开发模式传 `openid`，正式模式传 `wx.login` 返回的 `code`。两者只能传一个。
